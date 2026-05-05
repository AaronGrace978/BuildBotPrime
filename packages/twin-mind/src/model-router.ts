import type { AgenticModelProfile, ModelProviderId } from "@buildbotprime/model-providers";
import type { TwinMindPhase } from "./types.js";

export interface ModelRouterContext {
  readonly available: readonly AgenticModelProfile[];
  readonly providerStatus: Record<ModelProviderId, boolean>;
  readonly currentModelId: string;
  readonly fallbackModelId: string;
}

export interface ModelChoice {
  readonly modelId: string;
  readonly reason: string;
}

/**
 * Phase-based model router. Mirrors the user's habit of swapping models —
 * heavy planner for ponder/reflect, fast model for quick observe loops,
 * coder for prompting the IDE, etc.
 */
export function pickModelForPhase(phase: TwinMindPhase, ctx: ModelRouterContext): ModelChoice {
  const desiredStrengths = strengthsForPhase(phase);
  const ranked = rankModels(ctx.available, ctx.providerStatus, desiredStrengths);

  const top = ranked[0];
  if (top) {
    return {
      modelId: top.id,
      reason: `Selected ${top.label} for ${phase} (matches ${desiredStrengths.join(", ")}).`
    };
  }

  return {
    modelId: ctx.fallbackModelId,
    reason: `No configured provider matched ${phase}; staying on fallback.`
  };
}

function strengthsForPhase(phase: TwinMindPhase): readonly string[] {
  switch (phase) {
    case "pondering":
      return ["planning", "reasoning", "large-context"];
    case "selecting":
      return ["reasoning", "planning"];
    case "prompting":
      return ["coding", "tool-use", "planning"];
    case "observing":
      return ["fast-feedback", "reasoning"];
    case "reflecting":
      return ["reasoning", "planning"];
    case "swapping-model":
      return ["reasoning"];
    default:
      return ["coding", "planning"];
  }
}

function rankModels(
  available: readonly AgenticModelProfile[],
  providerStatus: Record<ModelProviderId, boolean>,
  desired: readonly string[]
): readonly AgenticModelProfile[] {
  const desiredSet = new Set(desired);
  return [...available]
    .filter((profile) => providerStatus[profile.provider] === true)
    .map((profile) => ({
      profile,
      score: profile.strengths.reduce(
        (sum, strength) => (desiredSet.has(strength) ? sum + 1 : sum),
        0
      )
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.profile);
}
