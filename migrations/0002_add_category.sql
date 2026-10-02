ALTER TABLE scripts
ADD COLUMN category TEXT NOT NULL DEFAULT '未分类';

CREATE INDEX IF NOT EXISTS idx_scripts_category
ON scripts (category);
