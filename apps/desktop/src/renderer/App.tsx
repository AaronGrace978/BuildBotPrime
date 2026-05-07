import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  DEFAULT_BEHAVIOR_PROFILE,
  type BuilderRequest,
  type BuilderSession,
  type IdeProductId
} from "@buildbotprime/core";
import type { IdeAction } from "@buildbotprime/ide-adapters";
import type {
  AgenticModelProfile,
  ModelProviderId,
  ModelProviderBootstrap,
  ProviderRuntimeConfig
} from "@buildbotprime/model-providers";
import type { ProductPlaybook } from "@buildbotprime/product-knowledge";
import type { TwinMindEvent, TwinMindStateSnapshot } from "@buildbotprime/twin-mind";
import type {
  AutomationResult,
  DocumentIntakeFile,
  ProviderSettingsState,
  TwinChatMessage
} from "../shared/ipc.js";

const defaultPrompt =
  "Build my project like my mirror builder twin: open the IDE, inspect the repo, prompt it in my style, run it locally, fix errors, and keep me in the loop.";

type NavKey =
  | "builder"
  | "chat"
  | "twin-mind"
  | "sessions"
  | "models"
  | "playbooks"
  | "settings";

interface TwinChatTurn extends TwinChatMessage {
  readonly id: string;
  readonly timestamp: string;
}

const ONBOARDING_OPENERS: readonly string[] = [
  "Hey — I'm BuildBotPrime, your mirror twin. Talk to me a little so I can feel out how you build. What kind of project is on your mind?",
  "Quick one: when you write a prompt for an AI IDE, do you stay terse and direct, or do you set the scene first?",
  "Got it. How do you like file structure to look when something new gets created — separate folders per feature, flat, or however the framework defaults?"
];

type BridgeState = "probing" | "ready" | "missing";

type ThemePreference = "system" | "dark" | "light";

const IDE_ORDER: readonly IdeProductId[] = [
  "cursor",
  "claude-code",
  "agentprime",
  "windsurf",
  "codex",
  "lovable"
];

export function App(): ReactElement {
  const [playbooks, setPlaybooks] = useState<readonly ProductPlaybook[]>([]);
  const [modelProviders, setModelProviders] = useState<ModelProviderBootstrap | undefined>();
  const [sessions, setSessions] = useState<readonly BuilderSession[]>([]);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [styleNotes, setStyleNotes] = useState(DEFAULT_BEHAVIOR_PROFILE.promptStyle.join("\n"));
  const [projectPath, setProjectPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [preferredIde, setPreferredIde] = useState<IdeProductId>("cursor");
  const [modelProfile, setModelProfile] = useState("");
  const [steeringModelId, setSteeringModelId] = useState("");
  const [plannedActions, setPlannedActions] = useState<readonly IdeAction[]>([]);
  const [automationResult, setAutomationResult] = useState<AutomationResult | undefined>();
  const [activeSession, setActiveSession] = useState<BuilderSession | undefined>();
  const [intakeDocs, setIntakeDocs] = useState<readonly DocumentIntakeFile[]>([]);
  const [bridgeState, setBridgeState] = useState<BridgeState>("probing");
  const [bootstrapError, setBootstrapError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nav, setNav] = useState<NavKey>("builder");
  const [providerSettings, setProviderSettings] = useState<readonly ProviderSettingsState[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<ModelProviderId | "all">("all");
  const [keychainEncrypted, setKeychainEncrypted] = useState(false);
  const [twinMind, setTwinMind] = useState<TwinMindStateSnapshot | undefined>();
  const [twinMindStarting, setTwinMindStarting] = useState(false);
  const [twinMindAutoApprove, setTwinMindAutoApprove] = useState(false);
  const [twinMindUserMessage, setTwinMindUserMessage] = useState("");
  const [twinMindError, setTwinMindError] = useState<string | undefined>();

  const [chatTurns, setChatTurns] = useState<readonly TwinChatTurn[]>(() => [
    {
      id: `chat_seed_${Date.now()}`,
      role: "assistant",
      content: ONBOARDING_OPENERS[0],
      timestamp: new Date().toISOString()
    }
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | undefined>();
  const [chatNextQuestion, setChatNextQuestion] = useState<string | undefined>(
    ONBOARDING_OPENERS[1]
  );
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const stored = window.localStorage.getItem("buildbotprime:theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const bootstrapRequestedRef = useRef(false);

  const loadBootstrap = useCallback(async (): Promise<void> => {
    if (!window.buildBotPrime) {
      return;
    }
    try {
      const payload = await window.buildBotPrime.getBootstrap();
      setPlaybooks(payload.playbooks);
      setModelProviders(payload.modelProviders);
      setSteeringModelId((existing) => existing || payload.modelProviders.defaultModelId);
      setSessions(payload.sessions);
      setProviderSettings(payload.providerSettings);
      setActiveProviderId(payload.activeProviderId);
      setKeychainEncrypted(payload.keychainEncrypted);
      setBootstrapError(undefined);
    } catch (error: unknown) {
      setBootstrapError(
        error instanceof Error ? error.message : "Failed to load BuildBotPrime bootstrap data."
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40;

    const probe = (): void => {
      if (cancelled) return;
      if (window.buildBotPrime) {
        setBridgeState("ready");
        if (!bootstrapRequestedRef.current) {
          bootstrapRequestedRef.current = true;
          void loadBootstrap();
        }
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        setBridgeState("missing");
        return;
      }
      setTimeout(probe, 75);
    };

    probe();

    return () => {
      cancelled = true;
    };
  }, [loadBootstrap]);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = theme;
    }
    window.localStorage.setItem("buildbotprime:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!window.buildBotPrime?.twinMindOnEvent) return;
    const dispose = window.buildBotPrime.twinMindOnEvent((event: TwinMindEvent) => {
      switch (event.type) {
        case "stopped": {
          setTwinMind(event.snapshot);
          setTwinMindError(event.reason || undefined);
          break;
        }
        default: {
          if ("snapshot" in event) {
            setTwinMind(event.snapshot);
          }
          break;
        }
      }
    });
    return () => {
      dispose();
    };
  }, []);

  const startTwinMind = useCallback(async (): Promise<void> => {
    if (!window.buildBotPrime?.twinMindStart) {
      setBridgeState("missing");
      return;
    }
    setTwinMindError(undefined);
    setTwinMindStarting(true);
    try {
      const promptWithIntake = createPromptWithIntake(prompt, intakeDocs);
      const intakeText = intakeDocs
        .filter((file) => file.content && !file.error)
        .map((file) => `# ${file.name}\n${file.content}`)
        .join("\n\n");
      const request: BuilderRequest = {
        prompt: promptWithIntake,
        projectPath: projectPath.trim() || undefined,
        repoUrl: repoUrl.trim() || undefined,
        preferredIde,
        modelProfile: modelProfile.trim() || undefined,
        steeringModelId,
        behaviorProfile: {
          ...DEFAULT_BEHAVIOR_PROFILE,
          promptStyle: styleNotes
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        },
        intent: "create"
      };
      const response = await window.buildBotPrime.twinMindStart({
        request,
        intakeText,
        autoApprove: twinMindAutoApprove,
        autoLaunchIde: true
      });
      setTwinMind(response.snapshot);
      setNav("twin-mind");
    } catch (error: unknown) {
      setTwinMindError(error instanceof Error ? error.message : "Failed to start twin mind.");
    } finally {
      setTwinMindStarting(false);
    }
  }, [
    intakeDocs,
    modelProfile,
    preferredIde,
    projectPath,
    prompt,
    repoUrl,
    steeringModelId,
    styleNotes,
    twinMindAutoApprove
  ]);

  const stopTwinMind = useCallback(
    async (reason: string): Promise<void> => {
      if (!twinMind || !window.buildBotPrime?.twinMindStop) return;
      await window.buildBotPrime.twinMindStop(twinMind.sessionId, reason);
    },
    [twinMind]
  );

  const pickTwinMindVariant = useCallback(
    async (variantId: string): Promise<void> => {
      if (!twinMind || !window.buildBotPrime?.twinMindPickVariant) return;
      await window.buildBotPrime.twinMindPickVariant(twinMind.sessionId, variantId);
    },
    [twinMind]
  );

  const approveTwinMind = useCallback(
    async (approvalId: string, approve: boolean): Promise<void> => {
      if (!twinMind || !window.buildBotPrime?.twinMindApprove) return;
      await window.buildBotPrime.twinMindApprove(twinMind.sessionId, approvalId, approve);
    },
    [twinMind]
  );

  const sendTwinMindMessage = useCallback(async (): Promise<void> => {
    if (!twinMind || !window.buildBotPrime?.twinMindSendMessage) return;
    const text = twinMindUserMessage.trim();
    if (!text) return;
    await window.buildBotPrime.twinMindSendMessage(twinMind.sessionId, text);
    setTwinMindUserMessage("");
  }, [twinMind, twinMindUserMessage]);

  const appendStyleNotes = useCallback((notes: readonly string[]) => {
    if (notes.length === 0) return;
    setStyleNotes((existing) => {
      const lines = existing
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const seen = new Set(lines.map((line) => line.toLowerCase()));
      for (const note of notes) {
        const trimmed = note.trim();
        if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
        seen.add(trimmed.toLowerCase());
        lines.push(trimmed);
      }
      return lines.join("\n");
    });
  }, []);

  const sendChatMessage = useCallback(async (): Promise<void> => {
    const text = chatDraft.trim();
    if (!text || chatBusy) return;
    if (!window.buildBotPrime?.twinMindChat) {
      setChatError("Twin chat bridge is offline. Restart BuildBotPrime.");
      return;
    }

    const userTurn: TwinChatTurn = {
      id: `chat_user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString()
    };
    const transcript: readonly TwinChatTurn[] = [...chatTurns, userTurn];
    setChatTurns(transcript);
    setChatDraft("");
    setChatBusy(true);
    setChatError(undefined);

    try {
      const behaviorNotes = styleNotes
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const response = await window.buildBotPrime.twinMindChat({
        steeringModelId: steeringModelId || (modelProviders?.defaultModelId ?? ""),
        messages: transcript.map((turn) => ({ role: turn.role, content: turn.content })),
        behaviorNotes,
        projectPath: projectPath.trim() || undefined,
        mode: transcript.length <= 4 ? "onboard" : "chat"
      });

      const reply =
        response.reply.trim() ||
        "I'm here with you. Tell me what you want BuildBotPrime to become, and I'll keep shaping the twin around it.";
      setChatTurns((existing) => [
        ...existing,
        {
          id: `chat_assistant_${Date.now()}`,
          role: "assistant",
          content: reply,
          timestamp: new Date().toISOString()
        }
      ]);
      setChatNextQuestion(response.nextQuestion);
      appendStyleNotes(response.capturedStyleNotes);
      if (response.capturedHabits.length > 0) {
        appendStyleNotes(response.capturedHabits);
      }
    } catch (error: unknown) {
      setChatError(error instanceof Error ? error.message : "Twin chat failed.");
    } finally {
      setChatBusy(false);
    }
  }, [
    appendStyleNotes,
    chatBusy,
    chatDraft,
    chatTurns,
    modelProviders,
    projectPath,
    steeringModelId,
    styleNotes
  ]);

  const resetChat = useCallback((): void => {
    setChatTurns([
      {
        id: `chat_seed_${Date.now()}`,
        role: "assistant",
        content: ONBOARDING_OPENERS[0],
        timestamp: new Date().toISOString()
      }
    ]);
    setChatNextQuestion(ONBOARDING_OPENERS[1]);
    setChatDraft("");
    setChatError(undefined);
  }, []);

  const selectedPlaybook = useMemo(() => {
    return playbooks.find((playbook) => playbook.id === preferredIde);
  }, [playbooks, preferredIde]);

  const selectedModel = useMemo<AgenticModelProfile | undefined>(() => {
    return modelProviders?.models.find((model) => model.id === steeringModelId);
  }, [modelProviders, steeringModelId]);

  const ollamaProvider = useMemo<ProviderRuntimeConfig | undefined>(() => {
    return modelProviders?.providers.find((provider) => provider.id === "ollama-cloud");
  }, [modelProviders]);

  const configuredProviderCount = useMemo(() => {
    return modelProviders?.providers.filter((provider) => provider.isConfigured).length ?? 0;
  }, [modelProviders]);

  const availableModels = useMemo(() => {
    const models = modelProviders?.models ?? [];
    if (activeProviderId === "all") {
      return models;
    }
    return models.filter((model) => model.provider === activeProviderId);
  }, [activeProviderId, modelProviders]);

  const activeProvider = useMemo<ProviderRuntimeConfig | undefined>(() => {
    if (activeProviderId === "all") {
      return undefined;
    }
    return modelProviders?.providers.find((provider) => provider.id === activeProviderId);
  }, [activeProviderId, modelProviders]);

  const providerLabel = activeProvider?.label ?? "All providers";

  const orderedPlaybooks = useMemo(() => {
    const index = new Map(IDE_ORDER.map((id, i) => [id, i] as const));
    return [...playbooks].sort(
      (a, b) => (index.get(a.id) ?? 99) - (index.get(b.id) ?? 99)
    );
  }, [playbooks]);

  useEffect(() => {
    if (availableModels.length === 0) return;
    if (!availableModels.some((model) => model.id === steeringModelId)) {
      setSteeringModelId(availableModels[0].id);
    }
  }, [availableModels, steeringModelId]);

  async function startBuild(): Promise<void> {
    if (!window.buildBotPrime) {
      setBridgeState("missing");
      return;
    }

    setIsSubmitting(true);
    try {
      const promptWithIntake = createPromptWithIntake(prompt, intakeDocs);
      const request: BuilderRequest = {
        prompt: promptWithIntake,
        projectPath: projectPath.trim() || undefined,
        repoUrl: repoUrl.trim() || undefined,
        preferredIde,
        modelProfile: modelProfile.trim() || undefined,
        steeringModelId,
        behaviorProfile: {
          ...DEFAULT_BEHAVIOR_PROFILE,
          promptStyle: styleNotes
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        },
        intent: "create"
      };

      const response = await window.buildBotPrime.startBuild(request);
      setActiveSession(response.session);
      setPlannedActions(response.plannedActions);
      setAutomationResult(response.automationResult);
      setSessions((existing) => [response.session, ...existing]);
    } catch (error: unknown) {
      setBootstrapError(
        error instanceof Error ? error.message : "Failed to start the builder loop."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function browseProjectFolder(): Promise<void> {
    if (!window.buildBotPrime) {
      setBridgeState("missing");
      return;
    }
    const selection = await window.buildBotPrime.selectProjectFolder();
    if (selection.canceled || !selection.path) return;
    setProjectPath(selection.path);
    if (selection.detection) {
      const command = selection.detection.devCommand ?? selection.detection.buildCommand ?? "No runnable script detected";
      setBootstrapError(undefined);
      setAutomationResult({
        target: "project-intake",
        status: "executed",
        prompt: "",
        promptCopied: false,
        launched: false,
        handoffAttempted: false,
        events: [
          {
            kind: "success",
            label: "Project detected",
            detail: `${selection.detection.packageManager} project. Next command: ${command}.`,
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
    if (selection.error) {
      setBootstrapError(selection.error);
    }
  }

  async function attachIntakeDocuments(): Promise<void> {
    if (!window.buildBotPrime) {
      setBridgeState("missing");
      return;
    }
    const selection = await window.buildBotPrime.selectIntakeDocuments();
    if (selection.canceled) return;
    setIntakeDocs((existing) => [...existing, ...selection.files]);
  }

  function removeIntakeDocument(path: string): void {
    setIntakeDocs((existing) => existing.filter((file) => file.path !== path));
  }

  async function saveProviderSettings(
    providerId: ModelProviderId,
    values: Record<string, string>
  ): Promise<void> {
    if (!window.buildBotPrime) {
      setBridgeState("missing");
      return;
    }
    try {
      const result = await window.buildBotPrime.saveProviderSettings(providerId, values);
      setModelProviders(result.modelProviders);
      setProviderSettings(result.providerSettings);
      setBootstrapError(undefined);
    } catch (error: unknown) {
      setBootstrapError(
        error instanceof Error ? error.message : "Failed to save provider settings."
      );
    }
  }

  async function clearProviderSettings(providerId: ModelProviderId): Promise<void> {
    if (!window.buildBotPrime) {
      setBridgeState("missing");
      return;
    }
    try {
      const result = await window.buildBotPrime.clearProviderSettings(providerId);
      setModelProviders(result.modelProviders);
      setProviderSettings(result.providerSettings);
      setBootstrapError(undefined);
    } catch (error: unknown) {
      setBootstrapError(
        error instanceof Error ? error.message : "Failed to clear provider settings."
      );
    }
  }

  async function setActiveProvider(providerId: ModelProviderId | "all"): Promise<void> {
    setActiveProviderId(providerId);
    if (!window.buildBotPrime) return;
    await window.buildBotPrime.setActiveProvider(providerId);
  }

  function cycleTheme(): void {
    setTheme((current) => {
      if (current === "system") return "dark";
      if (current === "dark") return "light";
      return "system";
    });
  }

  if (bridgeState === "probing") {
    return (
      <main className="splash">
        <div className="splash-card">
          <BrandLogo size={40} />
          <strong>BuildBotPrime</strong>
          <small>Connecting to the Electron bridge…</small>
          <div className="splash-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
      </main>
    );
  }

  if (bridgeState === "missing") {
    return (
      <main className="splash">
        <div className="splash-card error">
          <div className="splash-icon">
            <IconAlert />
          </div>
          <strong>Bridge offline</strong>
          <p>
            The Electron preload bridge isn’t exposing <code>window.buildBotPrime</code>. This
            usually means the main process needs to be rebuilt, or the window loaded before the
            preload was compiled.
          </p>
          <ol>
            <li>
              Run <code>npm run build:main</code> from the project root.
            </li>
            <li>
              Close any stray <code>electron.exe</code> processes, then relaunch{" "}
              <code>BuildBotPrime.bat</code>.
            </li>
            <li>Reload this window once Electron is back up.</li>
          </ol>
          <div className="splash-actions">
            <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
              Reload window
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setBridgeState("probing");
                bootstrapRequestedRef.current = false;
                setTimeout(() => {
                  if (window.buildBotPrime) {
                    setBridgeState("ready");
                    bootstrapRequestedRef.current = true;
                    void loadBootstrap();
                  } else {
                    setBridgeState("missing");
                  }
                }, 200);
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  const selectedIdeLabel = selectedPlaybook?.displayName ?? ideLabel(preferredIde);
  const steeringLabel = selectedModel?.label ?? "Select steering model";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandLogo size={30} />
          <div className="sidebar-brand-text">
            <strong>BuildBotPrime</strong>
            <small>Made in Boston · Built for builders</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavItem
            icon={<IconSpark />}
            label="Builder"
            hint="Compose a run"
            active={nav === "builder"}
            onClick={() => setNav("builder")}
          />
          <NavItem
            icon={<IconChat />}
            label="Chat"
            hint="Calibrate your twin"
            active={nav === "chat"}
            onClick={() => setNav("chat")}
          />
          <NavItem
            icon={<IconMind />}
            label="Twin Mind"
            hint={twinMind ? `${twinMind.status} · iter ${twinMind.iteration}` : "Mirror builder loop"}
            active={nav === "twin-mind"}
            onClick={() => setNav("twin-mind")}
          />
          <NavItem
            icon={<IconHistory />}
            label="Sessions"
            hint={`${sessions.length} saved`}
            active={nav === "sessions"}
            onClick={() => setNav("sessions")}
          />
          <NavItem
            icon={<IconBrain />}
            label="Models"
            hint={`${modelProviders?.models.length ?? 0} profiles`}
            active={nav === "models"}
            onClick={() => setNav("models")}
          />
          <NavItem
            icon={<IconBook />}
            label="Playbooks"
            hint={`${orderedPlaybooks.length} IDE targets`}
            active={nav === "playbooks"}
            onClick={() => setNav("playbooks")}
          />
          <NavItem
            icon={<IconPlug />}
            label="Providers"
            hint={`${configuredProviderCount} configured`}
            active={nav === "settings"}
            onClick={() => setNav("settings")}
          />
        </nav>

        <div className="sidebar-footer">
          <StatusLine label="Provider" value={providerLabel} tone="info" />
          <StatusLine label="Keychain" value={keychainEncrypted ? "Encrypted" : "Fallback"} tone={keychainEncrypted ? "ok" : "warn"} />
          <StatusLine label="Model" value={steeringLabel} tone="info" />
          <StatusLine label="IDE" value={selectedIdeLabel} tone="info" />
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="crumb">{sectionTitle(nav)}</span>
            <h1>{sectionHeadline(nav)}</h1>
          </div>
          <div className="topbar-meta">
            {bootstrapError ? (
              <span className="chip chip-error" title={bootstrapError}>
                <IconAlert />
                {bootstrapError.length > 42 ? `${bootstrapError.slice(0, 42)}…` : bootstrapError}
              </span>
            ) : null}
            <span className="chip">
              <IconDot />
              {sessions.length} sessions
            </span>
            <span className="chip">
              <IconDot />
              {configuredProviderCount} providers
            </span>
            <label className="topbar-select">
              <span>Provider</span>
              <select
                value={activeProviderId}
                onChange={(event) => {
                  void setActiveProvider(event.target.value as ModelProviderId | "all");
                }}
              >
                <option value="all">All providers</option>
                {modelProviders?.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="icon-button" onClick={cycleTheme} title={`Theme: ${theme}`}>
              <IconTheme />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                void window.buildBotPrime?.toggleDevTools();
              }}
              title="Toggle Developer Tools"
            >
              <IconTerminal />
            </button>
            <span className={`chip ${ollamaProvider?.isConfigured ? "chip-ok" : "chip-warn"}`}>
              <IconDot />
              {ollamaProvider?.isConfigured ? "Ollama ready" : "Ollama key missing"}
            </span>
          </div>
        </header>

        {nav === "builder" ? (
          <BuilderView
            prompt={prompt}
            setPrompt={setPrompt}
            styleNotes={styleNotes}
            setStyleNotes={setStyleNotes}
            projectPath={projectPath}
            setProjectPath={setProjectPath}
            repoUrl={repoUrl}
            setRepoUrl={setRepoUrl}
            preferredIde={preferredIde}
            setPreferredIde={setPreferredIde}
            modelProfile={modelProfile}
            setModelProfile={setModelProfile}
            steeringModelId={steeringModelId}
            setSteeringModelId={setSteeringModelId}
            modelProviders={modelProviders}
            availableModels={availableModels}
            activeProviderId={activeProviderId}
            setActiveProvider={(providerId) => {
              void setActiveProvider(providerId);
            }}
            orderedPlaybooks={orderedPlaybooks}
            selectedPlaybook={selectedPlaybook}
            selectedModel={selectedModel}
            plannedActions={plannedActions}
            automationResult={automationResult}
            activeSession={activeSession}
            sessions={sessions}
            intakeDocs={intakeDocs}
            isSubmitting={isSubmitting}
            twinMindAutoApprove={twinMindAutoApprove}
            setTwinMindAutoApprove={setTwinMindAutoApprove}
            twinMindStarting={twinMindStarting}
            onLaunchTwinMind={() => {
              void startTwinMind();
            }}
            onBrowseProject={browseProjectFolder}
            onAttachDocuments={attachIntakeDocuments}
            onRemoveDocument={removeIntakeDocument}
            onSubmit={() => {
              void startBuild();
            }}
          />
        ) : null}

        {nav === "chat" ? (
          <TwinChatView
            turns={chatTurns}
            draft={chatDraft}
            setDraft={setChatDraft}
            busy={chatBusy}
            error={chatError}
            nextQuestion={chatNextQuestion}
            steeringLabel={selectedModel?.label}
            styleNotes={styleNotes}
            setStyleNotes={setStyleNotes}
            onSend={() => {
              void sendChatMessage();
            }}
            onReset={resetChat}
          />
        ) : null}

        {nav === "twin-mind" ? (
          <TwinMindView
            snapshot={twinMind}
            error={twinMindError}
            isStarting={twinMindStarting}
            userMessage={twinMindUserMessage}
            setUserMessage={setTwinMindUserMessage}
            onSendMessage={() => {
              void sendTwinMindMessage();
            }}
            onPickVariant={(variantId) => {
              void pickTwinMindVariant(variantId);
            }}
            onApprove={(approvalId, approve) => {
              void approveTwinMind(approvalId, approve);
            }}
            onStop={() => {
              void stopTwinMind("manual-stop");
            }}
            onStart={() => {
              void startTwinMind();
            }}
          />
        ) : null}

        {nav === "sessions" ? (
          <SessionsView sessions={sessions} activeSession={activeSession} />
        ) : null}

        {nav === "models" ? (
          <ModelsView
            modelProviders={modelProviders}
            availableModels={availableModels}
            activeProviderId={activeProviderId}
            setActiveProvider={(providerId) => {
              void setActiveProvider(providerId);
            }}
            steeringModelId={steeringModelId}
            setSteeringModelId={setSteeringModelId}
          />
        ) : null}

        {nav === "playbooks" ? (
          <PlaybooksView
            playbooks={orderedPlaybooks}
            preferredIde={preferredIde}
            setPreferredIde={setPreferredIde}
          />
        ) : null}

        {nav === "settings" ? (
          <ProvidersView
            modelProviders={modelProviders}
            providerSettings={providerSettings}
            activeProviderId={activeProviderId}
            keychainEncrypted={keychainEncrypted}
            onSelectProvider={(providerId) => {
              void setActiveProvider(providerId);
            }}
            onSave={(providerId, values) => {
              void saveProviderSettings(providerId, values);
            }}
            onClear={(providerId) => {
              void clearProviderSettings(providerId);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

interface BuilderViewProps {
  prompt: string;
  setPrompt: (value: string) => void;
  styleNotes: string;
  setStyleNotes: (value: string) => void;
  projectPath: string;
  setProjectPath: (value: string) => void;
  repoUrl: string;
  setRepoUrl: (value: string) => void;
  preferredIde: IdeProductId;
  setPreferredIde: (value: IdeProductId) => void;
  modelProfile: string;
  setModelProfile: (value: string) => void;
  steeringModelId: string;
  setSteeringModelId: (value: string) => void;
  modelProviders?: ModelProviderBootstrap;
  availableModels: readonly AgenticModelProfile[];
  activeProviderId: ModelProviderId | "all";
  setActiveProvider: (value: ModelProviderId | "all") => void;
  orderedPlaybooks: readonly ProductPlaybook[];
  selectedPlaybook?: ProductPlaybook;
  selectedModel?: AgenticModelProfile;
  plannedActions: readonly IdeAction[];
  automationResult?: AutomationResult;
  activeSession?: BuilderSession;
  sessions: readonly BuilderSession[];
  intakeDocs: readonly DocumentIntakeFile[];
  isSubmitting: boolean;
  twinMindAutoApprove: boolean;
  setTwinMindAutoApprove: (value: boolean) => void;
  twinMindStarting: boolean;
  onLaunchTwinMind: () => void;
  onBrowseProject: () => void;
  onAttachDocuments: () => void;
  onRemoveDocument: (path: string) => void;
  onSubmit: () => void;
}

function BuilderView(props: BuilderViewProps): ReactElement {
  const {
    prompt,
    setPrompt,
    styleNotes,
    setStyleNotes,
    projectPath,
    setProjectPath,
    repoUrl,
    setRepoUrl,
    preferredIde,
    setPreferredIde,
    modelProfile,
    setModelProfile,
    steeringModelId,
    setSteeringModelId,
    modelProviders,
    availableModels,
    activeProviderId,
    setActiveProvider,
    orderedPlaybooks,
    selectedPlaybook,
    selectedModel,
    plannedActions,
    automationResult,
    activeSession,
    sessions,
    intakeDocs,
    isSubmitting,
    twinMindAutoApprove,
    setTwinMindAutoApprove,
    twinMindStarting,
    onLaunchTwinMind,
    onBrowseProject,
    onAttachDocuments,
    onRemoveDocument,
    onSubmit
  } = props;

  return (
    <div className="builder">
      <section className="hero">
        <div className="hero-body">
          <span className="eyebrow">
            <IconSpark />
            Builder loop · BostonAI
          </span>
          <h2>Empowering builders. Empowering ships.</h2>
          <p>
            Describe the outcome. BuildBotPrime drives your chosen IDE — Cursor, Claude Code,
            AgentPrime, Windsurf, Codex, or Lovable — in your own voice, observes the work, and
            loops the errors back until the project runs. Human-first, civic-clean, no hype.
          </p>
          <div className="hero-chips">
            <span className="hero-chip">
              <small>IDE</small>
              <strong>{selectedPlaybook?.displayName ?? ideLabel(preferredIde)}</strong>
            </span>
            <span className="hero-chip">
              <small>Steering</small>
              <strong>{selectedModel?.label ?? "—"}</strong>
            </span>
            <span className="hero-chip">
              <small>Behavior</small>
              <strong>{DEFAULT_BEHAVIOR_PROFILE.name}</strong>
            </span>
          </div>
        </div>
        <div className="hero-deck">
          <div className="deck-row">
            <span className="deck-label">
              <span className="pulse" /> Live deck
            </span>
            <span className="deck-kbd">
              <kbd>⌘</kbd>
              <kbd>⏎</kbd>
            </span>
          </div>
          <div className="deck-title">
            {activeSession ? activeSession.state.nextAction : "Waiting for first build"}
          </div>
          <div className="deck-body">
            {activeSession
              ? `Status ${activeSession.state.status} · attempt ${activeSession.state.attempt}`
              : "Compose a prompt and launch the loop to see your twin work."}
          </div>
          <div className="deck-stats">
            <div>
              <small>Planned actions</small>
              <strong>{plannedActions.length}</strong>
            </div>
            <div>
              <small>Events logged</small>
              <strong>{activeSession?.events.length ?? 0}</strong>
            </div>
            <div>
              <small>Sessions</small>
              <strong>{sessions.length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid-2-1">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <CardHeader
            badge="01"
            eyebrow="Input"
            title="Builder chat"
            description="What the twin should say when it opens your IDE."
          />

          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={6}
              placeholder="Describe the outcome you want built."
            />
          </Field>

          <Field label="Behavioral pattern notes" hint="One line per habit.">
            <textarea
              value={styleNotes}
              onChange={(event) => setStyleNotes(event.target.value)}
              rows={4}
              placeholder="How should BuildBotPrime sound and steer?"
            />
          </Field>

          <div className="field-row">
            <Field label="Local project path">
              <div className="input-action">
                <input
                  value={projectPath}
                  onChange={(event) => setProjectPath(event.target.value)}
                  placeholder="G:\Projects\my-app"
                  spellCheck={false}
                />
                <button type="button" className="btn-secondary" onClick={onBrowseProject}>
                  Browse
                </button>
              </div>
            </Field>
            <Field label="GitHub repo URL">
              <input
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/user/repo"
                spellCheck={false}
              />
            </Field>
          </div>

          <div className="intake-panel">
            <div className="intake-head">
              <div>
                <strong>Document intake</strong>
                <span>Attach PDFs, Word docs, specs, notes, logs, tickets, or project context. These are injected into the build prompt.</span>
              </div>
              <button type="button" className="btn-secondary" onClick={onAttachDocuments}>
                Attach docs
              </button>
            </div>
            {intakeDocs.length > 0 ? (
              <div className="intake-list">
                {intakeDocs.map((file) => (
                  <div key={file.path} className={`intake-file ${file.error ? "has-error" : ""}`}>
                    <div>
                      <strong>{file.name}</strong>
                      <span>
                        {file.error
                          ? file.error
                          : `${formatBytes(file.bytes)}${file.truncated ? " · truncated" : ""}`}
                      </span>
                    </div>
                    <button type="button" onClick={() => onRemoveDocument(file.path)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No documents attached yet.</p>
            )}
          </div>

          <div className="field-row">
            <Field label="IDE target">
              <select
                value={preferredIde}
                onChange={(event) => setPreferredIde(event.target.value as IdeProductId)}
              >
                {orderedPlaybooks.map((playbook) => (
                  <option key={playbook.id} value={playbook.id}>
                    {playbook.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="IDE model override" hint="Optional">
              <input
                value={modelProfile}
                onChange={(event) => setModelProfile(event.target.value)}
                placeholder="Use steering model recommendation"
                spellCheck={false}
              />
            </Field>
          </div>

          <div className="field-row">
            <Field label="Model provider">
              <select
                value={activeProviderId}
                onChange={(event) => setActiveProvider(event.target.value as ModelProviderId | "all")}
              >
                <option value="all">All configured providers</option>
                {modelProviders?.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                    {provider.isConfigured ? "" : " (not configured)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="BuildBotPrime steering model">
              <select
                value={steeringModelId}
                onChange={(event) => setSteeringModelId(event.target.value)}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-footer">
            <span className="form-hint">
              Your mirror twin will open <strong>{selectedPlaybook?.displayName ?? "the IDE"}</strong>
              {selectedModel ? (
                <>
                  {" "}
                  and steer with <strong>{selectedModel.label}</strong>
                </>
              ) : null}
              .
            </span>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Starting…" : "Start builder loop"}
              <IconArrowRight />
            </button>
          </div>

          <div className="twin-launch">
            <div>
              <strong>Twin mind autopilot</strong>
              <span className="muted">
                Ponders multiple builds, picks one, drives the IDE in real time, swaps models per
                phase, and reflects on every error. Mirrors the way you build.
              </span>
            </div>
            <div className="twin-launch-controls">
              <label className="twin-toggle">
                <input
                  type="checkbox"
                  checked={twinMindAutoApprove}
                  onChange={(event) => setTwinMindAutoApprove(event.target.checked)}
                />
                <span>Hog wild (auto approve)</span>
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={twinMindStarting}
                onClick={(event) => {
                  event.preventDefault();
                  onLaunchTwinMind();
                }}
              >
                {twinMindStarting ? "Pondering…" : "Launch twin mind"}
                <IconArrowRight />
              </button>
            </div>
          </div>
        </form>

        <aside className="stack">
          <div className="card">
            <CardHeader badge="02" eyebrow="Playbook" title={selectedPlaybook?.displayName ?? "Playbook"} />
            {selectedPlaybook ? (
              <>
                <p className="muted">{selectedPlaybook.promptDelivery.steps.join(" ")}</p>
                <div className="pill-list">
                  {selectedPlaybook.supportedSurfaces.map((surface) => (
                    <span key={surface.id} className="pill">
                      <IconDot />
                      {surface.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Loading playbook…</p>
            )}
          </div>

          <div className="card">
            <CardHeader badge="03" eyebrow="Brain" title={selectedModel?.label ?? "Steering model"} />
            {selectedModel ? (
              <>
                <p className="muted">{selectedModel.description}</p>
                <div className="pill-list">
                  {selectedModel.strengths.map((strength) => (
                    <span key={strength} className="pill pill-muted">
                      {strength}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Loading models…</p>
            )}
          </div>
        </aside>
      </section>

      <section className="grid-2-1">
        <div className="card">
          <CardHeader
            badge="04"
            eyebrow="Plan"
            title="Planned automation"
            description="How the twin will drive the IDE once the loop starts."
          />
          {plannedActions.length === 0 ? (
            <EmptyState
              title="No plan yet"
              body="Start a build to see the exact IDE automation sequence appear here."
            />
          ) : (
            <ol className="timeline">
              {plannedActions.map((action, index) => (
                <li key={`${action.kind}-${action.label}-${index}`} className="timeline-item">
                  <div className="timeline-dot">{index + 1}</div>
                  <div className="timeline-content">
                    <div className="timeline-head">
                      <span className="kind-tag">{action.kind}</span>
                      <h3>{action.label}</h3>
                      {action.requiresUserApproval ? (
                        <span className="kind-tag kind-tag-warn">needs approval</span>
                      ) : null}
                    </div>
                    <p>{action.details}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card">
          <CardHeader badge="05" eyebrow="State" title="Session memory" />
          {activeSession ? (
            <div className="session-card">
              <strong>{activeSession.state.nextAction}</strong>
              <div className="meta-row">
                <Meta label="Status" value={activeSession.state.status} />
                <Meta label="Attempt" value={String(activeSession.state.attempt)} />
              </div>
              <div className="meta-row">
                <Meta label="Events" value={String(activeSession.events.length)} />
                <Meta label="IDE" value={ideLabel(activeSession.state.activeIde)} />
              </div>
            </div>
          ) : (
            <EmptyState
              title={`${sessions.length} saved sessions`}
              body="Your next run lights up here the moment you launch the loop."
            />
          )}
          {automationResult ? (
            <div className="automation-log">
              <div className="automation-log-head">
                <strong>Execution: {automationResult.status}</strong>
                <span>{automationResult.target}</span>
              </div>
              {automationResult.events.map((event) => (
                <div key={`${event.timestamp}-${event.label}`} className={`automation-event ${event.kind}`}>
                  <span>{event.label}</span>
                  <p>{event.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SessionsView({
  sessions,
  activeSession
}: {
  sessions: readonly BuilderSession[];
  activeSession?: BuilderSession;
}): ReactElement {
  return (
    <div className="card">
      <CardHeader
        badge="·"
        eyebrow="History"
        title="Builder sessions"
        description="Every build the twin has composed, ordered newest first."
      />
      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          body="Launch a build from the Builder tab to create your first session."
        />
      ) : (
        <ul className="session-list">
          {sessions.map((session) => {
            const active = activeSession?.id === session.id;
            return (
              <li key={session.id} className={`session-row ${active ? "is-active" : ""}`}>
                <div className="session-row-head">
                  <strong>{session.state.nextAction}</strong>
                  <span className="kind-tag">{session.state.status}</span>
                </div>
                <p className="muted">{session.request.prompt}</p>
                <div className="meta-row">
                  <Meta label="IDE" value={ideLabel(session.request.preferredIde)} />
                  <Meta label="Attempt" value={String(session.state.attempt)} />
                  <Meta label="Events" value={String(session.events.length)} />
                  <Meta label="Created" value={formatDate(session.createdAt)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ModelsView({
  modelProviders,
  availableModels,
  activeProviderId,
  setActiveProvider,
  steeringModelId,
  setSteeringModelId
}: {
  modelProviders?: ModelProviderBootstrap;
  availableModels: readonly AgenticModelProfile[];
  activeProviderId: ModelProviderId | "all";
  setActiveProvider: (value: ModelProviderId | "all") => void;
  steeringModelId: string;
  setSteeringModelId: (value: string) => void;
}): ReactElement {
  if (!modelProviders) {
    return (
      <div className="card">
        <EmptyState title="Loading models" body="Waiting for bootstrap to complete." />
      </div>
    );
  }
  return (
    <div className="stack-page">
      <div className="card toolbar-card">
        <CardHeader
          badge="AI"
          eyebrow="Provider"
          title="Choose which provider powers steering"
          description="Pick one provider to filter models, or show everything when comparing options."
        />
        <div className="segmented-row">
          <button
            type="button"
            className={`segment ${activeProviderId === "all" ? "is-active" : ""}`}
            onClick={() => setActiveProvider("all")}
          >
            All
          </button>
          {modelProviders.providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`segment ${activeProviderId === provider.id ? "is-active" : ""}`}
              onClick={() => setActiveProvider(provider.id)}
            >
              {provider.label}
              <span className={provider.isConfigured ? "segment-dot ok" : "segment-dot warn"} />
            </button>
          ))}
        </div>
      </div>
      <div className="grid-gallery flush">
      {availableModels.map((model) => {
        const active = model.id === steeringModelId;
        return (
          <button
            key={model.id}
            type="button"
            className={`card card-button ${active ? "is-active" : ""}`}
            onClick={() => setSteeringModelId(model.id)}
          >
            <div className="card-button-head">
              <span className="kind-tag">{model.provider}</span>
              {active ? <span className="kind-tag kind-tag-accent">steering</span> : null}
            </div>
            <h3>{model.label}</h3>
            <p className="muted">{model.description}</p>
            <div className="pill-list">
              {model.strengths.map((strength) => (
                <span key={strength} className="pill pill-muted">
                  {strength}
                </span>
              ))}
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function PlaybooksView({
  playbooks,
  preferredIde,
  setPreferredIde
}: {
  playbooks: readonly ProductPlaybook[];
  preferredIde: IdeProductId;
  setPreferredIde: (value: IdeProductId) => void;
}): ReactElement {
  return (
    <div className="grid-gallery">
      {playbooks.map((playbook) => {
        const active = playbook.id === preferredIde;
        return (
          <button
            key={playbook.id}
            type="button"
            className={`card card-button ${active ? "is-active" : ""}`}
            onClick={() => setPreferredIde(playbook.id as IdeProductId)}
          >
            <div className="card-button-head">
              <span className="kind-tag">{playbook.id}</span>
              {active ? <span className="kind-tag kind-tag-accent">active</span> : null}
            </div>
            <h3>{playbook.displayName}</h3>
            <p className="muted">
              {playbook.promptDelivery.steps[0] ?? "Configured for this builder."}
            </p>
            <div className="pill-list">
              {playbook.supportedSurfaces.slice(0, 3).map((surface) => (
                <span key={surface.id} className="pill">
                  <IconDot />
                  {surface.label}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

interface TwinChatViewProps {
  turns: readonly TwinChatTurn[];
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  error?: string;
  nextQuestion?: string;
  steeringLabel?: string;
  styleNotes: string;
  setStyleNotes: (value: string) => void;
  onSend: () => void;
  onReset: () => void;
}

function TwinChatView(props: TwinChatViewProps): ReactElement {
  const {
    turns,
    draft,
    setDraft,
    busy,
    error,
    nextQuestion,
    steeringLabel,
    styleNotes,
    setStyleNotes,
    onSend,
    onReset
  } = props;

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [turns]);

  const noteCount = useMemo(
    () =>
      styleNotes
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean).length,
    [styleNotes]
  );

  return (
    <div className="chat-view">
      <section className="card chat-hero">
        <div>
          <span className="eyebrow">
            <IconChat />
            Calibrate
          </span>
          <h2>Talk to your twin.</h2>
          <p className="muted">
            The twin learns how you build by listening. Tell it about your stack, voice, and the
            kinds of projects you ship. Anything it captures lands in your behavior profile and
            steers every future build.
          </p>
          <div className="chat-meta">
            <Meta label="Steering brain" value={steeringLabel ?? "auto"} />
            <Meta label="Captured style notes" value={String(noteCount)} />
            <Meta label="Turns" value={String(turns.filter((turn) => turn.role !== "assistant" || turn.id !== turns[0]?.id).length)} />
          </div>
        </div>
        <div className="chat-hero-actions">
          <button type="button" className="btn-secondary" onClick={onReset}>
            Reset chat
          </button>
        </div>
      </section>

      <section className="card chat-card">
        <div className="chat-stream" ref={scrollerRef}>
          {turns.map((turn) => (
            <div key={turn.id} className={`chat-bubble chat-bubble-${turn.role}`}>
              <span className="chat-role">{turn.role === "user" ? "You" : "Twin"}</span>
              <p>{turn.content}</p>
            </div>
          ))}
          {busy ? (
            <div className="chat-bubble chat-bubble-assistant chat-thinking">
              <span className="chat-role">Twin</span>
              <p>
                <span className="chat-dots">
                  <span />
                  <span />
                  <span />
                </span>
                listening…
              </p>
            </div>
          ) : null}
        </div>
        {nextQuestion && !busy ? (
          <div className="chat-suggestion">
            <span className="kind-tag kind-tag-accent">next</span>
            <span>{nextQuestion}</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDraft(nextQuestion)}
            >
              Use as draft
            </button>
          </div>
        ) : null}
        {error ? <p className="chat-error">{error}</p> : null}
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <textarea
            value={draft}
            placeholder="Tell the twin how you build…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={3}
            spellCheck
          />
          <div className="chat-input-row">
            <span className="chat-hint">⌘/Ctrl + Enter to send</span>
            <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
              {busy ? "Listening…" : "Send"}
              <IconArrowRight />
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <CardHeader
          badge="01"
          eyebrow="Captured"
          title="Behavior profile"
          description="Style and habits the twin will mirror in every prompt. Feel free to edit by hand."
        />
        <Field label="Style notes" hint="One habit per line.">
          <textarea
            value={styleNotes}
            onChange={(event) => setStyleNotes(event.target.value)}
            rows={5}
          />
        </Field>
      </section>
    </div>
  );
}

interface TwinMindViewProps {
  snapshot?: TwinMindStateSnapshot;
  error?: string;
  isStarting: boolean;
  userMessage: string;
  setUserMessage: (value: string) => void;
  onSendMessage: () => void;
  onPickVariant: (variantId: string) => void;
  onApprove: (approvalId: string, approve: boolean) => void;
  onStop: () => void;
  onStart: () => void;
}

function TwinMindView(props: TwinMindViewProps): ReactElement {
  const {
    snapshot,
    error,
    isStarting,
    userMessage,
    setUserMessage,
    onSendMessage,
    onPickVariant,
    onApprove,
    onStop,
    onStart
  } = props;

  if (!snapshot) {
    return (
      <div className="stack-page">
        <div className="card twin-empty">
          <div>
            <span className="eyebrow">
              <IconMind />
              Twin mind
            </span>
            <h2>Compose a build, then launch your twin.</h2>
            <p className="muted">
              The twin ponders four to six different ways to ship the request, picks the strongest fit,
              opens your IDE, sends prompts in your voice, observes file changes, and feeds errors
              back into the loop. Models swap automatically per phase.
            </p>
          </div>
          <div className="twin-empty-actions">
            <button type="button" className="btn-primary" disabled={isStarting} onClick={onStart}>
              {isStarting ? "Pondering…" : "Launch twin mind"}
              <IconArrowRight />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const chosenVariant = snapshot.variants.find((variant) => variant.id === snapshot.chosenVariantId);
  const recentThoughts = [...snapshot.thoughts].slice(-12).reverse();
  const recentObservations = [...snapshot.observations].slice(-10).reverse();
  const recentMessages = [...snapshot.ideMessages].slice(-12).reverse();
  const recentSwaps = [...snapshot.modelSwaps].slice(-6).reverse();

  return (
    <div className="twin-mind">
      <section className="card twin-hero">
        <div>
          <span className="eyebrow">
            <IconMind />
            Twin mind
          </span>
          <h2>{statusHeadline(snapshot.status)}</h2>
          <p className="muted">{snapshot.userPrompt}</p>
          <div className="twin-meta">
            <Meta label="Status" value={snapshot.status} />
            <Meta label="Iteration" value={`${snapshot.iteration} / ${snapshot.maxIterations}`} />
            <Meta label="Brain" value={snapshot.currentModelLabel} />
            <Meta label="IDE" value={snapshot.ideTarget} />
            <Meta label="Variants" value={String(snapshot.variants.length)} />
            <Meta label="Memory" value={String(snapshot.memory.length)} />
          </div>
        </div>
        <div className="twin-hero-controls">
          {error ? <span className="chip chip-error">{error.slice(0, 80)}</span> : null}
          <button type="button" className="btn-secondary" onClick={onStop}>
            Stop loop
          </button>
        </div>
      </section>

      {snapshot.approvalNeeded ? (
        <section className="card twin-approval">
          <div>
            <span className="eyebrow">
              <IconAlert />
              Approval needed
            </span>
            <h3>{snapshot.approvalNeeded.title}</h3>
            <p className="muted">{snapshot.approvalNeeded.detail}</p>
            <p>
              <strong>Proposed:</strong> {snapshot.approvalNeeded.proposedAction}
            </p>
          </div>
          <div className="twin-approval-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onApprove(snapshot.approvalNeeded!.id, false)}
            >
              Halt
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onApprove(snapshot.approvalNeeded!.id, true)}
            >
              Approve
              <IconArrowRight />
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid-2-1">
        <div className="card">
          <CardHeader
            badge="01"
            eyebrow="Ponder"
            title="Candidate builds"
            description="Variants the twin pondered. Pick one to commit, or trust the top score."
          />
          {snapshot.variants.length === 0 ? (
            <EmptyState title="No variants yet" body="Twin is warming up." />
          ) : (
            <ol className="variant-list">
              {snapshot.variants.map((variant, index) => {
                const active = variant.id === snapshot.chosenVariantId;
                return (
                  <li key={variant.id} className={`variant-row ${active ? "is-active" : ""}`}>
                    <button type="button" className="variant-button" onClick={() => onPickVariant(variant.id)}>
                      <div className="variant-row-head">
                        <span className="kind-tag">{`#${index + 1}`}</span>
                        <strong>{variant.flavor}</strong>
                        <span className="kind-tag kind-tag-muted">{variant.score.toFixed(2)}</span>
                        {active ? <span className="kind-tag kind-tag-accent">chosen</span> : null}
                      </div>
                      <h4>{variant.title}</h4>
                      <p className="muted">{variant.summary}</p>
                      <div className="variant-steps">
                        {variant.recommendedSteps.map((step, stepIndex) => (
                          <span key={stepIndex} className="pill pill-muted">
                            {step}
                          </span>
                        ))}
                      </div>
                      {variant.riskNotes.length > 0 ? (
                        <div className="variant-risks">
                          {variant.riskNotes.map((risk, riskIndex) => (
                            <span key={riskIndex} className="risk-note">
                              {risk}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <CardHeader badge="02" eyebrow="Plan" title="Chosen variant" />
            {chosenVariant ? (
              <>
                <h3>{chosenVariant.flavor}</h3>
                <p className="muted">{chosenVariant.summary}</p>
                <ul className="plan-steps">
                  {chosenVariant.recommendedSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState title="No variant chosen" body="Approve the top-scored variant to begin." />
            )}
          </div>
          <div className="card">
            <CardHeader badge="03" eyebrow="Models" title="Brain swaps" />
            {recentSwaps.length === 0 ? (
              <EmptyState title="No swaps yet" body="The twin will swap brains automatically per phase." />
            ) : (
              <ul className="swap-list">
                {recentSwaps.map((swap) => (
                  <li key={swap.id}>
                    <span className="kind-tag">{swap.forPhase}</span>
                    <strong>
                      {swap.fromLabel ?? swap.fromModelId ?? "—"} → {swap.toLabel}
                    </strong>
                    <span className="muted">{swap.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </section>

      <section className="grid-2-1">
        <div className="card">
          <CardHeader
            badge="04"
            eyebrow="Reflect"
            title="Thought stream"
            description="The twin's inner voice — observe, think, act, reflect."
          />
          {recentThoughts.length === 0 ? (
            <EmptyState title="Quiet for now" body="Thoughts will stream as the loop runs." />
          ) : (
            <ul className="thought-list">
              {recentThoughts.map((thought) => (
                <li key={thought.id} className={`thought thought-${thought.phase}`}>
                  <div className="thought-head">
                    <span className="kind-tag">{thought.phase}</span>
                    {thought.force ? <span className="kind-tag kind-tag-muted">{thought.force}</span> : null}
                    {thought.modelLabel ? <span className="kind-tag kind-tag-muted">{thought.modelLabel}</span> : null}
                    <small>iter {thought.iteration}</small>
                  </div>
                  <strong>{thought.headline}</strong>
                  <p>{thought.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <CardHeader badge="05" eyebrow="Watch" title="Observations" />
            {recentObservations.length === 0 ? (
              <EmptyState title="Nothing observed" body="Filesystem and IDE signals will appear here." />
            ) : (
              <ul className="obs-list">
                {recentObservations.map((observation) => (
                  <li key={observation.id} className={`obs obs-${observation.severity}`}>
                    <div className="obs-head">
                      <span className="kind-tag">{observation.source}</span>
                      <span className={`kind-tag kind-tag-${observation.severity}`}>{observation.severity}</span>
                    </div>
                    <strong>{observation.headline}</strong>
                    <p className="muted">{observation.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <CardHeader badge="06" eyebrow="Memory" title="Lessons learned" />
            {snapshot.memory.length === 0 ? (
              <EmptyState title="Empty notebook" body="Memories appear after the twin reflects." />
            ) : (
              <ul className="memory-list">
                {snapshot.memory.slice(-8).reverse().map((memory) => (
                  <li key={memory.id}>
                    <span className="kind-tag">{memory.kind}</span>
                    <span className="kind-tag kind-tag-muted">{memory.importance.toFixed(2)}</span>
                    <p>{memory.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </section>

      <section className="card">
        <CardHeader
          badge="07"
          eyebrow="Talk"
          title="IDE conversation"
          description="The real-time transcript with the IDE plus a side channel for you to speak."
        />
        {recentMessages.length === 0 ? (
          <EmptyState title="No messages yet" body="The twin will start prompting the IDE shortly." />
        ) : (
          <ul className="ide-message-list">
            {recentMessages.map((message) => (
              <li key={message.id} className={`ide-message ide-message-${message.direction}`}>
                <span className="kind-tag">{ideDirectionLabel(message.direction)}</span>
                <p>{message.text}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="ide-input">
          <textarea
            value={userMessage}
            placeholder="Drop a note for the twin to fold into the next prompt…"
            onChange={(event) => setUserMessage(event.target.value)}
            rows={2}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!userMessage.trim()}
            onClick={onSendMessage}
          >
            Inject note
            <IconArrowRight />
          </button>
        </div>
      </section>
    </div>
  );
}

function ideDirectionLabel(direction: TwinMindStateSnapshot["ideMessages"][number]["direction"]): string {
  switch (direction) {
    case "twin-to-ide":
      return "twin → IDE";
    case "ide-to-twin":
      return "IDE → twin";
    default:
      return "engine";
  }
}

function statusHeadline(status: TwinMindStateSnapshot["status"]): string {
  switch (status) {
    case "idle":
      return "Twin is idle.";
    case "pondering":
      return "Pondering build variants.";
    case "selecting":
      return "Picking the strongest variant.";
    case "prompting":
      return "Prompting the IDE.";
    case "observing":
      return "Watching the project.";
    case "reflecting":
      return "Reflecting on the latest signals.";
    case "swapping-model":
      return "Swapping brains for this phase.";
    case "done":
      return "Build loop complete.";
    case "stopped":
      return "Twin halted.";
    case "failed":
      return "Twin crashed.";
    default:
      return "Mirror builder loop";
  }
}

function ProvidersView({
  modelProviders,
  providerSettings,
  activeProviderId,
  keychainEncrypted,
  onSelectProvider,
  onSave,
  onClear
}: {
  modelProviders?: ModelProviderBootstrap;
  providerSettings: readonly ProviderSettingsState[];
  activeProviderId: ModelProviderId | "all";
  keychainEncrypted: boolean;
  onSelectProvider: (providerId: ModelProviderId | "all") => void;
  onSave: (providerId: ModelProviderId, values: Record<string, string>) => void;
  onClear: (providerId: ModelProviderId) => void;
}): ReactElement {
  if (!modelProviders) {
    return (
      <div className="card">
        <EmptyState title="Loading providers" body="Waiting for bootstrap to complete." />
      </div>
    );
  }
  return (
    <div className="stack-page">
      <div className="card provider-hero">
        <div>
          <span className="eyebrow">
            <IconShield />
            Keychain
          </span>
          <h2>Provider keys live in the OS keychain.</h2>
          <p className="muted">
            Add keys once in BuildBotPrime. The main process merges them into runtime env before
            provider bootstrap, while the renderer only receives masked values.
          </p>
        </div>
        <div className={`keychain-card ${keychainEncrypted ? "ok" : "warn"}`}>
          <strong>{keychainEncrypted ? "Encrypted storage active" : "Encryption unavailable"}</strong>
          <span>
            {keychainEncrypted
              ? "Backed by Electron safeStorage and your OS credential store."
              : "Fallback storage is active. Use OS keychain support for production secrets."}
          </span>
        </div>
      </div>

      <div className="provider-layout">
        <div className="provider-list card">
          <button
            type="button"
            className={`provider-tab ${activeProviderId === "all" ? "is-active" : ""}`}
            onClick={() => onSelectProvider("all")}
          >
            <strong>All providers</strong>
            <span>Show every model profile</span>
          </button>
          {providerSettings.map((settings) => (
            <button
              key={settings.descriptor.id}
              type="button"
              className={`provider-tab ${activeProviderId === settings.descriptor.id ? "is-active" : ""}`}
              onClick={() => onSelectProvider(settings.descriptor.id)}
            >
              <strong>{settings.descriptor.label}</strong>
              <span>{settings.isConfigured ? "Configured" : "Needs setup"}</span>
            </button>
          ))}
        </div>
        <div className="provider-panels">
          {providerSettings.map((settings) => (
            <ProviderSettingsCard
              key={settings.descriptor.id}
              settings={settings}
              runtime={modelProviders.providers.find(
                (provider) => provider.id === settings.descriptor.id
              )}
              onSave={onSave}
              onClear={onClear}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProviderSettingsCard({
  settings,
  runtime,
  onSave,
  onClear
}: {
  settings: ProviderSettingsState;
  runtime?: ProviderRuntimeConfig;
  onSave: (providerId: ModelProviderId, values: Record<string, string>) => void;
  onClear: (providerId: ModelProviderId) => void;
}): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const descriptor = settings.descriptor;

  return (
    <form
      className="card provider-card"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(descriptor.id, values);
        setValues({});
      }}
    >
      <div className="card-button-head">
        <span className="kind-tag">{descriptor.id}</span>
        <span className={`kind-tag ${settings.isConfigured ? "kind-tag-ok" : "kind-tag-warn"}`}>
          {settings.isConfigured ? "configured" : "missing setup"}
        </span>
      </div>
      <div>
        <h3>{descriptor.label}</h3>
        <p className="muted">{descriptor.tagline}</p>
      </div>
      <div className="provider-fields">
        {descriptor.fields.map((field) => {
          const state = settings.fields.find((item) => item.key === field.key);
          return (
            <Field
              key={field.key}
              label={field.label}
              hint={state?.hasValue ? `Saved: ${state.maskedValue}` : field.required ? "Required" : "Optional"}
            >
              <input
                type={field.type === "secret" ? "password" : field.type}
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((existing) => ({ ...existing, [field.key]: event.target.value }))
                }
                placeholder={state?.hasValue ? "Leave blank to keep saved value" : field.placeholder}
                spellCheck={false}
              />
            </Field>
          );
        })}
      </div>
      {runtime?.baseUrl ? <p className="muted">Endpoint: {runtime.baseUrl}</p> : null}
      <div className="provider-actions">
        {descriptor.docsUrl ? (
          <a href={descriptor.docsUrl} target="_blank" rel="noreferrer" className="btn-secondary">
            Docs
          </a>
        ) : null}
        <button type="button" className="btn-secondary" onClick={() => onClear(descriptor.id)}>
          Clear saved keys
        </button>
        <button type="submit" className="btn-primary">
          Save to keychain
          <IconArrowRight />
        </button>
      </div>
    </form>
  );
}

function NavItem({
  icon,
  label,
  hint,
  active,
  onClick
}: {
  icon: ReactElement;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className={`nav-item ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-text">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </button>
  );
}

function StatusLine({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "info";
}): ReactElement {
  return (
    <div className={`status-line status-${tone}`}>
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CardHeader({
  badge,
  eyebrow,
  title,
  description
}: {
  badge: string;
  eyebrow: string;
  title: string;
  description?: string;
}): ReactElement {
  return (
    <div className="card-header">
      <div className="card-badge">{badge}</div>
      <div>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <label className="field">
      <span className="field-label">
        <small>{label}</small>
        {hint ? <small className="field-hint">{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="meta">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function BrandLogo({ size = 28 }: { size?: number }): ReactElement {
  return (
    <svg
      className="brand-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="bbp-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3d38b" />
          <stop offset="0.55" stopColor="#e7c069" />
          <stop offset="1" stopColor="#6da4d8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0b1020" />
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        stroke="url(#bbp-grad)"
        strokeWidth="1.2"
        strokeOpacity="0.55"
      />
      <path
        d="M9 22V10h6.2c2.5 0 4 1.3 4 3.4 0 1.4-.7 2.3-1.9 2.7 1.5.4 2.4 1.4 2.4 3.1 0 2-1.6 3.4-4.2 3.4H9zm2.5-7.2h3.4c1.2 0 1.9-.5 1.9-1.5s-.7-1.4-1.9-1.4h-3.4v2.9zm0 5.1h3.7c1.4 0 2.1-.5 2.1-1.6 0-1-.7-1.6-2.1-1.6h-3.7v3.2z"
        fill="url(#bbp-grad)"
      />
      <circle cx="24.5" cy="9" r="1.6" fill="#e7c069" />
    </svg>
  );
}

function IconSpark(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5l1.4 3.9 3.9 1.4-3.9 1.4L8 12.1 6.6 8.2 2.7 6.8l3.9-1.4L8 1.5zM13 10.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconHistory(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 2a6 6 0 106 6h-1.5A4.5 4.5 0 118 3.5c1.2 0 2.3.5 3.1 1.3L9.5 6.4h4V2.5l-1.3 1.3A6 6 0 008 2zm-.75 3v3.5l2.9 1.7.75-1.2L8.5 7.7V5h-1.25z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconBrain(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M5.5 2a2.5 2.5 0 00-2.4 3.2A2.5 2.5 0 003.3 10 2.5 2.5 0 006 12.5v-9A1.5 1.5 0 015.5 2zM10.5 2A1.5 1.5 0 0010 3.5v9A2.5 2.5 0 0012.7 10a2.5 2.5 0 00-.2-4.8A2.5 2.5 0 0010.5 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMind(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5a4.5 4.5 0 00-4.4 5.4A3 3 0 005 12.5h6a3 3 0 001.4-5.6A4.5 4.5 0 008 1.5zm-1 4h2v2h2v2H9v2H7v-2H5v-2h2v-2z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconChat(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2.5 3A1.5 1.5 0 014 1.5h8A1.5 1.5 0 0113.5 3v6A1.5 1.5 0 0112 10.5H7.4l-3.1 2.7a.5.5 0 01-.8-.4V10.5A1.5 1.5 0 012.5 9V3zm3 2.5v1h5v-1H5.5zm0 2.5v1h3v-1h-3z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconBook(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 2.5A1.5 1.5 0 014.5 1H13v11H4.5a1.5 1.5 0 00-1.5 1.5V2.5zM4.5 13H13v2H4.5a1 1 0 010-2z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPlug(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6 1v3h1V1H6zm3 0v3h1V1H9zM4.5 5A1.5 1.5 0 003 6.5V9a4 4 0 003 3.87V15h1v-2.13a4 4 0 002-3.47V6.5A1.5 1.5 0 0011.5 5h-7z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTheme(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5A6.5 6.5 0 1014.5 8 6.5 6.5 0 008 1.5zm0 1.3v10.4a5.2 5.2 0 010-10.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTerminal(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zm2.2 2.4l2.1 2.1-2.1 2.1.9.9L8.1 8 5.1 5l-.9.9zM8 10.5v1.2h4v-1.2H8z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconShield(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5l5 1.9v3.7c0 3.2-1.9 6-5 7.4-3.1-1.4-5-4.2-5-7.4V3.4l5-1.9zm2.6 4.5L7.4 9.2 5.8 7.6 5 8.4l2.4 2.4 4-4-.8-.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconAlert(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5l7 12H1l7-12zm0 4.5v3h1V6H8zm.5 4.25a.75.75 0 100 1.5.75.75 0 000-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconArrowRight(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8.3 3.3L7.2 4.4 9.8 7H2v2h7.8l-2.6 2.6 1.1 1.1L14 8 8.3 3.3z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconDot(): ReactElement {
  return (
    <svg viewBox="0 0 8 8" aria-hidden>
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    </svg>
  );
}

function ideLabel(id: IdeProductId): string {
  switch (id) {
    case "cursor":
      return "Cursor";
    case "claude-code":
      return "Claude Code";
    case "agentprime":
      return "AgentPrime";
    case "windsurf":
      return "Windsurf";
    case "codex":
      return "Codex";
    case "lovable":
      return "Lovable";
    case "custom":
      return "Custom";
    default:
      return String(id);
  }
}

function sectionTitle(nav: NavKey): string {
  switch (nav) {
    case "builder":
      return "Builder";
    case "chat":
      return "Chat";
    case "twin-mind":
      return "Twin Mind";
    case "sessions":
      return "Sessions";
    case "models":
      return "Models";
    case "playbooks":
      return "Playbooks";
    case "settings":
      return "Providers";
  }
}

function sectionHeadline(nav: NavKey): string {
  switch (nav) {
    case "builder":
      return "Compose a builder run";
    case "chat":
      return "Talk to your twin";
    case "twin-mind":
      return "Mirror builder autopilot";
    case "sessions":
      return "Recent builder sessions";
    case "models":
      return "Agentic brains";
    case "playbooks":
      return "IDE playbooks";
    case "settings":
      return "Model providers";
  }
}

function createPromptWithIntake(
  prompt: string,
  intakeDocs: readonly DocumentIntakeFile[]
): string {
  const readableDocs = intakeDocs.filter((file) => file.content && !file.error);
  if (readableDocs.length === 0) {
    return prompt;
  }

  return [
    prompt,
    "",
    "Attached project intake documents:",
    ...readableDocs.map((file, index) =>
      [
        "",
        `--- Document ${index + 1}: ${file.name} (${file.path})${file.truncated ? " [truncated]" : ""} ---`,
        file.content
      ].join("\n")
    )
  ].join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
