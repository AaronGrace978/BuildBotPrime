export type IdeProductId =
  | "cursor"
  | "claude-code"
  | "agentprime"
  | "windsurf"
  | "codex"
  | "lovable"
  | "custom";

export type BuildIntent = "create" | "repair" | "extend" | "explore";

export interface BuilderRequest {
  readonly prompt: string;
  readonly projectPath?: string;
  readonly repoUrl?: string;
  readonly preferredIde: IdeProductId;
  readonly modelProfile?: string;
  readonly steeringModelId?: string;
  readonly behaviorProfile?: BuilderBehaviorProfile;
  readonly intent: BuildIntent;
}

export interface BuilderBehaviorProfile {
  readonly name: string;
  readonly promptStyle: readonly string[];
  readonly buildHabits: readonly string[];
  readonly approvalPreferences: readonly string[];
}

export interface BuilderSession {
  readonly id: string;
  readonly request: BuilderRequest;
  readonly state: BuildLoopState;
  readonly events: readonly BuilderEvent[];
  readonly createdAt: string;
}

export type BuildLoopStatus =
  | "drafting"
  | "opening-ide"
  | "prompting"
  | "observing"
  | "running-project"
  | "feeding-back"
  | "waiting-for-user"
  | "done"
  | "stopped";

export interface BuildLoopState {
  readonly status: BuildLoopStatus;
  readonly activeIde: IdeProductId;
  readonly attempt: number;
  readonly lastError?: string;
  readonly nextAction: string;
}

export type BuilderEventKind =
  | "chat"
  | "prompt-composed"
  | "ide-action"
  | "runner-event"
  | "observation"
  | "approval-needed"
  | "system";

export interface BuilderEvent {
  readonly id: string;
  readonly kind: BuilderEventKind;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, string | number | boolean>;
}

export interface PromptContext {
  readonly userPrompt: string;
  readonly productName: string;
  readonly projectPath?: string;
  readonly repoUrl?: string;
  readonly steeringModelLabel?: string;
  readonly behaviorProfile?: BuilderBehaviorProfile;
  readonly runnerError?: string;
  readonly attempt: number;
}

export function createBuilderSession(request: BuilderRequest): BuilderSession {
  const now = new Date().toISOString();

  return {
    id: createId("session"),
    request,
    createdAt: now,
    state: {
      status: "drafting",
      activeIde: request.preferredIde,
      attempt: 1,
      nextAction: "Compose the first build prompt."
    },
    events: [
      {
        id: createId("event"),
        kind: "chat",
        message: request.prompt,
        timestamp: now
      }
    ]
  };
}

export function composeBuildPrompt(context: PromptContext): string {
  const projectTarget = context.projectPath
    ? `Local project: ${context.projectPath}`
    : context.repoUrl
      ? `GitHub repo: ${context.repoUrl}`
      : "Project target: create or select a workspace before editing.";

  const feedback = context.runnerError
    ? `\n\nThe latest project run failed. Diagnose and fix this exact failure:\n${context.runnerError}`
    : "";
  const behaviorProfile = context.behaviorProfile ?? DEFAULT_BEHAVIOR_PROFILE;

  return [
    `You are ${behaviorProfile.name}, a builder automation twin steering ${context.productName}.`,
    "You do not replace the IDE's agent. You prompt it, guide it, observe its work, and keep the build moving in the user's style.",
    context.steeringModelLabel ? `BuildBotPrime steering model: ${context.steeringModelLabel}` : undefined,
    projectTarget,
    `Attempt: ${context.attempt}`,
    "",
    "User request:",
    context.userPrompt,
    "",
    "Mirror these prompt style patterns:",
    formatList(behaviorProfile.promptStyle),
    "",
    "Honor these building habits:",
    formatList(behaviorProfile.buildHabits),
    "",
    "Approval preferences:",
    formatList(behaviorProfile.approvalPreferences),
    feedback
  ].filter(Boolean).join("\n");
}

export function appendBuilderEvent(
  session: BuilderSession,
  event: Omit<BuilderEvent, "id" | "timestamp">
): BuilderSession {
  return {
    ...session,
    events: [
      ...session.events,
      {
        ...event,
        id: createId("event"),
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export function transitionBuildLoop(
  session: BuilderSession,
  status: BuildLoopStatus,
  nextAction: string,
  lastError?: string
): BuilderSession {
  return {
    ...session,
    state: {
      ...session.state,
      status,
      nextAction,
      lastError,
      attempt: status === "feeding-back" ? session.state.attempt + 1 : session.state.attempt
    }
  };
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_BEHAVIOR_PROFILE: BuilderBehaviorProfile = {
  name: "BuildBotPrime",
  promptStyle: [
    "Keep prompts direct, imaginative, and outcome-focused.",
    "Ask the IDE to inspect before editing and to explain meaningful blockers.",
    "Feed back exact errors instead of vague summaries."
  ],
  buildHabits: [
    "Open the user's preferred IDE and let that product perform the code work.",
    "Validate progress by watching files, logs, and the running project.",
    "Loop errors back into the same IDE conversation until the project advances."
  ],
  approvalPreferences: [
    "Pause before destructive actions, credential prompts, publishing, or unclear approvals.",
    "Keep the user in control with stop, pause, and manual takeover."
  ]
};

function formatList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
