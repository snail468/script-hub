import type { ScriptInput, ScriptRecord, SessionUser } from "../src/types";

export interface UserRecord extends SessionUser {
  passwordHash: string;
  createdAt: string;
}

export interface ScriptStore {
  list(): Promise<ScriptRecord[]>;
  get(id: string): Promise<ScriptRecord | null>;
  create(input: ScriptInput, ownerId: string): Promise<ScriptRecord>;
  update(id: string, input: ScriptInput): Promise<ScriptRecord | null>;
  delete(id: string): Promise<boolean>;
  setHidden(id: string, hidden: boolean): Promise<ScriptRecord | null>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  createUser(username: string, passwordHash: string): Promise<UserRecord>;
  upsertAdmin(username: string, passwordHash: string): Promise<UserRecord>;
  getUserBySession(tokenHash: string, now: string): Promise<UserRecord | null>;
  createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

export const STARTER_SCRIPTS: ScriptInput[] = [
  {
    title: "系统概览",
    description: "快速查看 Linux 主机的内核、磁盘、内存与运行时长。",
    category: "系统运维",
    os: "linux",
    runtime: "bash",
    sourceType: "editor",
    sourceUrl: null,
    tags: ["运维", "诊断"],
    content: `#!/usr/bin/env bash
set -euo pipefail

echo "== Host =="
hostnamectl 2>/dev/null || uname -a
echo
echo "== Uptime =="
uptime
echo
echo "== Memory =="
free -h
echo
echo "== Disk =="
df -hT -x tmpfs -x devtmpfs
`,
  },
  {
    title: "网络诊断报告",
    description: "收集 Windows IP、DNS 和默认路由信息，便于远程排查。",
    category: "网络工具",
    os: "windows",
    runtime: "powershell",
    sourceType: "editor",
    sourceUrl: null,
    tags: ["Windows", "网络"],
    content: `$ErrorActionPreference = "Stop"

Write-Host "== IP Configuration ==" -ForegroundColor Cyan
Get-NetIPConfiguration | Format-List

Write-Host "== DNS Servers ==" -ForegroundColor Cyan
Get-DnsClientServerAddress -AddressFamily IPv4 |
  Where-Object { $_.ServerAddresses } |
  Format-Table InterfaceAlias, ServerAddresses -AutoSize

Write-Host "== Default Route ==" -ForegroundColor Cyan
Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
  Sort-Object RouteMetric |
  Format-Table InterfaceAlias, NextHop, RouteMetric -AutoSize
`,
  },
  {
    title: "目录校验清单",
    description: "跨平台生成文件 SHA-256 清单，适合迁移前后核验。",
    category: "文件管理",
    os: "cross",
    runtime: "python",
    sourceType: "editor",
    sourceUrl: null,
    tags: ["文件", "校验"],
    content: `#!/usr/bin/env python3
from hashlib import sha256
from pathlib import Path

root = Path.cwd()
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    digest = sha256(path.read_bytes()).hexdigest()
    print(f"{digest}  {path.relative_to(root)}")
`,
  },
];

export function mapRow(row: Record<string, unknown>): ScriptRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category: String(row.category ?? "未分类"),
    os: row.os as ScriptRecord["os"],
    runtime: row.runtime as ScriptRecord["runtime"],
    sourceType: row.source_type as ScriptRecord["sourceType"],
    sourceUrl: row.source_url ? String(row.source_url) : null,
    content: String(row.content),
    tags: parseTags(row.tags),
    owner: row.owner_id
      ? { id: String(row.owner_id), username: String(row.owner_username ?? "未知用户") }
      : null,
    hidden: Boolean(row.hidden),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseTags(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '未分类',
    os TEXT NOT NULL CHECK (os IN ('linux', 'windows', 'cross')),
    runtime TEXT NOT NULL CHECK (runtime IN ('bash', 'powershell', 'cmd', 'python', 'other')),
    source_type TEXT NOT NULL CHECK (source_type IN ('editor', 'upload', 'external')),
    source_url TEXT,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    owner_id TEXT,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_scripts_updated_at ON scripts (updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_scripts_os_runtime ON scripts (os, runtime)",
] as const;

export const SCRIPT_SELECT = `SELECT scripts.*, users.username AS owner_username
  FROM scripts LEFT JOIN users ON users.id = scripts.owner_id`;

export function mapUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    role: row.role as UserRecord["role"],
    createdAt: String(row.created_at),
  };
}
