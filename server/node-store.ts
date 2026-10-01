import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ScriptInput, ScriptRecord } from "../src/types";
import { mapRow, SCHEMA_STATEMENTS, STARTER_SCRIPTS, type ScriptStore } from "./store";

export class NodeScriptStore implements ScriptStore {
  private readonly db: DatabaseSync;

  constructor(databasePath = process.env.DB_PATH || "./data/script-hub.db") {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    for (const statement of SCHEMA_STATEMENTS) this.db.exec(statement);
    this.seedIfEmpty();
  }

  async list(): Promise<ScriptRecord[]> {
    const rows = this.db.prepare("SELECT * FROM scripts ORDER BY updated_at DESC").all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async get(id: string): Promise<ScriptRecord | null> {
    const row = this.db.prepare("SELECT * FROM scripts WHERE id = ?").get(id);
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async create(input: ScriptInput): Promise<ScriptRecord> {
    const now = new Date().toISOString();
    const record: ScriptRecord = {
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.insert(record);
    return record;
  }

  async update(id: string, input: ScriptInput): Promise<ScriptRecord | null> {
    const current = await this.get(id);
    if (!current) return null;
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE scripts SET
          title = ?, description = ?, os = ?, runtime = ?, source_type = ?,
          source_url = ?, content = ?, tags = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        input.title,
        input.description,
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

  private insert(record: ScriptRecord): void {
    this.db
      .prepare(
        `INSERT INTO scripts
          (id, title, description, os, runtime, source_type, source_url, content, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.title,
        record.description,
        record.os,
        record.runtime,
        record.sourceType,
        record.sourceUrl,
        record.content,
        JSON.stringify(record.tags),
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
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
}
