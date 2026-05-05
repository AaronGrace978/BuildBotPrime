import type {
  BuilderBehaviorProfile,
  BuilderRequest,
  IdeProductId
} from "@buildbotprime/core";
import type { AgenticModelProfile, ModelProviderId } from "@buildbotprime/model-providers";

export type TwinMindPhase =
  | "idle"
  | "pondering"
  | "selecting"
  | "prompting"
  | "observing"
  | "reflecting"
  | "swapping-model"
  | "stopped"
  | "done"
  | "failed";

export type TwinMindForce =
  | "explore"
  | "exploit"
  | "metacognition"
  | "incompleteness";

export interface TwinMindVariant {
  readonly id: string;
  readonly title: string;
  readonly flavor: string;
  readonly summary: string;
  readonly riskNotes: readonly string[];
  readonly score: number;
  readonly modelHint?: string;
  readonly recommendedSteps: readonly string[];
}

export interface TwinMindThought {
  readonly id: string;
  readonly iteration: number;
  readonly phase: TwinMindPhase;
  readonly headline: string;
  readonly body: string;
  readonly force?: TwinMindForce;
  readonly modelLabel?: string;
  readonly timestamp: string;
}

export interface TwinMindObservation {
  readonly id: string;
  readonly source: "filesystem" | "cursor-sdk" | "terminal" | "user" | "engine";
  readonly severity: "info" | "warning" | "error" | "blocked";
  readonly headline: string;
  readonly detail: string;
  readonly timestamp: string;
}

export interface TwinMindModelSwap {
  readonly id: string;
  readonly fromModelId: string | undefined;
  readonly toModelId: string;
  readonly fromLabel: string | undefined;
  readonly toLabel: string;
  readonly reason: string;
  readonly forPhase: TwinMindPhase;
  readonly timestamp: string;
}

export interface TwinMindIdeMessage {
  readonly id: string;
  readonly direction: "twin-to-ide" | "ide-to-twin" | "engine";
  readonly text: string;
  readonly timestamp: string;
  readonly meta?: Record<string, string>;
}

export interface TwinMindMemoryItem {
  readonly id: string;
  readonly kind: "lesson" | "blocker" | "win" | "preference";
  readonly content: string;
  readonly importance: number;
  readonly timestamp: string;
}

export interface TwinMindStateSnapshot {
  readonly sessionId: string;
  readonly status: TwinMindPhase;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly attempt: number;
  readonly userPrompt: string;
  readonly ideTarget: IdeProductId;
  readonly behavior: BuilderBehaviorProfile;
  readonly variants: readonly TwinMindVariant[];
  readonly chosenVariantId?: string;
  readonly thoughts: readonly TwinMindThought[];
  readonly observations: readonly TwinMindObservation[];
  readonly ideMessages: readonly TwinMindIdeMessage[];
  readonly modelSwaps: readonly TwinMindModelSwap[];
  readonly currentModelId: string;
  readonly currentModelLabel: string;
  readonly memory: readonly TwinMindMemoryItem[];
  readonly approvalNeeded?: TwinMindApprovalRequest;
  readonly lastError?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface TwinMindApprovalRequest {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly proposedAction: string;
  readonly timestamp: string;
}

export type TwinMindEvent =
  | { readonly type: "state"; readonly snapshot: TwinMindStateSnapshot }
  | { readonly type: "thought"; readonly thought: TwinMindThought; readonly snapshot: TwinMindStateSnapshot }
  | { readonly type: "variant"; readonly variant: TwinMindVariant; readonly snapshot: TwinMindStateSnapshot }
  | {
      readonly type: "observation";
      readonly observation: TwinMindObservation;
      readonly snapshot: TwinMindStateSnapshot;
    }
  | {
      readonly type: "ide-message";
      readonly message: TwinMindIdeMessage;
      readonly snapshot: TwinMindStateSnapshot;
    }
  | {
      readonly type: "model-swap";
      readonly swap: TwinMindModelSwap;
      readonly snapshot: TwinMindStateSnapshot;
    }
  | {
      readonly type: "approval-needed";
      readonly approval: TwinMindApprovalRequest;
      readonly snapshot: TwinMindStateSnapshot;
    }
  | {
      readonly type: "memory";
      readonly memory: TwinMindMemoryItem;
      readonly snapshot: TwinMindStateSnapshot;
    }
  | { readonly type: "stopped"; readonly reason: string; readonly snapshot: TwinMindStateSnapshot };

export interface TwinMindStartConfig {
  readonly request: BuilderRequest;
  readonly variantCount?: number;
  readonly maxIterations?: number;
  readonly autoLaunchIde?: boolean;
  readonly autoApprove?: boolean;
}

export interface TwinMindCallToolHooks {
  readonly callChat: (options: TwinMindChatOptions) => Promise<string>;
  readonly resolveModel: (modelId: string) => AgenticModelProfile | undefined;
  readonly getDefaultModelId: () => string;
  readonly listAvailableModels: () => readonly AgenticModelProfile[];
  readonly providerStatus: () => Record<ModelProviderId, boolean>;
  readonly launchIde: (target: IdeProductId, projectPath: string | undefined) => Promise<void>;
  readonly sendToIde: (text: string) => Promise<void>;
  readonly observeProject: (
    onSignal: (signal: TwinMindObservation) => void
  ) => () => void;
  readonly listProjectFiles?: (cwd: string) => Promise<readonly string[]>;
  readonly emit: (event: TwinMindEvent) => void;
}

export interface TwinMindChatOptions {
  readonly modelId: string;
  readonly system: string;
  readonly user: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface TwinMindEngineHandle {
  readonly sessionId: string;
  getSnapshot(): TwinMindStateSnapshot;
  pickVariant(variantId: string): void;
  ingestObservation(observation: Omit<TwinMindObservation, "id" | "timestamp">): void;
  sendUserMessage(text: string): Promise<void>;
  approveAction(approvalId: string, approve: boolean): void;
  stop(reason: string): Promise<void>;
}
