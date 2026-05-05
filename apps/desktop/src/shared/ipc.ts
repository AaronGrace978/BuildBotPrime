import type { BuilderRequest, BuilderSession } from "@buildbotprime/core";
import type { IdeAction } from "@buildbotprime/ide-adapters";
import type {
  ModelProviderBootstrap,
  ModelProviderId,
  ProviderDescriptor
} from "@buildbotprime/model-providers";
import type { ProductPlaybook } from "@buildbotprime/product-knowledge";
import type {
  TwinMindEvent,
  TwinMindStateSnapshot
} from "@buildbotprime/twin-mind";

export interface ProviderFieldState {
  readonly key: string;
  readonly hasValue: boolean;
  readonly maskedValue: string;
  readonly fromEnvFile: boolean;
}

export interface ProviderSettingsState {
  readonly descriptor: ProviderDescriptor;
  readonly isConfigured: boolean;
  readonly fields: readonly ProviderFieldState[];
}

export interface BootstrapPayload {
  readonly playbooks: readonly ProductPlaybook[];
  readonly modelProviders: ModelProviderBootstrap;
  readonly sessions: readonly BuilderSession[];
  readonly providerSettings: readonly ProviderSettingsState[];
  readonly activeProviderId: ModelProviderId | "all";
  readonly keychainEncrypted: boolean;
}

export interface StartBuildResponse {
  readonly session: BuilderSession;
  readonly plannedActions: readonly IdeAction[];
  readonly automationResult: AutomationResult;
}

export type AutomationStatus = "executed" | "partial" | "manual-required" | "failed";

export interface AutomationEvent {
  readonly kind: "info" | "success" | "warning" | "error";
  readonly label: string;
  readonly detail: string;
  readonly timestamp: string;
}

export interface AutomationResult {
  readonly target: string;
  readonly status: AutomationStatus;
  readonly prompt: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly promptCopied: boolean;
  readonly launched: boolean;
  readonly handoffAttempted: boolean;
  readonly events: readonly AutomationEvent[];
}

export interface ProjectFolderSelection {
  readonly canceled: boolean;
  readonly path?: string;
  readonly detection?: {
    readonly rootPath: string;
    readonly packageManager: string;
    readonly scripts: readonly string[];
    readonly installCommand?: string;
    readonly devCommand?: string;
    readonly testCommand?: string;
    readonly buildCommand?: string;
  };
  readonly error?: string;
}

export interface DocumentIntakeFile {
  readonly path: string;
  readonly name: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly error?: string;
}

export interface DocumentIntakeSelection {
  readonly canceled: boolean;
  readonly files: readonly DocumentIntakeFile[];
}

export interface ProviderSettingsUpdateResult {
  readonly modelProviders: ModelProviderBootstrap;
  readonly providerSettings: readonly ProviderSettingsState[];
}

export interface TwinMindStartRequest {
  readonly request: BuilderRequest;
  readonly intakeText?: string;
  readonly variantCount?: number;
  readonly maxIterations?: number;
  readonly autoApprove?: boolean;
  readonly autoLaunchIde?: boolean;
}

export interface TwinMindStartResponse {
  readonly sessionId: string;
  readonly snapshot: TwinMindStateSnapshot;
}

export interface TwinChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface TwinChatRequest {
  readonly steeringModelId: string;
  readonly messages: readonly TwinChatMessage[];
  readonly behaviorNotes?: readonly string[];
  readonly projectPath?: string;
  readonly mode?: "onboard" | "chat";
}

export interface TwinChatResponse {
  readonly reply: string;
  readonly capturedStyleNotes: readonly string[];
  readonly capturedHabits: readonly string[];
  readonly capturedApprovals: readonly string[];
  readonly nextQuestion?: string;
  readonly raw: string;
}

export interface BuildBotPrimeApi {
  getBootstrap(): Promise<BootstrapPayload>;
  startBuild(request: BuilderRequest): Promise<StartBuildResponse>;
  selectProjectFolder(): Promise<ProjectFolderSelection>;
  selectIntakeDocuments(): Promise<DocumentIntakeSelection>;
  saveProviderSettings(
    providerId: ModelProviderId,
    values: Record<string, string>
  ): Promise<ProviderSettingsUpdateResult>;
  clearProviderSettings(providerId: ModelProviderId): Promise<ProviderSettingsUpdateResult>;
  setActiveProvider(providerId: ModelProviderId | "all"): Promise<{ activeProviderId: ModelProviderId | "all" }>;
  toggleDevTools(): Promise<void>;

  twinMindStart(request: TwinMindStartRequest): Promise<TwinMindStartResponse>;
  twinMindStop(sessionId: string, reason?: string): Promise<{ readonly stopped: boolean }>;
  twinMindPickVariant(sessionId: string, variantId: string): Promise<{ readonly ok: boolean }>;
  twinMindApprove(
    sessionId: string,
    approvalId: string,
    approve: boolean
  ): Promise<{ readonly ok: boolean }>;
  twinMindSendMessage(sessionId: string, text: string): Promise<{ readonly ok: boolean }>;
  twinMindGetSnapshot(sessionId: string): Promise<TwinMindStateSnapshot | undefined>;
  twinMindOnEvent(callback: (event: TwinMindEvent) => void): () => void;
  twinMindChat(request: TwinChatRequest): Promise<TwinChatResponse>;
}

export const IPC_CHANNELS = {
  getBootstrap: "buildbotprime:get-bootstrap",
  startBuild: "buildbotprime:start-build",
  selectProjectFolder: "buildbotprime:select-project-folder",
  selectIntakeDocuments: "buildbotprime:select-intake-documents",
  saveProviderSettings: "buildbotprime:save-provider-settings",
  clearProviderSettings: "buildbotprime:clear-provider-settings",
  setActiveProvider: "buildbotprime:set-active-provider",
  toggleDevTools: "buildbotprime:toggle-devtools",
  twinMindStart: "buildbotprime:twin-mind-start",
  twinMindStop: "buildbotprime:twin-mind-stop",
  twinMindPickVariant: "buildbotprime:twin-mind-pick-variant",
  twinMindApprove: "buildbotprime:twin-mind-approve",
  twinMindSendMessage: "buildbotprime:twin-mind-send-message",
  twinMindGetSnapshot: "buildbotprime:twin-mind-get-snapshot",
  twinMindEvent: "buildbotprime:twin-mind-event",
  twinMindChat: "buildbotprime:twin-mind-chat"
} as const;

declare global {
  interface Window {
    buildBotPrime: BuildBotPrimeApi;
  }
}
