import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApi } from "../.test-dist/api.js";

class MemoryStore {
  records = [];
  users = [];
  sessions = new Map();
  async list() { return this.records; }
  async get(id) { return this.records.find((item) => item.id === id) ?? null; }
  async create(input, ownerId) {
    const now = new Date().toISOString();
    const owner = this.users.find((user) => user.id === ownerId);
    const record = { ...input, sourceUrl: input.sourceUrl ?? null, id: crypto.randomUUID(), owner: { id: owner.id, username: owner.username }, hidden: false, createdAt: now, updatedAt: now };
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
  async setHidden(id, hidden) {
    const item = await this.get(id);
    if (!item) return null;
    item.hidden = hidden;
    return item;
  }
  async getUserByUsername(username) { return this.users.find((user) => user.username.toLowerCase() === username.toLowerCase()) ?? null; }
  async createUser(username, passwordHash) {
    const user = { id: crypto.randomUUID(), username, passwordHash, role: "user", createdAt: new Date().toISOString() };
    this.users.push(user);
    return user;
  }
  async upsertAdmin(username, passwordHash) {
    const current = await this.getUserByUsername(username);
    if (current) { current.role = "admin"; return current; }
    const user = { id: crypto.randomUUID(), username, passwordHash, role: "admin", createdAt: new Date().toISOString() };
    this.users.push(user);
    return user;
  }
  async getUserBySession(tokenHash, now) {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? this.users.find((user) => user.id === session.userId) ?? null : null;
  }
  async createSession(tokenHash, userId, expiresAt) { this.sessions.set(tokenHash, { userId, expiresAt }); }
  async deleteSession(tokenHash) { this.sessions.delete(tokenHash); }
}

const validScript = {
  title: "Hello",
  description: "Test script",
  category: "测试工具",
  os: "linux",
  runtime: "bash",
  sourceType: "editor",
  sourceUrl: null,
  content: "#!/bin/sh\necho hello\n",
  tags: ["test"],
};

function jsonRequest(path, body, cookie, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie").split(";", 1)[0];
}

describe("Script Hub API accounts and permissions", () => {
  it("supports registration, isolated user spaces, admin visibility, and public reads", async () => {
    const store = new MemoryStore();
    const app = createApi({
      getStore: () => store,
      getConfig: () => ({ adminUsername: "root", adminPassword: "administrator-secret" }),
    });

    const guestWrite = await app.fetch(jsonRequest("/api/scripts", validScript));
    assert.equal(guestWrite.status, 401);

    const aliceRegistration = await app.fetch(jsonRequest("/api/auth/register", { username: "Alice", password: "alice-password-123" }));
    assert.equal(aliceRegistration.status, 201);
    const aliceCookie = sessionCookie(aliceRegistration);
    const createdResponse = await app.fetch(jsonRequest("/api/scripts", validScript, aliceCookie));
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).script;
    assert.equal(created.owner.username, "alice");

    const bobRegistration = await app.fetch(jsonRequest("/api/auth/register", { username: "bob", password: "bob-password-12345" }));
    const bobCookie = sessionCookie(bobRegistration);
    const forbidden = await app.fetch(jsonRequest(`/api/scripts/${created.id}`, { ...validScript, title: "stolen" }, bobCookie, "PUT"));
    assert.equal(forbidden.status, 403);

    const adminLogin = await app.fetch(jsonRequest("/api/auth/login", { username: "root", password: "administrator-secret" }));
    assert.equal(adminLogin.status, 200);
    const adminCookie = sessionCookie(adminLogin);
    const hidden = await app.fetch(jsonRequest(`/api/scripts/${created.id}/visibility`, { hidden: true }, adminCookie, "PATCH"));
    assert.equal(hidden.status, 200);

    const guestList = await app.request("/api/scripts");
    assert.equal((await guestList.json()).scripts.length, 0);
    const userList = await app.request("/api/scripts", { headers: { cookie: aliceCookie } });
    assert.equal((await userList.json()).scripts.length, 0);
    const adminList = await app.request("/api/scripts", { headers: { cookie: adminCookie } });
    assert.equal((await adminList.json()).scripts[0].hidden, true);
    const hiddenRaw = await app.request(`/api/scripts/${created.id}/raw`);
    assert.equal(hiddenRaw.status, 404);
  });

  it("validates categories and script size after authentication", async () => {
    const store = new MemoryStore();
    const app = createApi({ getStore: () => store, getConfig: () => ({ maxScriptBytes: 1024 }) });
    const registration = await app.fetch(jsonRequest("/api/auth/register", { username: "tester", password: "testing-password" }));
    const cookie = sessionCookie(registration);
    const legacy = await app.fetch(jsonRequest("/api/scripts", { ...validScript, category: undefined }, cookie));
    assert.equal(legacy.status, 201);
    assert.equal(store.records[0].category, "未分类");
    const invalid = await app.fetch(jsonRequest("/api/scripts", { ...validScript, category: "x".repeat(31) }, cookie));
    assert.equal(invalid.status, 422);
    const oversized = await app.fetch(jsonRequest("/api/scripts", { ...validScript, content: "x".repeat(1025) }, cookie));
    assert.equal(oversized.status, 413);
  });

  it("uses the runtime-specific PBKDF2 iteration count", async () => {
    const store = new MemoryStore();
    const app = createApi({
      getStore: () => store,
      getConfig: () => ({ passwordIterations: 100_000 }),
    });
    const response = await app.fetch(jsonRequest("/api/auth/register", {
      username: "worker-user",
      password: "worker-password-123",
    }));
    assert.equal(response.status, 201);
    assert.match(store.users[0].passwordHash, /^pbkdf2_sha256\$100000\$/);
  });
});
