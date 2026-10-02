import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ScriptInput, ScriptRecord } from "../src/types";
import {
  mapRow,
  mapUserRow,
  SCHEMA_STATEMENTS,
  SCRIPT_SELECT,
  STARTER_SCRIPTS,
  type ScriptStore,
  type UserRecord,
} from "./store";

export class NodeScriptStore implements ScriptStore {
  private readonly db: DatabaseSync;

  constructor(databasePath = process.env.DB_PATH || "./data/script-hub.db") {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    for (const statement of SCHEMA_STATEMENTS) this.db.exec(statement);
    const columns = this.db.prepare("PRAGMA table_info(scripts)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "category")) {
      this.db.exec("ALTER TABLE scripts ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'");
    }
    if (!columns.some((column) => column.name === "owner_id")) {
      this.db.exec("ALTER TABLE scripts ADD COLUMN owner_id TEXT");
    }
    if (!columns.some((column) => column.name === "hidden")) {
      this.db.exec("ALTER TABLE scripts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts (category)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_scripts_owner_id ON scripts (owner_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_scripts_hidden ON scripts (hidden)");
    this.seedIfEmpty();
  }

  async list(): Promise<ScriptRecord[]> {
    const rows = this.db.prepare(`${SCRIPT_SELECT} ORDER BY scripts.updated_at DESC`).all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async get(id: string): Promise<ScriptRecord | null> {
    const row = this.db.prepare(`${SCRIPT_SELECT} WHERE scripts.id = ?`).get(id);
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async create(input: ScriptInput, ownerId: string): Promise<ScriptRecord> {
    const now = new Date().toISOString();
    const record: ScriptRecord = {
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      id: crypto.randomUUID(),
      owner: null,
      hidden: false,
      createdAt: now,
      updatedAt: now,
    };
    this.insert(record, ownerId);
    return (await this.get(record.id))!;
  }

  async update(id: string, input: ScriptInput): Promise<ScriptRecord | null> {
    const current = await this.get(id);
    if (!current) return null;
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE scripts SET
          title = ?, description = ?, category = ?, os = ?, runtime = ?, source_type = ?,
          source_url = ?, content = ?, tags = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        input.title,
        input.description,
        input.category,
        input.os,
        input.runtime,
        input.sourceType,
        input.sourceUrl ?? null,
        input.content,
        JSON.stringify(input.tags),
        updatedAt,
        id,
      );
    return { ...current, ...input, sourceUrl: input.sourceUrl ?? null, updatedAt };
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM scripts WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async setHidden(id: string, hidden: boolean): Promise<ScriptRecord | null> {
    const result = this.db.prepare("UPDATE scripts SET hidden = ?, updated_at = ? WHERE id = ?")
      .run(hidden ? 1 : 0, new Date().toISOString(), id);
    return result.changes > 0 ? this.get(id) : null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
    return row ? mapUserRow(row as Record<string, unknown>) : null;
  }

  async createUser(username: string, passwordHash: string): Promise<UserRecord> {
    const user: UserRecord = {
      id: crypto.randomUUID(), username, passwordHash, role: "user", createdAt: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.username, user.passwordHash, user.role, user.createdAt);
    return user;
  }

  async upsertAdmin(username: string, passwordHash: string): Promise<UserRecord> {
    const current = await this.getUserByUsername(username);
    if (current) {
      this.db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?")
        .run(passwordHash, current.id);
      return { ...current, role: "admin", passwordHash };
    }
    const user: UserRecord = {
      id: crypto.randomUUID(), username, passwordHash, role: "admin", createdAt: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.username, user.passwordHash, user.role, user.createdAt);
    return user;
  }

  async getUserBySession(tokenHash: string, now: string): Promise<UserRecord | null> {
    const row = this.db.prepare(`SELECT users.* FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, now);
    return row ? mapUserRow(row as Record<string, unknown>) : null;
  }

  async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, expiresAt, now);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  close(): void {
    this.db.close();
  }

  private insert(record: ScriptRecord, ownerId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO scripts
          (id, title, description, category, os, runtime, source_type, source_url, content, tags, owner_id, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.title,
        record.description,
        record.category,
        record.os,
        record.runtime,
        record.sourceType,
        record.sourceUrl,
        record.content,
        JSON.stringify(record.tags),
        ownerId,
        record.hidden ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );
  }

  private seedIfEmpty(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM scripts").get() as { count: number };
    if (Number(row.count) > 0) return;
    const now = new Date().toISOString();
    STARTER_SCRIPTS.forEach((script, index) =>
      this.insert({
        ...script,
        sourceUrl: script.sourceUrl ?? null,
        id: `starter-${index + 1}`,
        owner: null,
        hidden: false,
        createdAt: now,
        updatedAt: now,
      }, null),
    );
  }
}
