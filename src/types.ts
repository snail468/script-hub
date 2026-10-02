export const OPERATING_SYSTEMS = ["linux", "windows", "cross"] as const;
export const RUNTIMES = ["bash", "powershell", "cmd", "python", "other"] as const;
export const SOURCE_TYPES = ["editor", "upload", "external"] as const;
export const USER_ROLES = ["user", "admin"] as const;

export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];
export type ScriptRuntime = (typeof RUNTIMES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type UserRole = (typeof USER_ROLES)[number];

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface ScriptRecord {
  id: string;
  title: string;
  description: string;
  category: string;
  os: OperatingSystem;
  runtime: ScriptRuntime;
  sourceType: SourceType;
  sourceUrl: string | null;
  content: string;
  tags: string[];
  owner: Pick<SessionUser, "id" | "username"> | null;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptInput {
  title: string;
  description: string;
  category: string;
  os: OperatingSystem;
  runtime: ScriptRuntime;
  sourceType: SourceType;
  sourceUrl?: string | null;
  content: string;
  tags: string[];
}

export interface ApiMeta {
  maxScriptBytes: number;
  registrationEnabled: boolean;
  currentUser: SessionUser | null;
}
