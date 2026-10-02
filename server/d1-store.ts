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

export class D1ScriptStore implements ScriptStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: D1Database) {}

  async list(): Promise<ScriptRecord[]> {
    await this.ensureReady();
    const result = await this.db.prepare(`${SCRIPT_SELECT} ORDER BY scripts.updated_at DESC`).all();
    return result.results.map((row) => mapRow(row as Record<string, unknown>));
  }

  async get(id: string): Promise<ScriptRecord | null> {
    await this.ensureReady();
    const row = await this.db.prepare(`${SCRIPT_SELECT} WHERE scripts.id = ?`).bind(id).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async create(input: ScriptInput, ownerId: string): Promise<ScriptRecord> {
    await this.ensureReady();
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
    await this.insert(record, ownerId);
    return (await this.get(record.id))!;
  }

  async update(id: string, input: ScriptInput): Promise<ScriptRecord | null> {
    await this.ensureReady();
    const current = await this.get(id);
    if (!current) return null;
    const updatedAt = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE scripts SET
          title = ?, description = ?, category = ?, os = ?, runtime = ?, source_type = ?,
          source_url = ?, content = ?, tags = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
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
      )
      .run();
    return { ...current, ...input, sourceUrl: input.sourceUrl ?? null, updatedAt };
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.db.prepare("DELETE FROM scripts WHERE id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async setHidden(id: string, hidden: boolean): Promise<ScriptRecord | null> {
    await this.ensureReady();
    const result = await this.db.prepare("UPDATE scripts SET hidden = ?, updated_at = ? WHERE id = ?")
      .bind(hidden ? 1 : 0, new Date().toISOString(), id).run();
    return (result.meta.changes ?? 0) > 0 ? this.get(id) : null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
    return row ? mapUserRow(row as Record<string, unknown>) : null;
  }

  async createUser(username: string, passwordHash: string): Promise<UserRecord> {
    await this.ensureReady();
    const user: UserRecord = {
      id: crypto.randomUUID(), username, passwordHash, role: "user", createdAt: new Date().toISOString(),
    };
    await this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(user.id, user.username, user.passwordHash, user.role, user.createdAt).run();
    return user;
  }

  async upsertAdmin(username: string, passwordHash: string): Promise<UserRecord> {
    await this.ensureReady();
    const current = await this.getUserByUsername(username);
    if (current) {
      await this.db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?")
        .bind(passwordHash, current.id).run();
      return { ...current, role: "admin", passwordHash };
    }
    const user: UserRecord = {
      id: crypto.randomUUID(), username, passwordHash, role: "admin", createdAt: new Date().toISOString(),
    };
    await this.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(user.id, user.username, user.passwordHash, user.role, user.createdAt).run();
    return user;
  }

  async getUserBySession(tokenHash: string, now: string): Promise<UserRecord | null> {
    await this.ensureReady();
    const row = await this.db.prepare(`SELECT users.* FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).bind(tokenHash, now).first();
    return row ? mapUserRow(row as Record<string, unknown>) : null;
  }

  async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
    await this.ensureReady();
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(tokenHash, userId, expiresAt, now),
    ]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.ensureReady();
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  private async insert(record: ScriptRecord, ownerId: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO scripts
          (id, title, description, category, os, runtime, source_type, source_url, content, tags, owner_id, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
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
      )
      .run();
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.db.batch(SCHEMA_STATEMENTS.map((sql) => this.db.prepare(sql)));
        const columns = await this.db.prepare("PRAGMA table_info(scripts)").all<{ name: string }>();
        if (!columns.results.some((column) => column.name === "category")) {
          await this.db.prepare("ALTER TABLE scripts ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'").run();
        }
        if (!columns.results.some((column) => column.name === "owner_id")) {
          await this.db.prepare("ALTER TABLE scripts ADD COLUMN owner_id TEXT").run();
        }
        if (!columns.results.some((column) => column.name === "hidden")) {
          await this.db.prepare("ALTER TABLE scripts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0").run();
        }
        await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts (category)").run();
        await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_scripts_owner_id ON scripts (owner_id)").run();
        await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_scripts_hidden ON scripts (hidden)").run();
        const count = await this.db.prepare("SELECT COUNT(*) AS count FROM scripts").first<{ count: number }>();
        if (Number(count?.count ?? 0) === 0) {
          const now = new Date().toISOString();
          await this.db.batch(
            STARTER_SCRIPTS.map((script, index) => {
              const record: ScriptRecord = {
                ...script,
                sourceUrl: script.sourceUrl ?? null,
                id: `starter-${index + 1}`,
                owner: null,
                hidden: false,
                createdAt: now,
                updatedAt: now,
              };
              return this.db
                .prepare(
                  `INSERT OR IGNORE INTO scripts
                    (id, title, description, category, os, runtime, source_type, source_url, content, tags, owner_id, hidden, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
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
                  null,
                  0,
                  record.createdAt,
                  record.updatedAt,
                );
            }),
          );
        }
      })();
    }
    return this.ready;
  }
}
