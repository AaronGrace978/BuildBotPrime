import type { AgenticModelProfile, EnvMap } from "@buildbotprime/model-providers";
import { OLLAMA_CLOUD_DIRECT_URL } from "@buildbotprime/model-providers";
import type { TwinMindChatOptions } from "./types.js";

export interface ProviderCallContext {
  readonly profile: AgenticModelProfile;
  readonly env: EnvMap;
  readonly options: TwinMindChatOptions;
}

/**
 * Provider-agnostic chat call. The TwinMind engine uses this to talk to whichever
 * agentic brain is configured. Falls back to a deterministic local rationale when
 * no provider is reachable so the loop still progresses without API access.
 */
export async function callTwinMindChat(context: ProviderCallContext): Promise<string> {
  const { profile, env, options } = context;

  try {
    if (profile.provider === "ollama-cloud") {
      return await callOllama(options, env, profile);
    }
    if (profile.provider === "openai") {
      return await callOpenAi(options, env, profile.model);
    }
    if (profile.provider === "anthropic") {
      return await callAnthropic(options, env, profile.model);
    }
    if (profile.provider === "google") {
      return await callGoogle(options, env, profile.model);
    }
    if (profile.provider === "custom") {
      return await callCustom(options, env, profile.model);
    }
    if (profile.provider === "cursor-sdk") {
      return offlineFallback(options, profile);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return offlineFallback(options, profile, message);
  }

  return offlineFallback(options, profile);
}

async function callOllama(
  options: TwinMindChatOptions,
  env: EnvMap,
  profile: AgenticModelProfile
): Promise<string> {
  const apiKey = env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error("OLLAMA_API_KEY is missing");

  const model = profile.localCloudModel ?? profile.model;
  const response = await fetch(`${OLLAMA_CLOUD_DIRECT_URL}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user }
      ],
      options: { temperature: options.temperature ?? 0.7 }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama Cloud chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama Cloud returned empty content");
  return content;
}

async function callOpenAi(
  options: TwinMindChatOptions,
  env: EnvMap,
  modelTemplate: string
): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

  const model = resolveEnvModel(modelTemplate, env, "OPENAI_AGENTIC_MODEL");
  if (!model) throw new Error("OPENAI_AGENTIC_MODEL is missing");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxOutputTokens ?? 1400,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

async function callAnthropic(
  options: TwinMindChatOptions,
  env: EnvMap,
  modelTemplate: string
): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");

  const model = resolveEnvModel(modelTemplate, env, "ANTHROPIC_AGENTIC_MODEL");
  if (!model) throw new Error("ANTHROPIC_AGENTIC_MODEL is missing");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxOutputTokens ?? 1400,
      system: options.system,
      messages: [{ role: "user", content: options.user }],
      temperature: options.temperature ?? 0.6
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned empty content");
  return text;
}

async function callGoogle(
  options: TwinMindChatOptions,
  env: EnvMap,
  modelTemplate: string
): Promise<string> {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is missing");

  const model = resolveEnvModel(modelTemplate, env, "GOOGLE_AGENTIC_MODEL");
  if (!model) throw new Error("GOOGLE_AGENTIC_MODEL is missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.system }] },
      contents: [{ role: "user", parts: [{ text: options.user }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.6,
        maxOutputTokens: options.maxOutputTokens ?? 1400
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Google chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Google returned empty content");
  return text;
}

async function callCustom(
  options: TwinMindChatOptions,
  env: EnvMap,
  modelTemplate: string
): Promise<string> {
  const baseUrl = env.CUSTOM_AGENTIC_BASE_URL;
  if (!baseUrl) throw new Error("CUSTOM_AGENTIC_BASE_URL is missing");

  const model = env.CUSTOM_AGENTIC_MODEL || modelTemplate;
  if (!model) throw new Error("CUSTOM_AGENTIC_MODEL is missing");

  const apiKey = env.CUSTOM_AGENTIC_API_KEY;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxOutputTokens ?? 1400,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Custom chat ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Custom endpoint returned empty content");
  return content;
}

function resolveEnvModel(
  modelTemplate: string,
  env: EnvMap,
  fallbackKey: string
): string | undefined {
  if (modelTemplate.startsWith("env:")) {
    const key = modelTemplate.slice("env:".length);
    return env[key] ?? env[fallbackKey];
  }
  return modelTemplate || env[fallbackKey];
}

/**
 * Offline reasoning fallback. Even without API keys, BuildBotPrime should
 * keep cycling — produce a deterministic plan summary instead of crashing.
 */
function offlineFallback(
  options: TwinMindChatOptions,
  profile: AgenticModelProfile,
  errorNote?: string
): string {
  const reason = errorNote ? `Offline brain (reason: ${errorNote.slice(0, 180)}).` : "Offline brain.";
  return JSON.stringify({
    headline: "Offline reasoning step",
    rationale: [
      reason,
      `Steering profile would-have-been ${profile.label} (${profile.provider}).`,
      "Falling back to deterministic next-step heuristics so the loop keeps moving."
    ].join(" "),
    nextAction: "ASK_USER",
    notes: options.user.slice(0, 300)
  });
}
