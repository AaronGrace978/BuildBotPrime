import type {
  TwinMindChatOptions,
  TwinMindForce,
  TwinMindIdeMessage,
  TwinMindObservation,
  TwinMindStateSnapshot,
  TwinMindVariant
} from "./types.js";

export interface ReflectInput {
  readonly snapshot: TwinMindStateSnapshot;
  readonly chosen: TwinMindVariant | undefined;
  readonly callChat: (options: TwinMindChatOptions) => Promise<string>;
  readonly steeringModelId: string;
}

export interface ReflectionResult {
  readonly headline: string;
  readonly body: string;
  readonly force: TwinMindForce;
  readonly nextAction:
    | { readonly kind: "send-prompt"; readonly text: string }
    | { readonly kind: "ask-user"; readonly question: string }
    | { readonly kind: "swap-model"; readonly reason: string }
    | { readonly kind: "wait" }
    | { readonly kind: "done"; readonly summary: string }
    | { readonly kind: "stop"; readonly reason: string };
  readonly memory?: { readonly content: string; readonly importance: number };
}

/**
 * Calls the steering model to produce a structured reflection on the latest
 * observations and chosen variant. Returns a deterministic decision the engine
 * can act on.
 */
export async function reflectOnce(input: ReflectInput): Promise<ReflectionResult> {
  const { snapshot, chosen, callChat, steeringModelId } = input;

  const force = pickDominantForce(snapshot);
  let raw: string;
  try {
    raw = await callChat({
      modelId: steeringModelId,
      system: REFLECT_SYSTEM_PROMPT,
      user: buildReflectUserPrompt(snapshot, chosen, force),
      temperature: 0.55,
      maxOutputTokens: 1100
    });
  } catch (error) {
    return deterministicReflection(snapshot, chosen, force, error);
  }

  const parsed = parseReflection(raw);
  if (!parsed) {
    return deterministicReflection(snapshot, chosen, force);
  }

  return {
    headline: parsed.headline,
    body: parsed.body,
    force,
    nextAction: parsed.nextAction,
    memory: parsed.memory
  };
}

const REFLECT_SYSTEM_PROMPT = `You are the REFLECT engine of BuildBotPrime — a builder twin's inner voice.
You read the chosen variant, prior thoughts, observations, and IDE replies, then decide the next move.

You operate under FOUR FORCES from the user's AGI stack:
- EXPLORE: try a new tactic.
- EXPLOIT: lean into what's working.
- METACOGNITION: step back and rethink the strategy.
- INCOMPLETENESS: ask the user; you've hit a boundary.

Output strict JSON:
{
  "headline": "one short sentence",
  "body": "<= 6 sentences",
  "memory": { "content": "lesson worth remembering", "importance": 0..1 } | null,
  "nextAction": { "kind": "send-prompt", "text": "<exact message to type into the IDE>" } |
                 { "kind": "ask-user", "question": "<question for the human>" } |
                 { "kind": "swap-model", "reason": "<why a different brain is needed>" } |
                 { "kind": "wait" } |
                 { "kind": "done", "summary": "<short success summary>" } |
                 { "kind": "stop", "reason": "<why we are halting>" }
}
Return ONLY the JSON. No prose.`;

function buildReflectUserPrompt(
  snapshot: TwinMindStateSnapshot,
  chosen: TwinMindVariant | undefined,
  force: TwinMindForce
): string {
  const lines: string[] = [
    `ITERATION ${snapshot.iteration}/${snapshot.maxIterations}`,
    `DOMINANT FORCE: ${force.toUpperCase()}`,
    `CURRENT MODEL: ${snapshot.currentModelLabel}`,
    `IDE TARGET: ${snapshot.ideTarget}`,
    `BUILDER VOICE:`,
    ...(snapshot.behavior.promptStyle ?? []).map((line) => `- ${line}`),
    "",
    `USER REQUEST:`,
    snapshot.userPrompt,
    "",
    `CHOSEN VARIANT:`,
    chosen ? `${chosen.flavor} — ${chosen.summary}` : "(none yet)",
    chosen ? `STEPS: ${chosen.recommendedSteps.join(" → ")}` : "",
    "",
    `RECENT OBSERVATIONS (newest last):`,
    ...lastN(snapshot.observations, 8).map(
      (o) => `[${o.severity}] ${o.source}: ${o.headline} — ${o.detail}`
    ),
    "",
    `RECENT IDE TRANSCRIPT:`,
    ...lastN(snapshot.ideMessages, 8).map((m) => formatIdeMessage(m)),
    "",
    `MEMORY:`,
    ...lastN(snapshot.memory, 6).map((m) => `- (${m.kind}, ${m.importance.toFixed(2)}) ${m.content}`),
    "",
    snapshot.lastError ? `LAST ERROR: ${snapshot.lastError}` : ""
  ];
  return lines.filter(Boolean).join("\n");
}

function formatIdeMessage(message: TwinMindIdeMessage): string {
  const arrow = message.direction === "twin-to-ide" ? "TWIN→IDE" : message.direction === "ide-to-twin" ? "IDE→TWIN" : "ENGINE";
  return `${arrow}: ${message.text.slice(0, 600)}`;
}

function lastN<T>(items: readonly T[], n: number): readonly T[] {
  return items.length <= n ? items : items.slice(items.length - n);
}

function parseReflection(raw: string): ReflectionResult | undefined {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as {
      headline?: string;
      body?: string;
      memory?: { content?: string; importance?: number } | null;
      nextAction?:
        | { kind?: string; text?: string; question?: string; reason?: string; summary?: string };
    };
    if (!parsed.headline || !parsed.body || !parsed.nextAction?.kind) return undefined;
    const action = parseAction(parsed.nextAction);
    if (!action) return undefined;
    const memory = parsed.memory && parsed.memory.content
      ? {
          content: parsed.memory.content,
          importance:
            typeof parsed.memory.importance === "number" ? parsed.memory.importance : 0.5
        }
      : undefined;
    return {
      headline: parsed.headline,
      body: parsed.body,
      force: "exploit",
      nextAction: action,
      memory
    };
  } catch {
    return undefined;
  }
}

function parseAction(value: {
  kind?: string;
  text?: string;
  question?: string;
  reason?: string;
  summary?: string;
}): ReflectionResult["nextAction"] | undefined {
  switch (value.kind) {
    case "send-prompt":
      if (!value.text) return undefined;
      return { kind: "send-prompt", text: value.text };
    case "ask-user":
      if (!value.question) return undefined;
      return { kind: "ask-user", question: value.question };
    case "swap-model":
      return { kind: "swap-model", reason: value.reason ?? "Try a different brain." };
    case "wait":
      return { kind: "wait" };
    case "done":
      return { kind: "done", summary: value.summary ?? "Build complete." };
    case "stop":
      return { kind: "stop", reason: value.reason ?? "Stopping the loop." };
    default:
      return undefined;
  }
}

function pickDominantForce(snapshot: TwinMindStateSnapshot): TwinMindForce {
  const recentErrors = lastN(snapshot.observations, 8).filter(
    (o) => o.severity === "error" || o.severity === "blocked"
  ).length;
  if (recentErrors >= 2) return "metacognition";

  const noProgress = snapshot.iteration > 4 && snapshot.observations.length < 2;
  if (noProgress) return "explore";

  const blocked = snapshot.observations.some((o) => o.severity === "blocked");
  if (blocked) return "incompleteness";

  return "exploit";
}

function deterministicReflection(
  snapshot: TwinMindStateSnapshot,
  chosen: TwinMindVariant | undefined,
  force: TwinMindForce,
  error?: unknown
): ReflectionResult {
  const fallbackText = chosen
    ? `Continue the ${chosen.flavor.toLowerCase()} plan: ${chosen.recommendedSteps[0] ?? "make the next concrete improvement"}. Inspect before editing. Surface any blocker exactly as it appears. Show progress with a tiny diff or run.`
    : "Inspect the project, list the top blocker exactly, and propose the smallest next step.";

  const lastObs = snapshot.observations[snapshot.observations.length - 1];
  const observationLine = lastObs
    ? `Latest observation: [${lastObs.severity}] ${lastObs.headline}.`
    : "No observations yet.";

  const errorLine = error instanceof Error ? `Brain unreachable (${error.message.slice(0, 160)}).` : "";

  return {
    headline: chosen
      ? `Continue ${chosen.flavor} with deterministic next step.`
      : "Pick the smallest verifiable next step.",
    body: [
      `Force ${force}.`,
      observationLine,
      errorLine,
      "Falling back to deterministic guidance so the loop keeps moving."
    ]
      .filter(Boolean)
      .join(" "),
    force,
    nextAction: { kind: "send-prompt", text: fallbackText }
  };
}

export interface ObservationSummary {
  readonly hasErrors: boolean;
  readonly hasBlockers: boolean;
  readonly recentCount: number;
}

export function summarizeRecentObservations(
  observations: readonly TwinMindObservation[],
  windowSize = 12
): ObservationSummary {
  const recent = lastN(observations, windowSize);
  return {
    hasErrors: recent.some((o) => o.severity === "error"),
    hasBlockers: recent.some((o) => o.severity === "blocked"),
    recentCount: recent.length
  };
}
