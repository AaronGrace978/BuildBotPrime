import type { BuilderEvent, BuilderSession } from "@buildbotprime/core";

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  repo_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  preferred_ide TEXT NOT NULL,
  prompt TEXT NOT NULL,
  behavior_profile_json TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
`;

export interface SessionStore {
  saveSession(session: BuilderSession): Promise<void>;
  listSessions(): Promise<readonly BuilderSession[]>;
  appendEvent(sessionId: string, event: BuilderEvent): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, BuilderSession>();

  async saveSession(session: BuilderSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async listSessions(): Promise<readonly BuilderSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async appendEvent(sessionId: string, event: BuilderEvent): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.sessions.set(sessionId, {
      ...session,
      events: [...session.events, event]
    });
  }
}
