export type ModelProviderId =
  | "cursor-sdk"
  | "ollama-cloud"
  | "openai"
  | "anthropic"
  | "google"
  | "custom";
export type EnvMap = Record<string, string | undefined>;

export type AgenticModelStrength =
  | "coding"
  | "reasoning"
  | "planning"
  | "fast-feedback"
  | "large-context"
  | "tool-use"
  | "vision"
  | "swarm";

export interface AgenticModelProfile {
  readonly id: string;
  readonly label: string;
  readonly provider: ModelProviderId;
  readonly model: string;
  readonly localCloudModel?: string;
  readonly description: string;
  readonly strengths: readonly AgenticModelStrength[];
  readonly recommendedFor: readonly string[];
  readonly requiresApiKeyEnv?: string;
}

export interface ProviderRuntimeConfig {
  readonly id: ModelProviderId;
  readonly label: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly isConfigured: boolean;
}

export type ProviderFieldType = "secret" | "text" | "url";

export interface ProviderField {
  readonly key: string;
  readonly label: string;
  readonly type: ProviderFieldType;
  readonly required: boolean;
  readonly placeholder?: string;
  readonly helpText?: string;
}

export interface ProviderDescriptor {
  readonly id: ModelProviderId;
  readonly label: string;
  readonly tagline: string;
  readonly docsUrl?: string;
  readonly fields: readonly ProviderField[];
}

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: "cursor-sdk",
    label: "Cursor Agent",
    tagline: "Runs a real local Cursor agent against the selected project folder.",
    docsUrl: "https://cursor.com/dashboard/cloud-agents",
    fields: [
      {
        key: "CURSOR_API_KEY",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "cursor_...",
        helpText: "Create a user or service account key from the Cursor dashboard."
      },
      {
        key: "CURSOR_AGENT_MODEL",
        label: "Default model",
        type: "text",
        required: false,
        placeholder: "auto",
        helpText: "Use auto unless you need a specific Cursor model id."
      }
    ]
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    tagline: "Primary agentic host — Qwen3 Coder, DeepSeek, GPT-OSS, Kimi.",
    docsUrl: "https://ollama.com/settings/keys",
    fields: [
      {
        key: "OLLAMA_API_KEY",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "sk-ollama-…",
        helpText: "Generate at ollama.com/settings/keys."
      }
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    tagline: "Optional fallback. Bring your own agentic model name.",
    docsUrl: "https://platform.openai.com/api-keys",
    fields: [
      {
        key: "OPENAI_API_KEY",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "sk-…"
      },
      {
        key: "OPENAI_AGENTIC_MODEL",
        label: "Default model",
        type: "text",
        required: true,
        placeholder: "gpt-5.5-extra-high",
        helpText: "Name of the OpenAI model you want BuildBotPrime to steer with."
      }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    tagline: "Claude models for careful multi-step planning.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    fields: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "sk-ant-…"
      },
      {
        key: "ANTHROPIC_AGENTIC_MODEL",
        label: "Default model",
        type: "text",
        required: true,
        placeholder: "claude-4.6-sonnet-medium-thinking"
      }
    ]
  },
  {
    id: "google",
    label: "Google",
    tagline: "Gemini for large-context repo analysis.",
    docsUrl: "https://aistudio.google.com/app/apikey",
    fields: [
      {
        key: "GOOGLE_API_KEY",
        label: "API key",
        type: "secret",
        required: true,
        placeholder: "AIza…"
      },
      {
        key: "GOOGLE_AGENTIC_MODEL",
        label: "Default model",
        type: "text",
        required: true,
        placeholder: "gemini-3.1-pro"
      }
    ]
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    tagline: "Self-hosted or alternative OpenAI-compatible endpoints.",
    fields: [
      {
        key: "CUSTOM_AGENTIC_BASE_URL",
        label: "Base URL",
        type: "url",
        required: true,
        placeholder: "https://my-endpoint/v1"
      },
      {
        key: "CUSTOM_AGENTIC_MODEL",
        label: "Model name",
        type: "text",
        required: true,
        placeholder: "my-model-id"
      },
      {
        key: "CUSTOM_AGENTIC_API_KEY",
        label: "API key",
        type: "secret",
        required: false,
        placeholder: "Optional"
      }
    ]
  }
];

export function getProviderDescriptor(id: ModelProviderId): ProviderDescriptor | undefined {
  return PROVIDER_DESCRIPTORS.find((descriptor) => descriptor.id === id);
}

export function collectProviderEnvKeys(): readonly string[] {
  const keys = new Set<string>();
  for (const provider of PROVIDER_DESCRIPTORS) {
    for (const field of provider.fields) {
      keys.add(field.key);
    }
  }
  return [...keys];
}

export interface ModelProviderBootstrap {
  readonly providers: readonly ProviderRuntimeConfig[];
  readonly models: readonly AgenticModelProfile[];
  readonly defaultModelId: string;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface OllamaChatOptions {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly stream?: boolean;
}

export const OLLAMA_CLOUD_DIRECT_URL = "https://ollama.com";
export const OLLAMA_LOCAL_URL = "http://localhost:11434";
export const DEFAULT_AGENTIC_MODEL_ID = "ollama-qwen3-coder-480b";

export const AGENTIC_MODEL_PROFILES: readonly AgenticModelProfile[] = [
  {
    id: "cursor-agent-auto",
    label: "Cursor Agent Auto",
    provider: "cursor-sdk",
    model: "auto",
    description: "Runs the official Cursor local agent against the selected project folder.",
    strengths: ["coding", "tool-use", "large-context", "planning"],
    recommendedFor: ["real Cursor execution", "local repo edits", "agentic build loops"],
    requiresApiKeyEnv: "CURSOR_API_KEY"
  },
  {
    id: "cursor-composer-2",
    label: "Cursor Composer 2",
    provider: "cursor-sdk",
    model: "composer-2",
    description: "Cursor Composer 2 via the official SDK for deterministic local agent execution.",
    strengths: ["coding", "tool-use", "planning"],
    recommendedFor: ["Cursor local automation", "multi-file software builds"],
    requiresApiKeyEnv: "CURSOR_API_KEY"
  },
  {
    id: "ollama-qwen3-coder-480b",
    label: "Ollama Qwen3 Coder 480B",
    provider: "ollama-cloud",
    model: "qwen3-coder:480b",
    localCloudModel: "qwen3-coder:480b-cloud",
    description: "Primary agentic coding model for repo work, prompt steering, and IDE build loops.",
    strengths: ["coding", "tool-use", "large-context", "planning"],
    recommendedFor: ["Cursor prompting", "AgentPrime prompting", "multi-file repairs", "builder-loop follow-ups"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-deepseek-v31-671b",
    label: "Ollama DeepSeek V3.1 671B",
    provider: "ollama-cloud",
    model: "deepseek-v3.1:671b",
    localCloudModel: "deepseek-v3.1:671b-cloud",
    description: "Deep planning and agentic reasoning model for larger product decisions and debugging loops.",
    strengths: ["reasoning", "planning", "coding", "large-context"],
    recommendedFor: ["architecture prompts", "hard bug diagnosis", "agent swarm task plans"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-gpt-oss-120b",
    label: "Ollama GPT OSS 120B",
    provider: "ollama-cloud",
    model: "gpt-oss:120b",
    localCloudModel: "gpt-oss:120b-cloud",
    description: "Strong general agentic model for build orchestration, summaries, and next-step decisions.",
    strengths: ["reasoning", "planning", "tool-use"],
    recommendedFor: ["orchestration", "status summaries", "prompt rewrite passes"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-gpt-oss-20b-fast",
    label: "Ollama GPT OSS 20B Fast",
    provider: "ollama-cloud",
    model: "gpt-oss:20b",
    localCloudModel: "gpt-oss:20b-cloud",
    description: "Fast feedback model for quick prompt rewrites, log summaries, and small follow-ups.",
    strengths: ["fast-feedback", "planning"],
    recommendedFor: ["short error summaries", "quick continuation prompts", "lightweight validation notes"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-kimi-k26",
    label: "Ollama Kimi K2.6",
    provider: "ollama-cloud",
    model: "kimi-k2.6",
    description: "Long-horizon multimodal agentic model for coding-driven design, autonomous execution, and swarm task orchestration.",
    strengths: ["coding", "reasoning", "planning", "tool-use", "vision", "swarm"],
    recommendedFor: ["swarm planning", "long build sessions", "UI-aware product work", "autonomous execution prompts"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-glm-51",
    label: "Ollama GLM-5.1",
    provider: "ollama-cloud",
    model: "glm-5.1",
    description: "Agentic engineering model focused on strong coding, tool use, and multi-step software tasks.",
    strengths: ["coding", "reasoning", "planning", "tool-use"],
    recommendedFor: ["engineering prompts", "repo repair loops", "test failure diagnosis", "tool-heavy IDE steering"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-deepseek-v4-pro",
    label: "Ollama DeepSeek V4 Pro",
    provider: "ollama-cloud",
    model: "deepseek-v4-pro",
    description: "Frontier reasoning model with a large-context profile for hard debugging and architecture-level build steering.",
    strengths: ["reasoning", "planning", "large-context", "tool-use"],
    recommendedFor: ["hard blockers", "large-repo reasoning", "architecture reviews", "multi-attempt repair loops"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-deepseek-v4-flash",
    label: "Ollama DeepSeek V4 Flash",
    provider: "ollama-cloud",
    model: "deepseek-v4-flash",
    description: "Efficient reasoning model for quick diagnostic passes and fast iteration in the builder loop.",
    strengths: ["reasoning", "fast-feedback", "large-context", "tool-use"],
    recommendedFor: ["fast error triage", "log compression", "quick prompt repair", "iteration planning"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-qwen3-coder-next",
    label: "Ollama Qwen3-Coder-Next",
    provider: "ollama-cloud",
    model: "qwen3-coder-next",
    description: "Coding-focused model optimized for agentic local development and IDE-based software engineering workflows.",
    strengths: ["coding", "tool-use", "planning"],
    recommendedFor: ["Cursor build prompts", "AgentPrime build prompts", "multi-file coding tasks", "local development steering"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-devstral-small-2",
    label: "Ollama Devstral Small 2",
    provider: "ollama-cloud",
    model: "devstral-small-2",
    description: "Software engineering agent model for exploring codebases, editing multiple files, and practical development tasks.",
    strengths: ["coding", "tool-use", "vision", "fast-feedback"],
    recommendedFor: ["codebase exploration", "smaller repair loops", "multi-file edits", "fast IDE continuation prompts"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-gemma4",
    label: "Ollama Gemma 4",
    provider: "ollama-cloud",
    model: "gemma4",
    description: "Multimodal agentic workflow model useful when BuildBotPrime needs visual context plus reasoning.",
    strengths: ["vision", "reasoning", "tool-use", "planning"],
    recommendedFor: ["computer-vision observations", "UI state summaries", "multimodal build notes"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "ollama-qwen35",
    label: "Ollama Qwen 3.5",
    provider: "ollama-cloud",
    model: "qwen3.5",
    description: "General multimodal thinking model for broad agentic support and alternate reasoning paths.",
    strengths: ["vision", "reasoning", "planning", "tool-use"],
    recommendedFor: ["fallback steering", "multimodal reasoning", "large-context build support"],
    requiresApiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "openai-agentic-configured",
    label: "OpenAI Agentic Model",
    provider: "openai",
    model: "env:OPENAI_AGENTIC_MODEL",
    description: "Optional OpenAI agentic model configured by environment, not hardcoded.",
    strengths: ["coding", "reasoning", "tool-use"],
    recommendedFor: ["fallback provider", "agentic coding workflows"],
    requiresApiKeyEnv: "OPENAI_API_KEY"
  },
  {
    id: "anthropic-agentic-configured",
    label: "Anthropic Agentic Model",
    provider: "anthropic",
    model: "env:ANTHROPIC_AGENTIC_MODEL",
    description: "Optional Anthropic agentic model configured by environment, not hardcoded.",
    strengths: ["coding", "reasoning", "planning", "tool-use"],
    recommendedFor: ["fallback provider", "careful multi-step planning"],
    requiresApiKeyEnv: "ANTHROPIC_API_KEY"
  },
  {
    id: "google-agentic-configured",
    label: "Google Agentic Model",
    provider: "google",
    model: "env:GOOGLE_AGENTIC_MODEL",
    description: "Optional Google agentic model configured by environment, not hardcoded.",
    strengths: ["large-context", "reasoning", "planning"],
    recommendedFor: ["fallback provider", "large-context repo analysis"],
    requiresApiKeyEnv: "GOOGLE_API_KEY"
  }
];

export function getModelProviderBootstrap(env: EnvMap): ModelProviderBootstrap {
  return {
    providers: getProviderRuntimeConfigs(env),
    models: AGENTIC_MODEL_PROFILES,
    defaultModelId: DEFAULT_AGENTIC_MODEL_ID
  };
}

export function resolveModelProfile(id: string): AgenticModelProfile {
  return AGENTIC_MODEL_PROFILES.find((profile) => profile.id === id) ?? AGENTIC_MODEL_PROFILES[0];
}

export function resolveRuntimeModel(profile: AgenticModelProfile, env: EnvMap): string {
  if (!profile.model.startsWith("env:")) {
    return profile.model;
  }

  const envName = profile.model.slice("env:".length);
  return env[envName] ?? "";
}

export async function callOllamaCloudChat(
  options: OllamaChatOptions,
  env: EnvMap
): Promise<unknown> {
  const apiKey = env.OLLAMA_API_KEY;

  if (!apiKey) {
    throw new Error("OLLAMA_API_KEY is required for direct Ollama Cloud API calls.");
  }

  const response = await fetch(`${OLLAMA_CLOUD_DIRECT_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: options.stream ?? false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama Cloud chat failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function getProviderRuntimeConfigs(env: EnvMap): readonly ProviderRuntimeConfig[] {
  return [
    {
      id: "cursor-sdk",
      label: "Cursor Agent",
      apiKeyEnv: "CURSOR_API_KEY",
      isConfigured: Boolean(env.CURSOR_API_KEY)
    },
    {
      id: "ollama-cloud",
      label: "Ollama Cloud",
      baseUrl: OLLAMA_CLOUD_DIRECT_URL,
      apiKeyEnv: "OLLAMA_API_KEY",
      isConfigured: Boolean(env.OLLAMA_API_KEY)
    },
    {
      id: "openai",
      label: "OpenAI",
      apiKeyEnv: "OPENAI_API_KEY",
      isConfigured: Boolean(env.OPENAI_API_KEY && env.OPENAI_AGENTIC_MODEL)
    },
    {
      id: "anthropic",
      label: "Anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      isConfigured: Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_AGENTIC_MODEL)
    },
    {
      id: "google",
      label: "Google",
      apiKeyEnv: "GOOGLE_API_KEY",
      isConfigured: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_AGENTIC_MODEL)
    },
    {
      id: "custom",
      label: "Custom Agentic Provider",
      baseUrl: env.CUSTOM_AGENTIC_BASE_URL,
      apiKeyEnv: "CUSTOM_AGENTIC_API_KEY",
      isConfigured: Boolean(env.CUSTOM_AGENTIC_BASE_URL && env.CUSTOM_AGENTIC_MODEL)
    }
  ];
}
