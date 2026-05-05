import { DEFAULT_BEHAVIOR_PROFILE } from "@buildbotprime/core";
import type { BuilderRequest } from "@buildbotprime/core";
import type { AgenticModelProfile } from "@buildbotprime/model-providers";
import { pickModelForPhase } from "./model-router.js";
import { ponderVariants } from "./ponder.js";
import { reflectOnce } from "./reflect.js";
import type {
  TwinMindApprovalRequest,
  TwinMindCallToolHooks,
  TwinMindEngineHandle,
  TwinMindEvent,
  TwinMindIdeMessage,
  TwinMindMemoryItem,
  TwinMindModelSwap,
  TwinMindObservation,
  TwinMindPhase,
  TwinMindStartConfig,
  TwinMindStateSnapshot,
  TwinMindThought,
  TwinMindVariant
} from "./types.js";

const DEFAULT_VARIANT_COUNT = 4;
const DEFAULT_MAX_ITERATIONS = 16;

interface PendingApproval {
  readonly request: TwinMindApprovalRequest;
  readonly resolve: (approved: boolean) => void;
}

/**
 * TwinMindEngine — the AGI scaffolding that lets BuildBotPrime ponder several
 * candidate builds, pick one, drive an IDE in real-time, observe what happens,
 * reflect, swap models when needed, and keep going until success or the user
 * takes over. Mirrors the Spark/Nightmind ReAct loop from AGIPRIME but is
 * specialized for the IDE-builder mission.
 */
export class TwinMindEngine implements TwinMindEngineHandle {
  readonly sessionId: string;

  private snapshot: TwinMindStateSnapshot;
  private readonly hooks: TwinMindCallToolHooks;
  private readonly request: BuilderRequest;
  private readonly autoApprove: boolean;
  private readonly autoLaunchIde: boolean;
  private readonly maxIterations: number;
  private readonly variantCount: number;

  private stopRequested = false;
  private stopReason: string | undefined;
  private observerDispose: (() => void) | undefined;
  private pendingApproval: PendingApproval | undefined;
  private pendingUserMessages: string[] = [];
  private intakeText: string | undefined;
  private finished = false;

  constructor(config: TwinMindStartConfig & { hooks: TwinMindCallToolHooks; intakeText?: string }) {
    this.hooks = config.hooks;
    this.request = config.request;
    this.autoApprove = config.autoApprove ?? false;
    this.autoLaunchIde = config.autoLaunchIde ?? true;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.variantCount = config.variantCount ?? DEFAULT_VARIANT_COUNT;
    this.intakeText = config.intakeText;

    this.sessionId = `twinmind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const initialModelId =
      this.request.steeringModelId?.trim() || this.hooks.getDefaultModelId();
    const initialProfile = this.hooks.resolveModel(initialModelId);

    this.snapshot = {
      sessionId: this.sessionId,
      status: "idle",
      iteration: 0,
      maxIterations: this.maxIterations,
      attempt: 1,
      userPrompt: this.request.prompt,
      ideTarget: this.request.preferredIde === "custom" ? "cursor" : this.request.preferredIde,
      behavior: this.request.behaviorProfile ?? DEFAULT_BEHAVIOR_PROFILE,
      variants: [],
      thoughts: [],
      observations: [],
      ideMessages: [],
      modelSwaps: [],
      currentModelId: initialModelId,
      currentModelLabel: initialProfile?.label ?? initialModelId,
      memory: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  getSnapshot(): TwinMindStateSnapshot {
    return this.snapshot;
  }

  pickVariant(variantId: string): void {
    const variant = this.snapshot.variants.find((entry) => entry.id === variantId);
    if (!variant) return;
    this.updateState({ chosenVariantId: variantId });
    this.recordThought("selecting", `User picked variant ${variant.flavor}.`, variant.summary);
  }

  ingestObservation(observation: Omit<TwinMindObservation, "id" | "timestamp">): void {
    const enriched: TwinMindObservation = {
      ...observation,
      id: `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    this.appendObservation(enriched);
  }

  async sendUserMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.pendingUserMessages.push(trimmed);
    this.appendIdeMessage({
      direction: "engine",
      text: `User: ${trimmed}`,
      meta: { source: "user" }
    });
  }

  approveAction(approvalId: string, approve: boolean): void {
    if (!this.pendingApproval) return;
    if (this.pendingApproval.request.id !== approvalId) return;
    const pending = this.pendingApproval;
    this.pendingApproval = undefined;
    this.updateState({ approvalNeeded: undefined });
    pending.resolve(approve);
  }

  async stop(reason: string): Promise<void> {
    this.stopRequested = true;
    this.stopReason = reason;
    if (this.pendingApproval) {
      this.pendingApproval.resolve(false);
      this.pendingApproval = undefined;
    }
  }

  async run(): Promise<TwinMindStateSnapshot> {
    try {
      await this.runInternal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordThought("failed", "Twin mind crashed.", message);
      this.updateState({ status: "failed", lastError: message });
      this.hooks.emit({ type: "stopped", reason: message, snapshot: this.snapshot });
    } finally {
      this.observerDispose?.();
      this.observerDispose = undefined;
    }
    return this.snapshot;
  }

  private async runInternal(): Promise<void> {
    this.transition("pondering");
    const variants = await ponderVariants({
      request: this.request,
      intakeText: this.intakeText,
      variantCount: this.variantCount,
      callChat: (options) => this.hooks.callChat(options),
      steeringModelId: this.snapshot.currentModelId
    });

    for (const variant of variants) {
      this.appendVariant(variant);
    }

    if (this.shouldHalt()) return;

    this.transition("selecting");
    const chosen = await this.waitForVariantChoice(variants);
    if (!chosen) {
      this.recordThought("stopped", "No variant chosen — halting.", "Builder did not approve a variant.");
      this.updateState({ status: "stopped" });
      return;
    }
    this.recordThought(
      "selecting",
      `Chose ${chosen.flavor}.`,
      `${chosen.summary}\nSteps: ${chosen.recommendedSteps.join(" → ")}`
    );

    if (this.autoLaunchIde && this.request.projectPath) {
      try {
        await this.hooks.launchIde(this.snapshot.ideTarget, this.request.projectPath);
        this.appendIdeMessage({
          direction: "engine",
          text: `Launched ${this.snapshot.ideTarget} on ${this.request.projectPath}.`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendObservation({
          id: `obs_${Date.now().toString(36)}`,
          source: "engine",
          severity: "warning",
          headline: "IDE launch failed",
          detail: message,
          timestamp: new Date().toISOString()
        });
      }
    }

    this.observerDispose = this.hooks.observeProject((signal) => {
      this.appendObservation(signal);
    });

    while (!this.shouldHalt()) {
      this.snapshot = {
        ...this.snapshot,
        iteration: this.snapshot.iteration + 1,
        updatedAt: new Date().toISOString()
      };

      this.transition("prompting");
      await this.maybeSwapModel("prompting");

      const reflection = await reflectOnce({
        snapshot: this.snapshot,
        chosen,
        callChat: (options) => this.hooks.callChat(options),
        steeringModelId: this.snapshot.currentModelId
      });

      this.recordThought("reflecting", reflection.headline, reflection.body, reflection.force);

      if (reflection.memory) {
        this.appendMemory({
          kind: classifyMemoryKind(reflection.memory.content),
          content: reflection.memory.content,
          importance: clamp(reflection.memory.importance, 0, 1)
        });
      }

      switch (reflection.nextAction.kind) {
        case "send-prompt": {
          const prompt = this.composeIdePrompt(reflection.nextAction.text, chosen);
          if (await this.requireApproval("Send prompt to IDE", prompt)) {
            await this.deliverPrompt(prompt);
          } else {
            this.recordThought("stopped", "User denied prompt", "Halting on disapproval.");
            this.updateState({ status: "stopped" });
            return;
          }
          break;
        }
        case "ask-user": {
          const approval = await this.askUser(reflection.nextAction.question);
          if (!approval) {
            this.updateState({ status: "stopped" });
            return;
          }
          break;
        }
        case "swap-model": {
          this.transition("swapping-model");
          await this.maybeSwapModel("prompting", reflection.nextAction.reason);
          break;
        }
        case "wait": {
          this.transition("observing");
          await delay(2_500);
          break;
        }
        case "done": {
          this.recordThought("done", "Build loop done.", reflection.nextAction.summary);
          this.updateState({ status: "done" });
          this.finished = true;
          return;
        }
        case "stop": {
          this.recordThought("stopped", "Reflection stopped the loop.", reflection.nextAction.reason);
          this.updateState({ status: "stopped" });
          return;
        }
      }

      this.transition("observing");
      await this.observeWindow();

      if (this.pendingUserMessages.length > 0) {
        const next = this.pendingUserMessages.shift();
        if (next) {
          this.appendIdeMessage({ direction: "engine", text: `Folding user note into next step: ${next}` });
        }
      }
    }

    if (!this.finished) {
      this.recordThought(
        "stopped",
        this.stopReason ? `Stopped: ${this.stopReason}` : "Reached iteration cap.",
        `Iterations used: ${this.snapshot.iteration}`
      );
      this.updateState({ status: this.stopReason ? "stopped" : "done" });
      this.hooks.emit({
        type: "stopped",
        reason: this.stopReason ?? "iteration-cap",
        snapshot: this.snapshot
      });
    }
  }

  private async waitForVariantChoice(
    variants: readonly TwinMindVariant[]
  ): Promise<TwinMindVariant | undefined> {
    if (variants.length === 0) return undefined;

    if (this.autoApprove) {
      const chosen = variants[0];
      this.updateState({ chosenVariantId: chosen.id });
      return chosen;
    }

    const approval: TwinMindApprovalRequest = {
      id: `approval_${Date.now().toString(36)}`,
      title: "Pick a build variant",
      detail: `Twin pondered ${variants.length} approaches. Confirm the top-scored one or pick another from the deck.`,
      proposedAction: variants[0].title,
      timestamp: new Date().toISOString()
    };

    const approved = await this.requestApproval(approval);
    if (!approved) return undefined;

    if (this.snapshot.chosenVariantId) {
      return variants.find((entry) => entry.id === this.snapshot.chosenVariantId);
    }
    const top = variants[0];
    this.updateState({ chosenVariantId: top.id });
    return top;
  }

  private async observeWindow(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 4_500 && !this.shouldHalt()) {
      await delay(500);
    }
  }

  private async maybeSwapModel(forPhase: TwinMindPhase, override?: string): Promise<void> {
    const choice = pickModelForPhase(forPhase, {
      available: this.hooks.listAvailableModels(),
      providerStatus: this.hooks.providerStatus(),
      currentModelId: this.snapshot.currentModelId,
      fallbackModelId: this.snapshot.currentModelId
    });
    if (choice.modelId === this.snapshot.currentModelId && !override) return;
    if (choice.modelId === this.snapshot.currentModelId) return;

    const previousProfile = this.hooks.resolveModel(this.snapshot.currentModelId);
    const nextProfile = this.hooks.resolveModel(choice.modelId);
    const swap: TwinMindModelSwap = {
      id: `swap_${Date.now().toString(36)}`,
      fromModelId: this.snapshot.currentModelId,
      toModelId: choice.modelId,
      fromLabel: previousProfile?.label,
      toLabel: nextProfile?.label ?? choice.modelId,
      reason: override ?? choice.reason,
      forPhase,
      timestamp: new Date().toISOString()
    };
    this.snapshot = {
      ...this.snapshot,
      currentModelId: choice.modelId,
      currentModelLabel: nextProfile?.label ?? choice.modelId,
      modelSwaps: [...this.snapshot.modelSwaps, swap],
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "model-swap", swap, snapshot: this.snapshot });
  }

  private composeIdePrompt(text: string, variant: TwinMindVariant): string {
    return [
      `BuildBotPrime twin guidance (variant: ${variant.flavor}).`,
      "Inspect before editing. Surface blockers exactly. Run the project after changes.",
      "",
      text
    ].join("\n");
  }

  private async deliverPrompt(prompt: string): Promise<void> {
    this.appendIdeMessage({ direction: "twin-to-ide", text: prompt });
    try {
      await this.hooks.sendToIde(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendObservation({
        id: `obs_${Date.now().toString(36)}`,
        source: "engine",
        severity: "error",
        headline: "Could not reach IDE",
        detail: message,
        timestamp: new Date().toISOString()
      });
    }
  }

  private async askUser(question: string): Promise<boolean> {
    const approval: TwinMindApprovalRequest = {
      id: `ask_${Date.now().toString(36)}`,
      title: "Twin needs guidance",
      detail: question,
      proposedAction: "Reply yes to continue with the twin's plan, or no to halt.",
      timestamp: new Date().toISOString()
    };
    return this.requestApproval(approval);
  }

  private async requireApproval(title: string, body: string): Promise<boolean> {
    if (this.autoApprove) return true;
    const approval: TwinMindApprovalRequest = {
      id: `approve_${Date.now().toString(36)}`,
      title,
      detail: body.slice(0, 600),
      proposedAction: title,
      timestamp: new Date().toISOString()
    };
    return this.requestApproval(approval);
  }

  private requestApproval(request: TwinMindApprovalRequest): Promise<boolean> {
    if (this.autoApprove) {
      this.hooks.emit({ type: "approval-needed", approval: request, snapshot: this.snapshot });
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this.pendingApproval = { request, resolve };
      this.updateState({ approvalNeeded: request });
      this.hooks.emit({ type: "approval-needed", approval: request, snapshot: this.snapshot });
    });
  }

  private appendVariant(variant: TwinMindVariant): void {
    this.snapshot = {
      ...this.snapshot,
      variants: [...this.snapshot.variants, variant],
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "variant", variant, snapshot: this.snapshot });
  }

  private appendObservation(observation: TwinMindObservation): void {
    this.snapshot = {
      ...this.snapshot,
      observations: [...this.snapshot.observations, observation],
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "observation", observation, snapshot: this.snapshot });
  }

  private appendIdeMessage(partial: Omit<TwinMindIdeMessage, "id" | "timestamp">): void {
    const message: TwinMindIdeMessage = {
      ...partial,
      id: `ide_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    this.snapshot = {
      ...this.snapshot,
      ideMessages: [...this.snapshot.ideMessages, message],
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "ide-message", message, snapshot: this.snapshot });
  }

  private appendMemory(partial: Omit<TwinMindMemoryItem, "id" | "timestamp">): void {
    const memory: TwinMindMemoryItem = {
      ...partial,
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    this.snapshot = {
      ...this.snapshot,
      memory: [...this.snapshot.memory, memory].slice(-30),
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "memory", memory, snapshot: this.snapshot });
  }

  private recordThought(
    phase: TwinMindPhase,
    headline: string,
    body: string,
    force?: TwinMindThought["force"]
  ): void {
    const thought: TwinMindThought = {
      id: `thought_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      iteration: this.snapshot.iteration,
      phase,
      headline,
      body,
      force,
      modelLabel: this.snapshot.currentModelLabel,
      timestamp: new Date().toISOString()
    };
    this.snapshot = {
      ...this.snapshot,
      thoughts: [...this.snapshot.thoughts, thought],
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "thought", thought, snapshot: this.snapshot });
  }

  private transition(status: TwinMindPhase): void {
    if (this.snapshot.status === status) return;
    this.updateState({ status });
  }

  private updateState(patch: Partial<TwinMindStateSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.hooks.emit({ type: "state", snapshot: this.snapshot });
  }

  private shouldHalt(): boolean {
    if (this.stopRequested) return true;
    if (this.snapshot.status === "stopped" || this.snapshot.status === "done" || this.snapshot.status === "failed") {
      return true;
    }
    return this.snapshot.iteration >= this.maxIterations;
  }
}

function classifyMemoryKind(text: string): TwinMindMemoryItem["kind"] {
  const normalized = text.toLowerCase();
  if (normalized.includes("blocker") || normalized.includes("blocked") || normalized.includes("error")) {
    return "blocker";
  }
  if (normalized.includes("prefer") || normalized.includes("style")) {
    return "preference";
  }
  if (normalized.includes("worked") || normalized.includes("shipped") || normalized.includes("success")) {
    return "win";
  }
  return "lesson";
}

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.max(low, Math.min(high, value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { TwinMindStartConfig } from "./types.js";
export type { AgenticModelProfile };
export type { BuilderRequest };
export type {
  TwinMindEngineHandle,
  TwinMindEvent,
  TwinMindStateSnapshot,
  TwinMindThought,
  TwinMindVariant,
  TwinMindApprovalRequest,
  TwinMindObservation,
  TwinMindIdeMessage,
  TwinMindModelSwap,
  TwinMindMemoryItem,
  TwinMindCallToolHooks
} from "./types.js";
