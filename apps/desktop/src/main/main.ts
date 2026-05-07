import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  appendBuilderEvent,
  composeBuildPrompt,
  createBuilderSession,
  transitionBuildLoop,
  type BuilderRequest
} from "@buildbotprime/core";
import { createIdeAdapter } from "@buildbotprime/ide-adapters";
import {
  AGENTIC_MODEL_PROFILES,
  collectProviderEnvKeys,
  getModelProviderBootstrap,
  getProviderDescriptor,
  PROVIDER_DESCRIPTORS,
  resolveModelProfile,
  type AgenticModelProfile,
  type ModelProviderId
} from "@buildbotprime/model-providers";
import { listProductPlaybooks } from "@buildbotprime/product-knowledge";
import { detectProject } from "@buildbotprime/project-runner";
import {
  maskSecret,
  resolveSecretStorePath,
  SecretStore
} from "@buildbotprime/secure-storage";
import { InMemorySessionStore } from "@buildbotprime/storage";
import {
  callTwinMindChat,
  TwinMindEngine,
  type TwinMindCallToolHooks,
  type TwinMindEvent,
  type TwinMindObservation,
  type TwinMindStateSnapshot
} from "@buildbotprime/twin-mind";
import { loadBuildBotPrimeEnv } from "./env.js";
import {
  IPC_CHANNELS,
  type AutomationEvent,
  type AutomationResult,
  type BootstrapPayload,
  type DocumentIntakeFile,
  type DocumentIntakeSelection,
  type ProviderFieldState,
  type ProviderSettingsState,
  type ProviderSettingsUpdateResult,
  type ProjectFolderSelection,
  type StartBuildResponse,
  type TwinChatRequest,
  type TwinChatResponse,
  type TwinMindStartRequest,
  type TwinMindStartResponse
} from "../shared/ipc.js";

declare const __dirname: string;

const store = new InMemorySessionStore();
const envKeysFromFile = new Set<string>();
const projectWatchers = new Map<string, { watcher: FSWatcher; eventCount: number }>();
const twinMindEngines = new Map<string, TwinMindEngine>();
let activeProviderId: ModelProviderId | "all" = "all";
let mainWindowRef: BrowserWindow | null = null;
let secretStore: SecretStore | null = null;

function getSecretStore(): SecretStore {
  if (!secretStore) {
    secretStore = new SecretStore({
      filePath: resolveSecretStorePath(app.getPath("userData")),
      encrypt: (plain) => {
        try {
          return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : null;
        } catch (error) {
          console.warn("[BuildBotPrime] safeStorage.encryptString failed", error);
          return null;
        }
      },
      decrypt: (buffer) => {
        try {
          return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : null;
        } catch (error) {
          console.warn("[BuildBotPrime] safeStorage.decryptString failed", error);
          return null;
        }
      },
      isEncryptionAvailable: () => {
        try {
          return safeStorage.isEncryptionAvailable();
        } catch {
          return false;
        }
      }
    });
  }
  return secretStore;
}

function captureEnvFileKeys(): void {
  for (const key of collectProviderEnvKeys()) {
    if (key in process.env && process.env[key]) {
      envKeysFromFile.add(key);
    }
  }
}

function applyKeychainToEnv(): void {
  const secrets = getSecretStore().readAll();
  for (const [key, value] of Object.entries(secrets)) {
    if (!value) continue;
    process.env[key] = String(value);
  }
}

function buildProviderSettings(): readonly ProviderSettingsState[] {
  const secrets = getSecretStore().readAll();
  return PROVIDER_DESCRIPTORS.map((descriptor) => {
    const fields: ProviderFieldState[] = descriptor.fields.map((field) => {
      const secretValue = secrets[field.key];
      const envValue = process.env[field.key];
      const effective = secretValue ?? envValue ?? "";
      const fromEnvFile = envKeysFromFile.has(field.key) && !secretValue;
      const hasValue = Boolean(effective);
      const isSecret = field.type === "secret";
      return {
        key: field.key,
        hasValue,
        maskedValue: hasValue ? (isSecret ? maskSecret(effective) : effective) : "",
        fromEnvFile
      };
    });

    const requiredFields = descriptor.fields.filter((field) => field.required);
    const isConfigured = requiredFields.every((field) => {
      const state = fields.find((f) => f.key === field.key);
      return state?.hasValue ?? false;
    });

    return {
      descriptor,
      isConfigured,
      fields
    };
  });
}

function toBootstrapPayload(): BootstrapPayload {
  let keychainEncrypted = false;
  try {
    keychainEncrypted = safeStorage.isEncryptionAvailable();
  } catch {
    keychainEncrypted = false;
  }

  return {
    playbooks: listProductPlaybooks(),
    modelProviders: getModelProviderBootstrap(process.env),
    sessions: [],
    providerSettings: buildProviderSettings(),
    activeProviderId,
    keychainEncrypted
  };
}

function toUpdateResult(): ProviderSettingsUpdateResult {
  return {
    modelProviders: getModelProviderBootstrap(process.env),
    providerSettings: buildProviderSettings()
  };
}

function createAutomationEvent(
  kind: AutomationEvent["kind"],
  label: string,
  detail: string
): AutomationEvent {
  return {
    kind,
    label,
    detail,
    timestamp: new Date().toISOString()
  };
}

async function appendSessionSystemEvent(
  sessionId: string,
  message: string,
  metadata: Record<string, string | number | boolean> = {}
): Promise<void> {
  const session = (await store.listSessions()).find((item) => item.id === sessionId);
  if (!session) return;
  await store.saveSession(
    appendBuilderEvent(session, {
      kind: "system",
      message,
      metadata
    })
  );
}

async function executeAutomation(
  sessionId: string,
  request: BuilderRequest,
  prompt: string
): Promise<AutomationResult> {
  const events: AutomationEvent[] = [];
  const target = request.preferredIde === "custom" ? "cursor" : request.preferredIde;

  clipboard.writeText(prompt);
  events.push(createAutomationEvent("success", "Prompt copied", "The composed prompt is on the clipboard."));

  if (target !== "cursor") {
    events.push(
      createAutomationEvent(
        "warning",
        "Manual handoff required",
        `${target} launch automation is not implemented yet. The prompt is copied for manual paste.`
      )
    );
    await appendSessionSystemEvent(sessionId, "Prompt copied; manual IDE handoff required.", {
      target
    });
    return {
      target,
      status: "manual-required",
      prompt,
      promptCopied: true,
      launched: false,
      handoffAttempted: false,
      events
    };
  }

  if (!request.projectPath) {
    events.push(
      createAutomationEvent(
        "error",
        "Project folder missing",
        "Cursor automation needs a local project folder. Use Browse Folder first."
      )
    );
    return {
      target,
      status: "failed",
      prompt,
      promptCopied: true,
      launched: false,
      handoffAttempted: false,
      events
    };
  }

  const launch = launchCursor(request.projectPath);
  events.push(launch);
  await appendSessionSystemEvent(sessionId, launch.detail, {
    automation: "cursor-launch",
    projectPath: request.projectPath
  });

  if (launch.kind === "error") {
    return {
      target,
      status: "failed",
      prompt,
      promptCopied: true,
      launched: false,
      handoffAttempted: false,
      events
    };
  }

  startProjectWatcher(sessionId, request.projectPath);
  events.push(
    createAutomationEvent(
      "success",
      "Project observer armed",
      `Watching file changes under ${request.projectPath}.`
    )
  );

  const cursorAgent = await startCursorAgentRun(sessionId, request, prompt);
  if (cursorAgent.kind === "success") {
    events.push(cursorAgent.event);
    return {
      target,
      status: "executed",
      prompt,
      agentId: cursorAgent.agentId,
      runId: cursorAgent.runId,
      promptCopied: true,
      launched: true,
      handoffAttempted: true,
      events
    };
  }

  events.push(cursorAgent.event);
  await delay(2_800);
  const handoff = await injectPromptIntoCursor();
  events.push(handoff);
  await appendSessionSystemEvent(sessionId, handoff.detail, {
    automation: "cursor-prompt-handoff",
    success: handoff.kind === "success"
  });

  return {
    target,
    status: handoff.kind === "success" ? "executed" : "partial",
    prompt,
    promptCopied: true,
    launched: true,
    handoffAttempted: true,
    events
  };
}

async function startCursorAgentRun(
  sessionId: string,
  request: BuilderRequest,
  prompt: string
): Promise<
  | { kind: "success"; event: AutomationEvent; agentId: string; runId: string }
  | { kind: "warning"; event: AutomationEvent }
> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return {
      kind: "warning",
      event: createAutomationEvent(
        "warning",
        "Cursor SDK key missing",
        "No CURSOR_API_KEY is saved, so BuildBotPrime is using Windows UI automation: focus Cursor, open Composer, paste, and submit."
      )
    };
  }

  if (!request.projectPath) {
    return {
      kind: "warning",
      event: createAutomationEvent(
        "warning",
        "Cursor Agent skipped",
        "A local project folder is required for Cursor SDK local execution."
      )
    };
  }

  try {
    const { Agent } = await import("@cursor/sdk");
    const steeringModel = resolveModelProfile(request.steeringModelId ?? "");
    const configuredModel = process.env.CURSOR_AGENT_MODEL?.trim();
    const modelId =
      steeringModel.provider === "cursor-sdk"
        ? steeringModel.model
        : configuredModel || "auto";

    const agent = await Agent.create({
      apiKey,
      name: `BuildBotPrime ${new Date().toLocaleString()}`,
      model: { id: modelId },
      local: {
        cwd: request.projectPath,
        settingSources: ["all"]
      }
    });
    const run = await agent.send(prompt);

    void observeCursorRun(sessionId, agent, run);

    await appendSessionSystemEvent(sessionId, `Cursor Agent started: ${run.id}`, {
      automation: "cursor-sdk",
      agentId: agent.agentId,
      runId: run.id,
      model: modelId
    });

    return {
      kind: "success",
      agentId: agent.agentId,
      runId: run.id,
      event: createAutomationEvent(
        "success",
        "Cursor Agent running",
        `Started local Cursor agent ${agent.agentId}, run ${run.id}, model ${modelId}.`
      )
    };
  } catch (error) {
    return {
      kind: "warning",
      event: createAutomationEvent(
        "warning",
        "Cursor Agent startup failed",
        error instanceof Error ? error.message : "Cursor SDK failed to start. Falling back to UI handoff."
      )
    };
  }
}

async function observeCursorRun(
  sessionId: string,
  agent: Awaited<ReturnType<typeof import("@cursor/sdk").Agent.create>>,
  run: Awaited<ReturnType<Awaited<ReturnType<typeof import("@cursor/sdk").Agent.create>>["send"]>>
): Promise<void> {
  try {
    const disposeStatus = run.onDidChangeStatus((status) => {
      void appendSessionSystemEvent(sessionId, `Cursor Agent status: ${status}`, {
        automation: "cursor-sdk",
        runId: run.id,
        status
      });
    });

    if (run.supports("stream")) {
      try {
        for await (const message of run.stream()) {
          await appendSessionSystemEvent(sessionId, summarizeSdkMessage(message), {
            automation: "cursor-sdk",
            runId: run.id
          });
        }
      } catch (error) {
        await appendSessionSystemEvent(
          sessionId,
          error instanceof Error ? `Cursor Agent stream error: ${error.message}` : "Cursor Agent stream error.",
          { automation: "cursor-sdk", runId: run.id, success: false }
        );
      }
    }

    const result = await run.wait();
    disposeStatus();
    const latestSession = (await store.listSessions()).find((item) => item.id === sessionId);
    if (latestSession) {
      await store.saveSession(
        transitionBuildLoop(
          latestSession,
          result.status === "finished" ? "done" : "waiting-for-user",
          result.status === "finished"
            ? "Cursor Agent finished the build run."
            : `Cursor Agent ended with status ${result.status}.`,
          result.status === "error" ? result.result : undefined
        )
      );
    }
    await appendSessionSystemEvent(sessionId, `Cursor Agent result: ${result.status}`, {
      automation: "cursor-sdk",
      runId: run.id,
      durationMs: result.durationMs ?? 0
    });
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

function summarizeSdkMessage(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "Cursor Agent emitted an update.";
  }
  const record = message as Record<string, unknown>;
  const type = String(record.type ?? "update");
  if (type === "assistant" && typeof record.message === "object" && record.message) {
    return "Cursor Agent assistant update.";
  }
  if (type === "status" && typeof record.status === "string") {
    return `Cursor Agent status: ${record.status}`;
  }
  if (type === "tool_use" && typeof record.name === "string") {
    return `Cursor Agent tool: ${record.name}`;
  }
  return `Cursor Agent ${type}.`;
}

function launchCursor(projectPath: string): AutomationEvent {
  const cursorPath = resolveCursorExecutable();
  try {
    const child = cursorPath
      ? spawn(cursorPath, [projectPath], { detached: true, stdio: "ignore" })
      : spawn("cmd.exe", ["/d", "/s", "/c", "cursor", projectPath], {
          detached: true,
          stdio: "ignore"
        });
    child.unref();
    return createAutomationEvent(
      "success",
      "Cursor launched",
      `Opened Cursor with project folder: ${projectPath}`
    );
  } catch (error) {
    return createAutomationEvent(
      "error",
      "Cursor launch failed",
      error instanceof Error ? error.message : "Failed to spawn Cursor."
    );
  }
}

function resolveCursorExecutable(): string | undefined {
  const candidates = [
    process.env.CURSOR_EXECUTABLE,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "cursor", "Cursor.exe") : undefined,
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, "AppData", "Local", "Programs", "cursor", "Cursor.exe")
      : undefined
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate));
}

async function injectPromptIntoCursor(): Promise<AutomationEvent> {
  if (process.platform !== "win32") {
    return createAutomationEvent(
      "warning",
      "Prompt injection skipped",
      "Automatic prompt injection is currently implemented for Windows only; prompt remains copied."
    );
  }

  const script = [
    "$wshell = New-Object -ComObject WScript.Shell",
    "$activated = $false",
    "for ($i = 0; $i -lt 12; $i++) {",
    "  if ($wshell.AppActivate('Cursor')) { $activated = $true; break }",
    "  Start-Sleep -Milliseconds 500",
    "}",
    "if (-not $activated) { Write-Error 'Cursor window was not found'; exit 2 }",
    "Start-Sleep -Milliseconds 500",
    "$wshell.SendKeys('^i')",
    "Start-Sleep -Milliseconds 700",
    "$wshell.SendKeys('^v')",
    "Start-Sleep -Milliseconds 350",
    "$wshell.SendKeys('{ENTER}')",
    "Start-Sleep -Milliseconds 350",
    "$wshell.SendKeys('^l')",
    "Start-Sleep -Milliseconds 500",
    "$wshell.SendKeys('^v')",
    "Start-Sleep -Milliseconds 350",
    "$wshell.SendKeys('{ENTER}')"
  ].join("; ");

  const result = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ]);

  if (result.exitCode === 0) {
    return createAutomationEvent(
      "success",
      "Prompt injected",
      "Focused Cursor, opened Composer/Chat with keyboard automation, pasted the composed prompt, and pressed Enter."
    );
  }

  return createAutomationEvent(
    "warning",
    "Prompt injection needs manual takeover",
    result.stderr || result.stdout || "Could not focus Cursor. Prompt remains copied to clipboard."
  );
}

function runProcess(command: string, args: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ stdout, stderr: error.message, exitCode: 1 });
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function startProjectWatcher(sessionId: string, projectPath: string): void {
  const existing = projectWatchers.get(sessionId);
  existing?.watcher.close();

  try {
    const watcher = watch(projectPath, { recursive: true }, (_eventType, fileName) => {
      const current = projectWatchers.get(sessionId);
      if (!current || current.eventCount >= 120 || !fileName) return;
      current.eventCount += 1;
      void appendSessionSystemEvent(sessionId, `Project changed: ${String(fileName)}`, {
        observer: "filesystem",
        file: String(fileName)
      });
    });
    projectWatchers.set(sessionId, { watcher, eventCount: 0 });
  } catch (error) {
    void appendSessionSystemEvent(
      sessionId,
      error instanceof Error ? error.message : "Failed to start project watcher.",
      { observer: "filesystem", success: false }
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAppMenu(): Menu {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: () => {
            const window = BrowserWindow.getFocusedWindow() ?? mainWindowRef;
            if (window) window.webContents.toggleDevTools();
          }
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Ollama provider docs",
          click: () => {
            void shell.openExternal("https://ollama.com/settings/keys");
          }
        },
        {
          label: "Project README",
          click: () => {
            void shell.openExternal("https://github.com/");
          }
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}

async function createMainWindow(): Promise<void> {
  const preloadPath = join(__dirname, "preload.cjs");
  const preloadAvailable = existsSync(preloadPath);
  console.log(
    "[BuildBotPrime] preload path:",
    preloadPath,
    "exists:",
    preloadAvailable
  );

  if (!preloadAvailable) {
    console.error(
      "[BuildBotPrime] preload.cjs missing. Run `npm run build:main` before starting Electron."
    );
  }

  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: "BuildBotPrime",
    backgroundColor: "#0a0b10",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindowRef = mainWindow;

  mainWindow.webContents.on("preload-error", (_event, path, error) => {
    console.error("[BuildBotPrime] preload error:", path, error);
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    await mainWindow.loadURL(devServer);
    if (process.env.BUILDBOTPRIME_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

ipcMain.handle(IPC_CHANNELS.getBootstrap, async (): Promise<BootstrapPayload> => {
  const payload = toBootstrapPayload();
  return {
    ...payload,
    sessions: await store.listSessions()
  };
});

ipcMain.handle(
  IPC_CHANNELS.startBuild,
  async (_event, request: BuilderRequest): Promise<StartBuildResponse> => {
    const adapter = createIdeAdapter(request.preferredIde === "custom" ? "cursor" : request.preferredIde);
    const steeringModel = resolveModelProfile(request.steeringModelId ?? "");
    const prompt = composeBuildPrompt({
      userPrompt: request.prompt,
      productName: adapter.playbook.displayName,
      projectPath: request.projectPath,
      repoUrl: request.repoUrl,
      steeringModelLabel: steeringModel.label,
      behaviorProfile: request.behaviorProfile,
      attempt: 1
    });
    const session = appendBuilderEvent(createBuilderSession(request), {
      kind: "prompt-composed",
      message: prompt,
      metadata: {
        ide: adapter.id,
        product: adapter.playbook.displayName,
        steeringModel: steeringModel.id,
        steeringProvider: steeringModel.provider
      }
    });
    const plannedActions = adapter.planBuildActions({
      projectPath: request.projectPath,
      repoUrl: request.repoUrl,
      modelProfile: request.modelProfile || steeringModel.label,
      prompt
    });

    await store.saveSession(
      transitionBuildLoop(session, "opening-ide", `Opening ${adapter.playbook.displayName}.`)
    );
    const automationResult = await executeAutomation(session.id, request, prompt);
    const latestSession = (await store.listSessions()).find((item) => item.id === session.id) ?? session;
    const nextStatus = automationResult.status === "failed" ? "waiting-for-user" : "observing";
    const nextAction =
      automationResult.status === "executed"
        ? `Watching ${adapter.playbook.displayName} and the project for changes.`
        : automationResult.status === "partial"
          ? "Cursor opened and prompt is copied; finish handoff if the composer did not submit."
          : automationResult.status === "manual-required"
            ? "Manual IDE handoff required; prompt is copied."
            : "Automation failed; fix the blocker and retry.";
    await store.saveSession(transitionBuildLoop(latestSession, nextStatus, nextAction));

    return {
      session: (await store.listSessions()).find((item) => item.id === session.id) ?? latestSession,
      plannedActions,
      automationResult
    };
  }
);

ipcMain.handle(IPC_CHANNELS.selectProjectFolder, async (): Promise<ProjectFolderSelection> => {
  const options: Electron.OpenDialogOptions = {
    title: "Select project folder",
    properties: ["openDirectory", "createDirectory"]
  };
  const result = mainWindowRef
    ? await dialog.showOpenDialog(mainWindowRef, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const path = result.filePaths[0];
  try {
    return {
      canceled: false,
      path,
      detection: await detectProject(path)
    };
  } catch (error) {
    return {
      canceled: false,
      path,
      error: error instanceof Error ? error.message : "Failed to inspect project folder."
    };
  }
});

ipcMain.handle(IPC_CHANNELS.selectIntakeDocuments, async (): Promise<DocumentIntakeSelection> => {
  const options: Electron.OpenDialogOptions = {
    title: "Select intake documents",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Project documents",
        extensions: ["txt", "md", "mdx", "json", "yaml", "yml", "csv", "ts", "tsx", "js", "jsx", "css", "html"]
      },
      { name: "All files", extensions: ["*"] }
    ]
  };
  const result = mainWindowRef
    ? await dialog.showOpenDialog(mainWindowRef, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, files: [] };
  }

  const files: DocumentIntakeFile[] = [];
  const allowed = new Set([
    ".txt",
    ".md",
    ".mdx",
    ".json",
    ".yaml",
    ".yml",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html"
  ]);

  for (const path of result.filePaths.slice(0, 12)) {
    try {
      const extension = extname(path).toLowerCase();
      if (extension && !allowed.has(extension)) {
        files.push({
          path,
          name: basename(path),
          content: "",
          bytes: 0,
          truncated: false,
          error: `Unsupported document type: ${extension}`
        });
        continue;
      }

      const info = await stat(path);
      const raw = await readFile(path, "utf8");
      const maxChars = 60_000;
      files.push({
        path,
        name: basename(path),
        content: raw.slice(0, maxChars),
        bytes: info.size,
        truncated: raw.length > maxChars
      });
    } catch (error) {
      files.push({
        path,
        name: basename(path),
        content: "",
        bytes: 0,
        truncated: false,
        error: error instanceof Error ? error.message : "Failed to read document."
      });
    }
  }

  return { canceled: false, files };
});

ipcMain.handle(
  IPC_CHANNELS.saveProviderSettings,
  async (
    _event,
    providerId: ModelProviderId,
    values: Record<string, string>
  ): Promise<ProviderSettingsUpdateResult> => {
    const descriptor = getProviderDescriptor(providerId);
    if (!descriptor) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const allowedKeys = new Set(descriptor.fields.map((field) => field.key));
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!allowedKeys.has(key)) continue;
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed) {
        patch[key] = trimmed;
        process.env[key] = trimmed;
      }
    }

    const secrets = getSecretStore();
    if (Object.keys(patch).length > 0) {
      secrets.setKeys(patch);
    }

    return toUpdateResult();
  }
);

ipcMain.handle(
  IPC_CHANNELS.clearProviderSettings,
  async (_event, providerId: ModelProviderId): Promise<ProviderSettingsUpdateResult> => {
    const descriptor = getProviderDescriptor(providerId);
    if (!descriptor) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const keys = descriptor.fields.map((field) => field.key);
    getSecretStore().removeKeys(keys);
    for (const key of keys) {
      if (!envKeysFromFile.has(key)) {
        delete process.env[key];
      }
    }
    return toUpdateResult();
  }
);

ipcMain.handle(
  IPC_CHANNELS.setActiveProvider,
  async (_event, providerId: ModelProviderId | "all") => {
    activeProviderId = providerId;
    return { activeProviderId };
  }
);

ipcMain.handle(IPC_CHANNELS.toggleDevTools, async () => {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindowRef;
  if (window) window.webContents.toggleDevTools();
});

function broadcastTwinMindEvent(event: TwinMindEvent): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0 && mainWindowRef) {
    mainWindowRef.webContents.send(IPC_CHANNELS.twinMindEvent, event);
    return;
  }
  for (const window of windows) {
    window.webContents.send(IPC_CHANNELS.twinMindEvent, event);
  }
}

function buildProviderStatus(): Record<ModelProviderId, boolean> {
  return {
    "cursor-sdk": Boolean(process.env.CURSOR_API_KEY),
    "ollama-cloud": Boolean(process.env.OLLAMA_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_AGENTIC_MODEL),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AGENTIC_MODEL),
    google: Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_AGENTIC_MODEL),
    custom: Boolean(process.env.CUSTOM_AGENTIC_BASE_URL && process.env.CUSTOM_AGENTIC_MODEL)
  };
}

function buildTwinMindHooks(sessionId: string, projectPath: string | undefined): TwinMindCallToolHooks {
  let observerStop: (() => void) | undefined;

  return {
    callChat: (options) => {
      const profile = resolveModelProfile(options.modelId);
      return callTwinMindChat({ profile, env: process.env, options });
    },
    resolveModel: (modelId) => AGENTIC_MODEL_PROFILES.find((profile) => profile.id === modelId),
    getDefaultModelId: () => AGENTIC_MODEL_PROFILES[0]?.id ?? "ollama-qwen3-coder-480b",
    listAvailableModels: () => AGENTIC_MODEL_PROFILES,
    providerStatus: () => buildProviderStatus(),
    launchIde: async (target) => {
      if (!projectPath) return;
      if (target === "cursor") {
        launchCursor(projectPath);
      }
    },
    sendToIde: async (text) => {
      clipboard.writeText(text);
      try {
        const event = await injectPromptIntoCursor();
        if (event.kind !== "success") {
          throw new Error(event.detail);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendSessionSystemEvent(sessionId, `TwinMind prompt injection failed: ${message}`, {
          automation: "twin-mind"
        });
        throw error;
      }
    },
    observeProject: (onSignal) => {
      if (!projectPath) return () => undefined;
      let count = 0;
      let watcher: FSWatcher | undefined;
      try {
        watcher = watch(projectPath, { recursive: true }, (eventType, fileName) => {
          if (!fileName || count >= 200) return;
          count += 1;
          const detail = `${eventType}: ${String(fileName)}`;
          const observation: TwinMindObservation = {
            id: `obs_${Date.now().toString(36)}_${count}`,
            source: "filesystem",
            severity: classifyTwinMindFile(String(fileName)),
            headline: `Project changed: ${String(fileName)}`,
            detail,
            timestamp: new Date().toISOString()
          };
          onSignal(observation);
        });
        observerStop = () => {
          watcher?.close();
          watcher = undefined;
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to watch project.";
        onSignal({
          id: `obs_${Date.now().toString(36)}_err`,
          source: "filesystem",
          severity: "warning",
          headline: "Project watcher failed",
          detail: message,
          timestamp: new Date().toISOString()
        });
      }
      return () => {
        observerStop?.();
      };
    },
    emit: (event) => {
      broadcastTwinMindEvent(event);
    }
  };
}

function classifyTwinMindFile(fileName: string): TwinMindObservation["severity"] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".log")) return "info";
  if (lower.includes("error") || lower.endsWith(".lock")) return "warning";
  return "info";
}

ipcMain.handle(
  IPC_CHANNELS.twinMindStart,
  async (_event, payload: TwinMindStartRequest): Promise<TwinMindStartResponse> => {
    const hooks = buildTwinMindHooks(
      `pending_${Date.now().toString(36)}`,
      payload.request.projectPath
    );
    const engine = new TwinMindEngine({
      ...payload,
      hooks
    });
    twinMindEngines.set(engine.sessionId, engine);
    void engine
      .run()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        broadcastTwinMindEvent({
          type: "stopped",
          reason: message,
          snapshot: engine.getSnapshot()
        });
      })
      .finally(() => {
        twinMindEngines.delete(engine.sessionId);
      });
    return {
      sessionId: engine.sessionId,
      snapshot: engine.getSnapshot()
    };
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindStop,
  async (_event, sessionId: string, reason?: string): Promise<{ stopped: boolean }> => {
    const engine = twinMindEngines.get(sessionId);
    if (!engine) return { stopped: false };
    await engine.stop(reason ?? "user-stop");
    return { stopped: true };
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindPickVariant,
  async (_event, sessionId: string, variantId: string): Promise<{ ok: boolean }> => {
    const engine = twinMindEngines.get(sessionId);
    if (!engine) return { ok: false };
    engine.pickVariant(variantId);
    return { ok: true };
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindApprove,
  async (
    _event,
    sessionId: string,
    approvalId: string,
    approve: boolean
  ): Promise<{ ok: boolean }> => {
    const engine = twinMindEngines.get(sessionId);
    if (!engine) return { ok: false };
    engine.approveAction(approvalId, approve);
    return { ok: true };
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindSendMessage,
  async (_event, sessionId: string, text: string): Promise<{ ok: boolean }> => {
    const engine = twinMindEngines.get(sessionId);
    if (!engine) return { ok: false };
    await engine.sendUserMessage(text);
    return { ok: true };
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindGetSnapshot,
  async (_event, sessionId: string): Promise<TwinMindStateSnapshot | undefined> => {
    const engine = twinMindEngines.get(sessionId);
    return engine?.getSnapshot();
  }
);

ipcMain.handle(
  IPC_CHANNELS.twinMindChat,
  async (_event, request: TwinChatRequest): Promise<TwinChatResponse> => {
    const profile = resolveModelProfile(request.steeringModelId);
    const transcript = request.messages
      .map((message) => `${message.role === "user" ? "BUILDER" : "TWIN"}: ${message.content}`)
      .join("\n\n");

    const system = buildTwinChatSystem(request);
    const userBlock = [
      "BUILDER NOTES SO FAR:",
      ...(request.behaviorNotes && request.behaviorNotes.length > 0
        ? request.behaviorNotes.map((line) => `- ${line}`)
        : ["(none yet)"]),
      "",
      request.projectPath ? `PROJECT PATH: ${request.projectPath}` : "PROJECT PATH: (not set)",
      "",
      `LATEST BUILDER MESSAGE: ${getLatestBuilderMessage(request) || "(none)"}`,
      "",
      "CONVERSATION TRANSCRIPT:",
      transcript,
      "",
      "Reply now."
    ].join("\n");

    let raw: string;
    try {
      raw = await callTwinMindChat({
        profile,
        env: process.env,
        options: {
          modelId: profile.id,
          system,
          user: userBlock,
          temperature: 0.6,
          maxOutputTokens: 1100
        }
      });
    } catch (error) {
      raw = "";
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[BuildBotPrime] twinMindChat failed", message);
    }

    return parseTwinChatReply(raw, request);
  }
);

function buildTwinChatSystem(request: TwinChatRequest): string {
  const tone =
    request.mode === "chat"
      ? "Stay in conversation. Match the builder's tone."
      : "You are gently onboarding a new builder. Ask one focused calibration question per turn.";
  return [
    "You are BuildBotPrime - a mirror builder twin made in Boston.",
    "Empower the builder. Speak human-first, clean, civic, never hypey.",
    "You are not a passive logger. Always chat back to the builder like a real collaborator.",
    'Never answer with only "Listening", "Noted", "Captured", or similar thin acknowledgements.',
    "Goal: feel out how this builder writes prompts, names files, structures projects, and approves risky actions.",
    "Listen for: voice (direct/playful/strict), code style (file layout, naming, frameworks), guardrails (what they want approval for), and pacing (ship-fast vs. polish-first).",
    "React directly to the latest builder message first, then ask a useful next question when calibration would benefit from it.",
    tone,
    "",
    "After your conversational reply, output a SINGLE JSON block on its own line so the host UI can parse it:",
    '{"reply":"<short conversational answer>","nextQuestion":"<optional next thing to ask, or empty>","capturedStyleNotes":["..."],"capturedHabits":["..."],"capturedApprovals":["..."]}',
    "Only put items into the captured arrays when the builder has actually expressed them — never invent preferences.",
    "Keep the conversational reply <= 4 short sentences."
  ].join("\n");
}

function parseTwinChatReply(raw: string, request: TwinChatRequest): TwinChatResponse {
  if (!raw) {
    return localTwinChatReply(request);
  }
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (!match) {
    const reply = raw.trim().slice(0, 800);
    const local = localTwinChatReply(request);
    return {
      reply: isThinTwinReply(reply) ? local.reply : reply,
      nextQuestion: isThinTwinReply(reply) ? local.nextQuestion : undefined,
      capturedStyleNotes: [],
      capturedHabits: [],
      capturedApprovals: [],
      raw
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      reply?: string;
      nextQuestion?: string;
      capturedStyleNotes?: string[];
      capturedHabits?: string[];
      capturedApprovals?: string[];
    };
    const parsedReply = parsed.reply?.trim() || raw.replace(match[0], "").trim().slice(0, 800);
    const local = localTwinChatReply(request);
    return {
      reply: isThinTwinReply(parsedReply) ? local.reply : parsedReply,
      nextQuestion: parsed.nextQuestion?.trim() || (isThinTwinReply(parsedReply) ? local.nextQuestion : undefined),
      capturedStyleNotes: dedupeStrings(parsed.capturedStyleNotes),
      capturedHabits: dedupeStrings(parsed.capturedHabits),
      capturedApprovals: dedupeStrings(parsed.capturedApprovals),
      raw
    };
  } catch {
    const reply = raw.replace(match[0], "").trim().slice(0, 800);
    const local = localTwinChatReply(request);
    return {
      reply: isThinTwinReply(reply) ? local.reply : reply,
      nextQuestion: isThinTwinReply(reply) ? local.nextQuestion : undefined,
      capturedStyleNotes: [],
      capturedHabits: [],
      capturedApprovals: [],
      raw
    };
  }
}

function dedupeStrings(input: readonly string[] | undefined): readonly string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function getLatestBuilderMessage(request: TwinChatRequest): string {
  return [...request.messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
}

function isThinTwinReply(reply: string | undefined): boolean {
  const normalized = (reply ?? "").trim().toLowerCase().replace(/[.!?\s]+$/g, "");
  return (
    !normalized ||
    normalized === "listening" ||
    normalized === "noted" ||
    normalized === "captured" ||
    normalized === "heard" ||
    normalized === "i'm listening" ||
    normalized === "i am listening"
  );
}

function localTwinChatReply(request: TwinChatRequest): TwinChatResponse {
  const seed = getLatestBuilderMessage(request);
  const playful = /(?:\b(?:woo+|wahoo+|activate|prime|lets?\s*go|ship|lol)\b|<3)/i.test(seed);
  const asksAboutChat = /\b(chat|talk|reply|respond|listen|listening)\b/i.test(seed);
  const followUp = seed
    ? "What are we building first: app, agent, automation, game, or something stranger?"
    : "What kind of project do you usually build, and what's the vibe you want today?";
  const reply = !seed
    ? "Hey, I'm BuildBotPrime. I'll mirror how you build, and I'll actually talk with you while I learn your style."
    : asksAboutChat
      ? "Yep, I should chat back too. I'll keep learning your builder style in the background, but up front this should feel like a real twin conversation."
      : playful
        ? "Prime time detected. I'm here with you, not just taking notes - that reads playful, high-energy, ship-mode."
        : "I'm with you. I'll use this calibration chat to respond in the moment and quietly shape the builder profile behind it.";
  return {
    reply,
    nextQuestion: followUp,
    capturedStyleNotes: [],
    capturedHabits: [],
    capturedApprovals: [],
    raw: ""
  };
}

app.whenReady().then(async () => {
  loadBuildBotPrimeEnv();
  captureEnvFileKeys();
  applyKeychainToEnv();

  Menu.setApplicationMenu(process.platform === "darwin" ? buildAppMenu() : null);

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
