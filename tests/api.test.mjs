import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApi } from "../.test-dist/api.js";

class MemoryStore {
  records = [];
  async list() { return this.records; }
  async get(id) { return this.records.find((item) => item.id === id) ?? null; }
  async create(input) {
    const now = new Date().toISOString();
    const record = { ...input, sourceUrl: input.sourceUrl ?? null, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.records.push(record);
    return record;
  }
  async update(id, input) {
    const index = this.records.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.records[index] = { ...this.records[index], ...input, sourceUrl: input.sourceUrl ?? null, updatedAt: new Date().toISOString() };
    return this.records[index];
  }
  async delete(id) {
    const before = this.records.length;
    this.records = this.records.filter((item) => item.id !== id);
    return this.records.length !== before;
  }
}

const validScript = {
  title: "Hello",
  description: "Test script",
  os: "linux",
  runtime: "bash",
  sourceType: "editor",
  sourceUrl: null,
  content: "#!/bin/sh\necho hello\n",
  tags: ["test"],
};

describe("Script Hub API", () => {
  it("requires the configured token for writes", async () => {
    const store = new MemoryStore();
    const app = createApi({ getStore: () => store, getConfig: () => ({ adminToken: "secret" }) });
    const denied = await app.request("/api/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validScript) });
    assert.equal(denied.status, 401);
    const accepted = await app.request("/api/scripts", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: JSON.stringify(validScript) });
    assert.equal(accepted.status, 201);
    assert.equal(store.records.length, 1);
  });

  it("rejects empty and oversized scripts", async () => {
    const store = new MemoryStore();
    const app = createApi({ getStore: () => store, getConfig: () => ({ maxScriptBytes: 1024 }) });
    const empty = await app.request("/api/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...validScript, content: "" }) });
    assert.equal(empty.status, 422);
    const oversized = await app.request("/api/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...validScript, content: "x".repeat(1025) }) });
    assert.equal(oversized.status, 413);
  });
});
