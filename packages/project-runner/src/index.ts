import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export interface ProjectDetection {
  readonly rootPath: string;
  readonly packageManager: PackageManager;
  readonly scripts: readonly string[];
  readonly installCommand?: string;
  readonly devCommand?: string;
  readonly testCommand?: string;
  readonly buildCommand?: string;
}

export interface RunnerEvent {
  readonly kind: "info" | "stdout" | "stderr" | "error" | "exit";
  readonly message: string;
  readonly timestamp: string;
  readonly exitCode?: number;
}

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

export async function detectProject(rootPath: string): Promise<ProjectDetection> {
  const packageManager = detectPackageManager(rootPath);
  const scripts = await readPackageScripts(rootPath);

  return {
    rootPath,
    packageManager,
    scripts,
    installCommand: createInstallCommand(packageManager),
    devCommand: createScriptCommand(packageManager, scripts, ["dev", "start"]),
    testCommand: createScriptCommand(packageManager, scripts, ["test"]),
    buildCommand: createScriptCommand(packageManager, scripts, ["build"])
  };
}

export function summarizeRunnerError(events: readonly RunnerEvent[]): string | undefined {
  const failure = [...events].reverse().find((event) => event.kind === "stderr" || event.kind === "error");

  if (!failure) {
    return undefined;
  }

  return failure.message.trim().slice(0, 4_000);
}

export function createRunnerEvent(kind: RunnerEvent["kind"], message: string, exitCode?: number): RunnerEvent {
  return {
    kind,
    message,
    exitCode,
    timestamp: new Date().toISOString()
  };
}

function detectPackageManager(rootPath: string): PackageManager {
  if (existsSync(join(rootPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(join(rootPath, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(join(rootPath, "bun.lockb")) || existsSync(join(rootPath, "bun.lock"))) {
    return "bun";
  }

  if (existsSync(join(rootPath, "package-lock.json")) || existsSync(join(rootPath, "package.json"))) {
    return "npm";
  }

  return "unknown";
}

async function readPackageScripts(rootPath: string): Promise<readonly string[]> {
  const packageJsonPath = join(rootPath, "package.json");

  if (!existsSync(packageJsonPath)) {
    return [];
  }

  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as PackageJson;

  return Object.keys(packageJson.scripts ?? {}).sort();
}

function createInstallCommand(packageManager: PackageManager): string | undefined {
  if (packageManager === "unknown") {
    return undefined;
  }

  return packageManager === "yarn" ? "yarn install" : `${packageManager} install`;
}

function createScriptCommand(
  packageManager: PackageManager,
  scripts: readonly string[],
  candidates: readonly string[]
): string | undefined {
  if (packageManager === "unknown") {
    return undefined;
  }

  const script = candidates.find((candidate) => scripts.includes(candidate));

  if (!script) {
    return undefined;
  }

  if (packageManager === "npm") {
    return `npm run ${script}`;
  }

  if (packageManager === "yarn") {
    return `yarn ${script}`;
  }

  return `${packageManager} run ${script}`;
}
