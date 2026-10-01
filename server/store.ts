import type { ScriptInput, ScriptRecord } from "../src/types";

export interface ScriptStore {
  list(): Promise<ScriptRecord[]>;
  get(id: string): Promise<ScriptRecord | null>;
  create(input: ScriptInput): Promise<ScriptRecord>;
  update(id: string, input: ScriptInput): Promise<ScriptRecord | null>;
  delete(id: string): Promise<boolean>;
}

export const STARTER_SCRIPTS: ScriptInput[] = [
  {
    title: "系统概览",
    description: "快速查看 Linux 主机的内核、磁盘、内存与运行时长。",
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
    os: row.os as ScriptRecord["os"],
    runtime: row.runtime as ScriptRecord["runtime"],
    sourceType: row.source_type as ScriptRecord["sourceType"],
    sourceUrl: row.source_url ? String(row.source_url) : null,
    content: String(row.content),
    tags: parseTags(row.tags),
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
  `CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL CHECK (os IN ('linux', 'windows', 'cross')),
    runtime TEXT NOT NULL CHECK (runtime IN ('bash', 'powershell', 'cmd', 'python', 'other')),
    source_type TEXT NOT NULL CHECK (source_type IN ('editor', 'upload', 'external')),
    source_url TEXT,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_scripts_updated_at ON scripts (updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_scripts_os_runtime ON scripts (os, runtime)",
] as const;
