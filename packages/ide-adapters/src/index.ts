import { getProductPlaybook, type ProductId, type ProductPlaybook } from "@buildbotprime/product-knowledge";

export type IdeActionKind =
  | "launch"
  | "open-project"
  | "select-model"
  | "send-prompt"
  | "observe"
  | "manual-takeover";

export interface IdeAction {
  readonly kind: IdeActionKind;
  readonly label: string;
  readonly details: string;
  readonly requiresUserApproval?: boolean;
}

export interface IdeAutomationContext {
  readonly projectPath?: string;
  readonly repoUrl?: string;
  readonly modelProfile?: string;
  readonly prompt: string;
}

export interface IdeAutomationAdapter {
  readonly id: ProductId;
  readonly playbook: ProductPlaybook;
  planBuildActions(context: IdeAutomationContext): readonly IdeAction[];
}

export class CursorIdeAdapter implements IdeAutomationAdapter {
  readonly id = "cursor";
  readonly playbook = getProductPlaybook("cursor");

  planBuildActions(context: IdeAutomationContext): readonly IdeAction[] {
    return [
      {
        kind: "launch",
        label: "Open Cursor",
        details: context.projectPath
          ? `Launch Cursor with ${context.projectPath}.`
          : "Launch Cursor and wait for a project folder."
      },
      {
        kind: "select-model",
        label: "Confirm Cursor model",
        details: context.modelProfile
          ? `Select the ${context.modelProfile} model/profile when available.`
          : "Use the user's configured Cursor default model/profile."
      },
      {
        kind: "send-prompt",
        label: "Send builder prompt",
        details: context.prompt
      },
      {
        kind: "observe",
        label: "Observe Cursor work",
        details: "Watch file changes, terminal output, approvals, and the composer state."
      }
    ];
  }
}

export class ClaudeCodeIdeAdapter implements IdeAutomationAdapter {
  readonly id = "claude-code";
  readonly playbook = getProductPlaybook("claude-code");

  planBuildActions(context: IdeAutomationContext): readonly IdeAction[] {
    return [
      {
        kind: "launch",
        label: "Start Claude Code",
        details: context.projectPath
          ? `Open a terminal in ${context.projectPath} and run 'claude'.`
          : "Open a terminal in the target project and run 'claude'."
      },
      {
        kind: "select-model",
        label: "Confirm Claude Code model",
        details: context.modelProfile
          ? `Ensure Claude Code is using the ${context.modelProfile} profile.`
          : "Use the user's configured Claude Code default model."
      },
      {
        kind: "send-prompt",
        label: "Send builder prompt",
        details: context.prompt
      },
      {
        kind: "observe",
        label: "Watch Claude Code transcript",
        details: "Stream tool calls, edits, and approval prompts; keep the user in control for risky actions.",
        requiresUserApproval: true
      }
    ];
  }
}

export class AgentPrimeIdeAdapter implements IdeAutomationAdapter {
  readonly id = "agentprime";
  readonly playbook = getProductPlaybook("agentprime");

  planBuildActions(context: IdeAutomationContext): readonly IdeAction[] {
    return [
      {
        kind: "launch",
        label: "Open AgentPrime",
        details: context.projectPath
          ? `Launch AgentPrime with ${context.projectPath}.`
          : "Launch AgentPrime and prepare for project attachment."
      },
      {
        kind: "select-model",
        label: "Confirm AgentPrime profile",
        details: context.modelProfile
          ? `Use the ${context.modelProfile} builder profile.`
          : "Use the user's default AgentPrime builder profile."
      },
      {
        kind: "send-prompt",
        label: "Send builder prompt",
        details: context.prompt
      }
    ];
  }
}

export class LovableIdeAdapter implements IdeAutomationAdapter {
  readonly id = "lovable";
  readonly playbook = getProductPlaybook("lovable");

  planBuildActions(context: IdeAutomationContext): readonly IdeAction[] {
    return [
      {
        kind: "launch",
        label: "Open Lovable",
        details: context.repoUrl
          ? `Open the Lovable project linked to ${context.repoUrl} in the browser.`
          : "Open or create the Lovable project in the browser."
      },
      {
        kind: "send-prompt",
        label: "Send composed prompt",
        details: context.prompt
      },
      {
        kind: "observe",
        label: "Watch preview and file tree",
        details: "Detect preview errors and console messages to compose follow-up prompts."
      }
    ];
  }
}

export function createIdeAdapter(id: ProductId): IdeAutomationAdapter {
  if (id === "claude-code") {
    return new ClaudeCodeIdeAdapter();
  }

  if (id === "agentprime") {
    return new AgentPrimeIdeAdapter();
  }

  if (id === "cursor") {
    return new CursorIdeAdapter();
  }

  if (id === "lovable") {
    return new LovableIdeAdapter();
  }

  return {
    id,
    playbook: getProductPlaybook(id),
    planBuildActions(context) {
      return [
        {
          kind: "manual-takeover",
          label: `Prepare ${this.playbook.displayName}`,
          details: `The ${this.playbook.displayName} adapter is a future target. Prompt prepared: ${context.prompt}`,
          requiresUserApproval: true
        }
      ];
    }
  };
}
