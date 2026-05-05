import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadBuildBotPrimeEnv(cwd = process.cwd()): void {
  for (const fileName of [".env.local", ".env", ".env.env.txt"]) {
    const path = resolve(cwd, fileName);

    if (existsSync(path)) {
      applyEnvFile(path);
    }
  }
}

function applyEnvFile(path: string): void {
  const raw = readFileSync(path, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unwrapEnvValue(trimmed.slice(equalsIndex + 1).trim());

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function unwrapEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
