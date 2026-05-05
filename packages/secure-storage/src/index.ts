import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type SecretMap = Record<string, string>;

export interface SecretStoreDependencies {
  readonly filePath: string;
  readonly encrypt: (plain: string) => Buffer | null;
  readonly decrypt: (buffer: Buffer) => string | null;
  readonly isEncryptionAvailable: () => boolean;
}

interface StoredPayload {
  readonly version: 1;
  readonly encrypted: boolean;
  readonly payload: string;
}

/**
 * Secret store backed by Electron's safeStorage API (which uses the OS
 * keychain — Credential Manager on Windows, Keychain on macOS, Secret Service
 * on Linux). Falls back to plain JSON with a loud warning when encryption is
 * unavailable so first-run on fresh Linux installs still works.
 */
export class SecretStore {
  private cache: SecretMap | undefined;

  constructor(private readonly deps: SecretStoreDependencies) {}

  readAll(): SecretMap {
    if (this.cache) {
      return { ...this.cache };
    }

    if (!existsSync(this.deps.filePath)) {
      this.cache = {};
      return {};
    }

    try {
      const raw = readFileSync(this.deps.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredPayload;

      if (parsed.encrypted) {
        const plain = this.deps.decrypt(Buffer.from(parsed.payload, "base64"));
        if (!plain) {
          console.warn("[secure-storage] Failed to decrypt keychain payload; starting empty.");
          this.cache = {};
          return {};
        }
        this.cache = JSON.parse(plain) as SecretMap;
      } else {
        this.cache = JSON.parse(parsed.payload) as SecretMap;
      }

      return { ...this.cache };
    } catch (error) {
      console.warn("[secure-storage] Corrupted keychain file, resetting.", error);
      this.cache = {};
      return {};
    }
  }

  readKey(key: string): string | undefined {
    const map = this.readAll();
    return map[key];
  }

  writeAll(values: SecretMap): void {
    this.cache = { ...values };
    const plain = JSON.stringify(this.cache);
    const canEncrypt = this.deps.isEncryptionAvailable();
    const encryptedBuffer = canEncrypt ? this.deps.encrypt(plain) : null;

    const payload: StoredPayload = encryptedBuffer
      ? { version: 1, encrypted: true, payload: encryptedBuffer.toString("base64") }
      : { version: 1, encrypted: false, payload: plain };

    if (!canEncrypt) {
      console.warn(
        "[secure-storage] OS keychain encryption is unavailable; writing plaintext. " +
          "On Linux, install a Secret Service implementation (e.g. gnome-keyring) to enable encryption."
      );
    }

    const dir = dirname(this.deps.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.deps.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  setKey(key: string, value: string): void {
    const current = this.readAll();
    current[key] = value;
    this.writeAll(current);
  }

  setKeys(patch: SecretMap): void {
    const current = this.readAll();
    this.writeAll({ ...current, ...patch });
  }

  removeKey(key: string): void {
    const current = this.readAll();
    if (!(key in current)) return;
    delete current[key];
    this.writeAll(current);
  }

  removeKeys(keys: readonly string[]): void {
    const current = this.readAll();
    let changed = false;
    for (const key of keys) {
      if (key in current) {
        delete current[key];
        changed = true;
      }
    }
    if (changed) this.writeAll(current);
  }
}

export function resolveSecretStorePath(userDataPath: string): string {
  return resolve(userDataPath, "buildbotprime-secrets.json");
}

export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 6) return "*".repeat(value.length);
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
