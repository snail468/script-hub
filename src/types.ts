export const OPERATING_SYSTEMS = ["linux", "windows", "cross"] as const;
export const RUNTIMES = ["bash", "powershell", "cmd", "python", "other"] as const;
export const SOURCE_TYPES = ["editor", "upload", "external"] as const;

export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];
export type ScriptRuntime = (typeof RUNTIMES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  os: OperatingSystem;
  runtime: ScriptRuntime;
  sourceType: SourceType;
  sourceUrl: string | null;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScriptInput {
  title: string;
  description: string;
  os: OperatingSystem;
  runtime: ScriptRuntime;
  sourceType: SourceType;
  sourceUrl?: string | null;
  content: string;
  tags: string[];
}

export interface ApiMeta {
  writeProtected: boolean;
  maxScriptBytes: number;
}
