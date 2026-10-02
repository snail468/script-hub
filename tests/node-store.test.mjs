import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { NodeScriptStore } from "../.test-dist/node-store.js";

describe("NodeScriptStore migrations", () => {
  it("adds category, ownership, visibility and account tables to an existing SQLite database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "script-hub-test-"));
    const databasePath = join(directory, "legacy.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE scripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        os TEXT NOT NULL,
        runtime TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO scripts VALUES (
        'legacy-1', 'Legacy', '', 'linux', 'bash', 'editor', NULL,
        'echo legacy', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const store = new NodeScriptStore(databasePath);
    try {
      const records = await store.list();
      assert.equal(records[0].category, "未分类");
      assert.equal(records[0].owner, null);
      assert.equal(records[0].hidden, false);
      const user = await store.createUser("tester", "password-hash");
      const created = await store.create({
        title: "Categorized",
        description: "",
        category: "系统运维",
        os: "linux",
        runtime: "bash",
        sourceType: "editor",
        sourceUrl: null,
        content: "echo categorized",
        tags: [],
      }, user.id);
      assert.equal(created.category, "系统运维");
      assert.equal(created.owner.username, "tester");
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
