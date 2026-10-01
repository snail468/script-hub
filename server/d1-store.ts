import type { ScriptInput, ScriptRecord } from "../src/types";
import { mapRow, SCHEMA_STATEMENTS, STARTER_SCRIPTS, type ScriptStore } from "./store";

export class D1ScriptStore implements ScriptStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: D1Database) {}

  async list(): Promise<ScriptRecord[]> {
    await this.ensureReady();
    const result = await this.db.prepare("SELECT * FROM scripts ORDER BY updated_at DESC").all();
    return result.results.map((row) => mapRow(row as Record<string, unknown>));
  }

  async get(id: string): Promise<ScriptRecord | null> {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT * FROM scripts WHERE id = ?").bind(id).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  async create(input: ScriptInput): Promise<ScriptRecord> {
    await this.ensureReady();
    const now = new Date().toISOString();
    const record: ScriptRecord = {
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.insert(record);
    return record;
  }

  async update(id: string, input: ScriptInput): Promise<ScriptRecord | null> {
    await this.ensureReady();
    const current = await this.get(id);
    if (!current) return null;
    const updatedAt = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE scripts SET
          title = ?, description = ?, os = ?, runtime = ?, source_type = ?,
          source_url = ?, content = ?, tags = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
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
      )
      .run();
    return { ...current, ...input, sourceUrl: input.sourceUrl ?? null, updatedAt };
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.db.prepare("DELETE FROM scripts WHERE id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  private async insert(record: ScriptRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO scripts
          (id, title, description, os, runtime, source_type, source_url, content, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
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
      )
      .run();
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.db.batch(SCHEMA_STATEMENTS.map((sql) => this.db.prepare(sql)));
        const count = await this.db.prepare("SELECT COUNT(*) AS count FROM scripts").first<{ count: number }>();
        if (Number(count?.count ?? 0) === 0) {
          const now = new Date().toISOString();
          await this.db.batch(
            STARTER_SCRIPTS.map((script, index) => {
              const record: ScriptRecord = {
                ...script,
                sourceUrl: script.sourceUrl ?? null,
                id: `starter-${index + 1}`,
                createdAt: now,
                updatedAt: now,
              };
              return this.db
                .prepare(
                  `INSERT OR IGNORE INTO scripts
                    (id, title, description, os, runtime, source_type, source_url, content, tags, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
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
            }),
          );
        }
      })();
    }
    return this.ready;
  }
}
