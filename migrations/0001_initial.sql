CREATE TABLE IF NOT EXISTS scripts (
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
);

CREATE INDEX IF NOT EXISTS idx_scripts_updated_at
ON scripts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_scripts_os_runtime
ON scripts (os, runtime);

PRAGMA optimize;
