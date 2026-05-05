import type { BuilderRequest } from "@buildbotprime/core";
import type { TwinMindChatOptions, TwinMindVariant } from "./types.js";

const VARIANT_FLAVORS: ReadonlyArray<{
  readonly flavor: string;
  readonly mood: string;
  readonly stance: string;
}> = [
  {
    flavor: "Lean MVP",
    mood: "ship-the-smallest-real-thing",
    stance: "Cut the scope. Identify the smallest version that proves the core experience. Ignore everything optional."
  },
  {
    flavor: "Ambitious Sprawl",
    mood: "go-hog-wild",
    stance: "Take the user's vibe to its loud, maximalist conclusion. Add the dream features they hinted at, even the ones they almost mentioned."
  },
  {
    flavor: "Refactor First",
    mood: "fix-the-foundation",
    stance: "Audit the existing code before adding new things. Surface debt that will block the build, then propose the clean shape."
  },
  {
    flavor: "Vibes Mirror",
    mood: "match-the-builder",
    stance: "Match the user's existing voice and project conventions. Prefer their patterns, naming, and stack."
  },
  {
    flavor: "Risk Reverser",
    mood: "kill-the-blocker",
    stance: "Find the single piece most likely to ruin the run and tackle that first; nothing else matters until it's tamed."
  },
  {
    flavor: "Spike & Demo",
    mood: "make-it-feel-real-fast",
    stance: "Wire a demo-shaped UI with stubs and fakes so the user can see and click before any heavy logic lands."
  }
];

export interface PonderInput {
  readonly request: BuilderRequest;
  readonly intakeText?: string;
  readonly variantCount: number;
  readonly callChat: (options: TwinMindChatOptions) => Promise<string>;
  readonly steeringModelId: string;
}

/**
 * Generates a slate of candidate build approaches by mixing curated archetypes
 * with the user's own prompt and any attached project intake text. Each variant
 * is then scored by a single brain call.
 */
export async function ponderVariants(input: PonderInput): Promise<readonly TwinMindVariant[]> {
  const flavors = VARIANT_FLAVORS.slice(0, Math.max(1, Math.min(input.variantCount, VARIANT_FLAVORS.length)));
  const stub: readonly TwinMindVariant[] = flavors.map((entry, index) => ({
    id: `variant_${Date.now().toString(36)}_${index}`,
    title: `${entry.flavor} for ${shortDescriptor(input.request.prompt)}`,
    flavor: entry.flavor,
    summary: `${entry.stance} (${entry.mood})`,
    riskNotes: defaultRisks(entry.flavor),
    score: 0.5,
    recommendedSteps: defaultSteps(entry.flavor)
  }));

  let scored: readonly TwinMindVariant[] = stub;
  try {
    const rationaleRaw = await input.callChat({
      modelId: input.steeringModelId,
      system: PONDER_SYSTEM_PROMPT,
      user: buildPonderUserPrompt(input.request, input.intakeText, stub),
      temperature: 0.85,
      maxOutputTokens: 1400
    });
    const parsed = parsePonderResponse(rationaleRaw, stub);
    if (parsed.length > 0) scored = parsed;
  } catch {
    // keep deterministic stub
  }

  return scored
    .map((variant) => ({
      ...variant,
      score: clamp(variant.score, 0, 1)
    }))
    .sort((a, b) => b.score - a.score);
}

function shortDescriptor(prompt: string): string {
  const trimmed = prompt.trim().split(/\s+/).slice(0, 5).join(" ");
  return trimmed || "this build";
}

function defaultRisks(flavor: string): readonly string[] {
  switch (flavor) {
    case "Lean MVP":
      return ["May feel under-built if the user is in maximal mood."];
    case "Ambitious Sprawl":
      return ["Easy to bloat scope and miss the actual ship."];
    case "Refactor First":
      return ["Can stall before any visible feature lands."];
    case "Vibes Mirror":
      return ["Risk of repeating existing pain instead of fixing it."];
    case "Risk Reverser":
      return ["May tunnel on the blocker and lose builder momentum."];
    case "Spike & Demo":
      return ["Demo tech debt can leak into production code."];
    default:
      return ["Unknown risks — variant generated without a brain call."];
  }
}

function defaultSteps(flavor: string): readonly string[] {
  switch (flavor) {
    case "Lean MVP":
      return [
        "Write a single user story for the smallest end-to-end flow.",
        "Stub everything else with TODOs.",
        "Run the project and iterate one feature at a time."
      ];
    case "Ambitious Sprawl":
      return [
        "Brainstorm the dream features the user hinted at.",
        "Wire a multi-screen scaffold.",
        "Layer on extras the user will smile at."
      ];
    case "Refactor First":
      return [
        "Inspect the project before any new work.",
        "List the top blockers and propose a clean shape.",
        "Apply the smallest reorganization that unblocks the run."
      ];
    case "Vibes Mirror":
      return [
        "Index the user's existing files and conventions.",
        "Draft the plan in their voice.",
        "Build only with patterns they already use."
      ];
    case "Risk Reverser":
      return [
        "Find the most dangerous unknown.",
        "Build a minimal probe that resolves it.",
        "Only after the probe succeeds, plan the rest."
      ];
    case "Spike & Demo":
      return [
        "Sketch a fake-data demo shell.",
        "Make it look and click as if real.",
        "Replace fakes with real logic in priority order."
      ];
    default:
      return ["Plan", "Build", "Run"];
  }
}

function buildPonderUserPrompt(
  request: BuilderRequest,
  intakeText: string | undefined,
  stub: readonly TwinMindVariant[]
): string {
  return [
    "USER PROMPT:",
    request.prompt,
    "",
    request.projectPath ? `LOCAL PROJECT: ${request.projectPath}` : "LOCAL PROJECT: not specified",
    request.repoUrl ? `REPO URL: ${request.repoUrl}` : "",
    "",
    request.behaviorProfile?.promptStyle?.length
      ? `BUILDER STYLE NOTES:\n${request.behaviorProfile.promptStyle.map((line) => `- ${line}`).join("\n")}`
      : "",
    intakeText ? `INTAKE EXCERPT:\n${intakeText.slice(0, 4000)}` : "",
    "",
    "CANDIDATE VARIANTS (rate each one and rewrite the summary in the user's voice):",
    ...stub.map((variant, index) =>
      [
        `${index + 1}. ${variant.flavor} — ${variant.summary}`,
        `   risks: ${variant.riskNotes.join("; ")}`
      ].join("\n")
    ),
    "",
    "Return JSON of the form:",
    '{ "variants": [{ "flavor": string, "title": string, "summary": string, "score": 0..1, "riskNotes": string[], "recommendedSteps": string[] }] }',
    "Score = 1.0 means it most closely fits the user's intent and stack. Order matters: best first."
  ]
    .filter(Boolean)
    .join("\n");
}

function parsePonderResponse(raw: string, stub: readonly TwinMindVariant[]): readonly TwinMindVariant[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as {
      variants?: Array<{
        flavor?: string;
        title?: string;
        summary?: string;
        score?: number;
        riskNotes?: string[];
        recommendedSteps?: string[];
      }>;
    };
    if (!parsed.variants?.length) return [];
    return parsed.variants
      .map((variant, index) => {
        const stubMatch =
          stub.find((entry) => entry.flavor.toLowerCase() === String(variant.flavor ?? "").toLowerCase()) ??
          stub[index] ??
          stub[0];
        return {
          id: stubMatch.id,
          flavor: variant.flavor || stubMatch.flavor,
          title: variant.title || stubMatch.title,
          summary: variant.summary || stubMatch.summary,
          score: typeof variant.score === "number" ? variant.score : stubMatch.score,
          riskNotes:
            Array.isArray(variant.riskNotes) && variant.riskNotes.length > 0
              ? variant.riskNotes
              : stubMatch.riskNotes,
          recommendedSteps:
            Array.isArray(variant.recommendedSteps) && variant.recommendedSteps.length > 0
              ? variant.recommendedSteps
              : stubMatch.recommendedSteps
        } satisfies TwinMindVariant;
      })
      .filter((variant) => variant.title && variant.summary);
  } catch {
    return [];
  }
}

function clamp(n: number, low: number, high: number): number {
  if (Number.isNaN(n)) return low;
  return Math.max(low, Math.min(high, n));
}

export const PONDER_SYSTEM_PROMPT = `You are the PONDER engine of BuildBotPrime — a builder twin that thinks like the user.
You weigh several different build approaches before writing a prompt for an IDE.

Goals:
- Mirror the user's voice and habits.
- Reward variants that match their stack, scope, and vibe.
- Keep summaries short, direct, and useful.
- Score each variant from 0..1 (1 = best fit). Output ONLY JSON, no commentary.`;
