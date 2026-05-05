export type ProductId =
  | "cursor"
  | "claude-code"
  | "agentprime"
  | "windsurf"
  | "codex"
  | "lovable";

export type ProductState =
  | "ready"
  | "working"
  | "waiting-for-approval"
  | "login-required"
  | "rate-limited"
  | "command-failed"
  | "stuck"
  | "done";

export interface ProductPlaybook {
  readonly id: ProductId;
  readonly displayName: string;
  readonly launchNames: readonly string[];
  readonly supportedSurfaces: readonly ProductSurface[];
  readonly defaultShortcuts: readonly ProductShortcut[];
  readonly modelSelection: ModelSelectionGuide;
  readonly promptDelivery: PromptDeliveryGuide;
  readonly observableStates: readonly ProductStateGuide[];
  readonly fallbackStrategy: readonly string[];
  readonly notes: readonly string[];
}

export interface ProductSurface {
  readonly id: string;
  readonly label: string;
  readonly hints: readonly string[];
}

export interface ProductShortcut {
  readonly action: string;
  readonly windows: string;
  readonly mac?: string;
  readonly linux?: string;
}

export interface ModelSelectionGuide {
  readonly supported: boolean;
  readonly hints: readonly string[];
}

export interface PromptDeliveryGuide {
  readonly primarySurface: string;
  readonly steps: readonly string[];
  readonly continuationHints: readonly string[];
}

export interface ProductStateGuide {
  readonly state: ProductState;
  readonly signals: readonly string[];
  readonly response: string;
}

export const PRODUCT_PLAYBOOKS: Record<ProductId, ProductPlaybook> = {
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    launchNames: ["Cursor", "cursor"],
    supportedSurfaces: [
      {
        id: "composer",
        label: "Agent composer",
        hints: ["Chat input", "agent panel", "composer box", "Ask/Agent mode selector"]
      },
      {
        id: "terminal",
        label: "Integrated terminal",
        hints: ["Problems panel", "terminal tabs", "command output"]
      },
      {
        id: "model-selector",
        label: "Model selector",
        hints: ["model dropdown", "agent mode controls", "thinking controls"]
      }
    ],
    defaultShortcuts: [
      { action: "Open command palette", windows: "Ctrl+Shift+P", mac: "Cmd+Shift+P" },
      { action: "Open integrated terminal", windows: "Ctrl+`", mac: "Ctrl+`" },
      { action: "Focus chat or composer", windows: "Ctrl+L", mac: "Cmd+L" }
    ],
    modelSelection: {
      supported: true,
      hints: ["Prefer configured user default unless a build profile requests a specific model."]
    },
    promptDelivery: {
      primarySurface: "composer",
      steps: [
        "Open the target folder in Cursor.",
        "Focus the agent composer.",
        "Paste the composed build prompt.",
        "Submit the prompt and wait for working or approval signals."
      ],
      continuationHints: ["Paste concise runner errors back into the same conversation."]
    },
    observableStates: [
      {
        state: "working",
        signals: ["files changing", "agent status indicates working", "terminal commands running"],
        response: "Keep observing and avoid interrupting."
      },
      {
        state: "waiting-for-approval",
        signals: ["approval buttons", "command confirmation", "apply changes confirmation"],
        response: "Ask the user before approving risky or unclear actions."
      },
      {
        state: "command-failed",
        signals: ["terminal error", "test failure", "build failed"],
        response: "Extract the smallest useful failure and feed it back to the composer."
      }
    ],
    fallbackStrategy: [
      "Use keyboard shortcuts before screen-coordinate actions.",
      "Use screenshots and OCR when the current UI surface cannot be found structurally.",
      "Stop for manual takeover after repeated login, permission, or unknown modal blockers."
    ],
    notes: ["Cursor is the first MVP target."]
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    launchNames: ["Claude Code", "claude", "claude-code"],
    supportedSurfaces: [
      {
        id: "terminal",
        label: "Claude Code terminal",
        hints: ["CLI prompt", "streamed tool output", "approval prompts"]
      },
      {
        id: "ide-extension",
        label: "IDE extension panel",
        hints: ["VS Code side panel", "JetBrains panel", "agent transcript"]
      }
    ],
    defaultShortcuts: [
      { action: "Launch Claude Code", windows: "claude", mac: "claude", linux: "claude" },
      { action: "Continue previous session", windows: "claude --continue", mac: "claude --continue" }
    ],
    modelSelection: {
      supported: true,
      hints: [
        "Claude Code uses the active Anthropic model; steering happens through the prompt and slash commands.",
        "Prefer the user's configured default model unless a profile explicitly requests another."
      ]
    },
    promptDelivery: {
      primarySurface: "terminal",
      steps: [
        "Open the target project directory in a terminal.",
        "Run `claude` or focus the Claude Code IDE panel.",
        "Paste the composed build prompt.",
        "Approve tool use deliberately and watch for task completion signals."
      ],
      continuationHints: [
        "Use `claude --continue` to resume the latest session.",
        "Feed back exact terminal/test failures as follow-up prompts."
      ]
    },
    observableStates: [
      {
        state: "working",
        signals: ["tool calls streaming", "file edits", "progress indicators"],
        response: "Observe without interrupting; prepare the next prompt if a loop completes."
      },
      {
        state: "waiting-for-approval",
        signals: ["tool approval prompt", "edit confirmation", "shell command confirmation"],
        response: "Ask the user before approving risky operations."
      },
      {
        state: "command-failed",
        signals: ["non-zero exit code", "test failure", "error in tool call output"],
        response: "Capture the exact failure and return it as the next prompt."
      }
    ],
    fallbackStrategy: [
      "Prefer CLI invocations over UI automation.",
      "Escalate to manual takeover when Claude Code blocks on authentication or ambiguous approvals."
    ],
    notes: ["Claude Code is a first-class CLI/IDE target alongside Cursor."]
  },
  agentprime: {
    id: "agentprime",
    displayName: "AgentPrime",
    launchNames: ["AgentPrime", "agentprime"],
    supportedSurfaces: [
      {
        id: "builder-chat",
        label: "Builder chat",
        hints: ["primary prompt surface", "model profile", "project context"]
      }
    ],
    defaultShortcuts: [
      { action: "Open command palette", windows: "Ctrl+Shift+P", mac: "Cmd+Shift+P" }
    ],
    modelSelection: {
      supported: true,
      hints: ["Treat model/profile selection as a first-class adapter capability."]
    },
    promptDelivery: {
      primarySurface: "builder-chat",
      steps: [
        "Launch AgentPrime.",
        "Open or attach the selected project.",
        "Select the requested builder profile.",
        "Send the composed build prompt."
      ],
      continuationHints: ["Continue in the same build thread when possible."]
    },
    observableStates: [
      {
        state: "ready",
        signals: ["builder chat available", "project loaded"],
        response: "Send the next build prompt."
      }
    ],
    fallbackStrategy: [
      "Use the same adapter contract as Cursor.",
      "Capture missing surfaces as product knowledge updates instead of hard-coding one-off behavior."
    ],
    notes: ["AgentPrime is reserved as a first-class peer IDE."]
  },
  windsurf: {
    id: "windsurf",
    displayName: "Windsurf",
    launchNames: ["Windsurf", "windsurf"],
    supportedSurfaces: [{ id: "cascade", label: "Cascade chat", hints: ["AI panel", "project context"] }],
    defaultShortcuts: [{ action: "Open command palette", windows: "Ctrl+Shift+P", mac: "Cmd+Shift+P" }],
    modelSelection: { supported: true, hints: ["Confirm available controls during adapter implementation."] },
    promptDelivery: {
      primarySurface: "cascade",
      steps: ["Open the repo.", "Focus Cascade.", "Paste the composed build prompt."],
      continuationHints: ["Use runner failures as concise continuation prompts."]
    },
    observableStates: [],
    fallbackStrategy: ["Implement after Cursor and AgentPrime stabilize."],
    notes: ["Future adapter target."]
  },
  lovable: {
    id: "lovable",
    displayName: "Lovable",
    launchNames: ["Lovable", "lovable"],
    supportedSurfaces: [
      {
        id: "web-builder",
        label: "Lovable web builder",
        hints: ["browser tab", "project workspace", "chat sidebar", "live preview pane"]
      },
      {
        id: "prompt-composer",
        label: "Lovable prompt composer",
        hints: ["chat input", "attachment drop zone", "model/profile controls"]
      }
    ],
    defaultShortcuts: [
      { action: "Focus prompt composer", windows: "Ctrl+/", mac: "Cmd+/" },
      { action: "Toggle preview pane", windows: "Ctrl+P", mac: "Cmd+P" }
    ],
    modelSelection: {
      supported: false,
      hints: [
        "Lovable manages its own agent model.",
        "Steer through prompt phrasing and project context instead of model overrides."
      ]
    },
    promptDelivery: {
      primarySurface: "prompt-composer",
      steps: [
        "Open or create the target Lovable project in the browser.",
        "Focus the prompt composer sidebar.",
        "Paste the composed build prompt and any project context.",
        "Watch the live preview and file tree for completion signals."
      ],
      continuationHints: [
        "Use the preview pane to detect visual regressions.",
        "Send exact console or preview errors as continuation prompts in the same project."
      ]
    },
    observableStates: [
      {
        state: "working",
        signals: ["preview spinner", "file tree updates", "streaming chat response"],
        response: "Let Lovable finish before sending follow-up prompts."
      },
      {
        state: "command-failed",
        signals: ["preview error overlay", "console errors", "build log failure"],
        response: "Copy the minimal failure excerpt and return it as the next prompt."
      }
    ],
    fallbackStrategy: [
      "Use browser automation only when the composer is unreachable.",
      "Escalate to manual takeover on login, billing, or deploy approval prompts."
    ],
    notes: ["Lovable is a browser-based builder; treat it like Cursor with a web surface."]
  },
  codex: {
    id: "codex",
    displayName: "Codex",
    launchNames: ["Codex", "codex"],
    supportedSurfaces: [{ id: "prompt", label: "Prompt surface", hints: ["task prompt", "terminal session"] }],
    defaultShortcuts: [],
    modelSelection: { supported: false, hints: ["Prefer CLI or product API configuration when available."] },
    promptDelivery: {
      primarySurface: "prompt",
      steps: ["Open the target product.", "Attach project context.", "Send the composed build prompt."],
      continuationHints: ["Send exact failures as follow-up prompts."]
    },
    observableStates: [],
    fallbackStrategy: ["Prefer API/CLI automation over UI automation when available."],
    notes: ["Future adapter target."]
  }
};

export function getProductPlaybook(id: ProductId): ProductPlaybook {
  return PRODUCT_PLAYBOOKS[id];
}

export function listProductPlaybooks(): readonly ProductPlaybook[] {
  return Object.values(PRODUCT_PLAYBOOKS);
}
