import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  OPERATING_SYSTEMS,
  RUNTIMES,
  SOURCE_TYPES,
  type OperatingSystem,
  type ScriptInput,
  type ScriptRuntime,
} from "../src/types";
import type { ScriptStore } from "./store";

export interface RuntimeConfig {
  adminToken?: string;
  importHosts?: string;
  maxScriptBytes?: string | number;
}

interface CreateApiOptions {
  getStore: (context: Context) => ScriptStore | Promise<ScriptStore>;
  getConfig: (context: Context) => RuntimeConfig;
}

const DEFAULT_MAX_SCRIPT_BYTES = 256 * 1024;
const DEFAULT_IMPORT_HOSTS = [
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
];

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 413 | 415 | 422 | 502,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(options: CreateApiOptions) {
  const app = new Hono();

  app.use("*", secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }));
  app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));

  app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

  app.get("/api/meta", (c) => {
    const config = options.getConfig(c);
    return c.json({
      writeProtected: Boolean(config.adminToken?.trim()),
      maxScriptBytes: getMaxBytes(config),
    });
  });

  app.get("/api/scripts", async (c) => {
    c.header("Cache-Control", "no-store");
    const store = await options.getStore(c);
    return c.json({ scripts: await store.list() });
  });

  app.get("/api/scripts/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    const store = await options.getStore(c);
    const script = await store.get(c.req.param("id"));
    if (!script) throw new ApiError(404, "脚本不存在");
    return c.json({ script });
  });

  app.get("/api/scripts/:id/raw", async (c) => {
    const store = await options.getStore(c);
    const script = await store.get(c.req.param("id"));
    if (!script) throw new ApiError(404, "脚本不存在");
    const filename = safeFilename(script.title, runtimeExtension(script.runtime));
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, max-age=60");
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.query("download") === "1") {
      c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }
    return c.body(script.content);
  });

  app.post("/api/scripts", async (c) => {
    authorize(c, options.getConfig(c));
    const body = await readJson(c);
    const input = validateScriptInput(body, getMaxBytes(options.getConfig(c)));
    const store = await options.getStore(c);
    return c.json({ script: await store.create(input) }, 201);
  });

  app.put("/api/scripts/:id", async (c) => {
    authorize(c, options.getConfig(c));
    const body = await readJson(c);
    const input = validateScriptInput(body, getMaxBytes(options.getConfig(c)));
    const store = await options.getStore(c);
    const script = await store.update(c.req.param("id"), input);
    if (!script) throw new ApiError(404, "脚本不存在");
    return c.json({ script });
  });

  app.delete("/api/scripts/:id", async (c) => {
    authorize(c, options.getConfig(c));
    const store = await options.getStore(c);
    if (!(await store.delete(c.req.param("id")))) throw new ApiError(404, "脚本不存在");
    return c.body(null, 204);
  });

  app.post("/api/import", async (c) => {
    const config = options.getConfig(c);
    authorize(c, config);
    const body = await readJson(c);
    const requestedUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!requestedUrl) throw new ApiError(422, "请输入脚本地址");
    const normalizedUrl = normalizeSourceUrl(requestedUrl);
    const maxBytes = getMaxBytes(config);
    const content = await fetchExternalScript(normalizedUrl, allowedImportHosts(config), maxBytes);
    const detected = detectScript(normalizedUrl.pathname);
    const title = decodeURIComponent(normalizedUrl.pathname.split("/").filter(Boolean).at(-1) || "外部脚本");
    const input = validateScriptInput(
      {
        title,
        description: `收藏自 ${new URL(requestedUrl).hostname} 的脚本快照。`,
        os: detected.os,
        runtime: detected.runtime,
        sourceType: "external",
        sourceUrl: requestedUrl,
        tags: ["外部收藏"],
        content,
      },
      maxBytes,
    );
    const store = await options.getStore(c);
    return c.json({ script: await store.create(input) }, 201);
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: error.message }, error.status);
    if (error.name === "BodyLimitError") return c.json({ error: "请求内容过大" }, 413);
    console.error(error);
    return c.json({ error: "服务器处理请求时发生错误" }, 500);
  });

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? c.json({ error: "接口不存在" }, 404)
      : c.text("Not found", 404),
  );

  return app;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "仅支持 application/json 请求");
  }
  try {
    const value: unknown = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "JSON 格式无效");
  }
}

function validateScriptInput(body: Record<string, unknown>, maxBytes: number): ScriptInput {
  const title = cleanText(body.title, 80, "标题");
  const description = cleanOptionalText(body.description, 240, "简介");
  const content = typeof body.content === "string" ? body.content.replace(/\r\n/g, "\n") : "";
  if (!content.trim()) throw new ApiError(422, "脚本内容不能为空");
  if (new TextEncoder().encode(content).byteLength > maxBytes) {
    throw new ApiError(413, `脚本不能超过 ${Math.floor(maxBytes / 1024)} KiB`);
  }
  if (!OPERATING_SYSTEMS.includes(body.os as OperatingSystem)) throw new ApiError(422, "操作系统无效");
  if (!RUNTIMES.includes(body.runtime as ScriptRuntime)) throw new ApiError(422, "运行环境无效");
  const sourceType = SOURCE_TYPES.includes(body.sourceType as ScriptInput["sourceType"])
    ? (body.sourceType as ScriptInput["sourceType"])
    : "editor";
  let sourceUrl: string | null = null;
  if (body.sourceUrl) {
    try {
      const parsed = new URL(String(body.sourceUrl));
      if (parsed.protocol !== "https:") throw new Error("not https");
      sourceUrl = parsed.toString().slice(0, 2048);
    } catch {
      throw new ApiError(422, "来源地址必须是有效的 HTTPS URL");
    }
  }
  const rawTags = Array.isArray(body.tags) ? body.tags : [];
  const tags = [...new Set(rawTags.map((tag) => String(tag).trim()).filter(Boolean))];
  if (tags.length > 8 || tags.some((tag) => tag.length > 20)) {
    throw new ApiError(422, "最多可添加 8 个标签，每个标签不超过 20 个字符");
  }
  return {
    title,
    description,
    os: body.os as OperatingSystem,
    runtime: body.runtime as ScriptRuntime,
    sourceType,
    sourceUrl,
    content,
    tags,
  };
}

function cleanText(value: unknown, maxLength: number, label: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new ApiError(422, `${label}不能为空`);
  if (result.length > maxLength) throw new ApiError(422, `${label}不能超过 ${maxLength} 个字符`);
  return result;
}

function cleanOptionalText(value: unknown, maxLength: number, label: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > maxLength) throw new ApiError(422, `${label}不能超过 ${maxLength} 个字符`);
  return result;
}

function authorize(c: Context, config: RuntimeConfig): void {
  const expected = config.adminToken?.trim();
  if (!expected) return;
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const supplied = bearer || c.req.header("x-admin-token") || "";
  if (!constantTimeEqual(supplied, expected)) throw new ApiError(401, "管理员令牌无效或未提供");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function getMaxBytes(config: RuntimeConfig): number {
  const parsed = Number(config.maxScriptBytes ?? DEFAULT_MAX_SCRIPT_BYTES);
  return Number.isFinite(parsed) && parsed >= 1024
    ? Math.min(Math.floor(parsed), 1024 * 1024)
    : DEFAULT_MAX_SCRIPT_BYTES;
}

function allowedImportHosts(config: RuntimeConfig): Set<string> {
  const values = config.importHosts
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values?.length ? values : DEFAULT_IMPORT_HOSTS);
}

function normalizeSourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(422, "脚本地址格式无效");
  }
  if (url.protocol !== "https:") throw new ApiError(422, "仅允许导入 HTTPS 地址");
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      url = new URL(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}`);
    }
  } else if (url.hostname === "gitlab.com") {
    url.pathname = url.pathname.replace("/-/blob/", "/-/raw/");
  }
  return url;
}

async function fetchExternalScript(startUrl: URL, hosts: Set<string>, maxBytes: number): Promise<string> {
  let url = startUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (!hosts.has("*") && !hosts.has(url.hostname.toLowerCase())) {
      throw new ApiError(422, `不允许从 ${url.hostname} 导入；可通过 IMPORT_HOSTS 配置可信域名`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Script-Hub/0.1" },
      });
    } catch {
      throw new ApiError(502, "获取外部脚本失败或超时");
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new ApiError(502, "外部地址重定向次数过多");
      url = new URL(location, url);
      if (url.protocol !== "https:") throw new ApiError(422, "重定向目标必须使用 HTTPS");
      continue;
    }
    if (!response.ok) throw new ApiError(502, `外部脚本返回 HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > maxBytes) throw new ApiError(413, "外部脚本超过大小限制");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new ApiError(413, "外部脚本超过大小限制");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n/g, "\n");
    if (!content.trim()) throw new ApiError(422, "外部脚本内容为空");
    if (content.includes("\0")) throw new ApiError(422, "仅支持 UTF-8 文本脚本");
    return content;
  }
  throw new ApiError(502, "获取外部脚本失败");
}

function detectScript(pathname: string): { os: OperatingSystem; runtime: ScriptRuntime } {
  const extension = pathname.split(".").at(-1)?.toLowerCase();
  if (extension === "ps1") return { os: "windows", runtime: "powershell" };
  if (extension === "bat" || extension === "cmd") return { os: "windows", runtime: "cmd" };
  if (extension === "py") return { os: "cross", runtime: "python" };
  if (extension === "sh" || extension === "bash") return { os: "linux", runtime: "bash" };
  return { os: "cross", runtime: "other" };
}

function runtimeExtension(runtime: ScriptRuntime): string {
  return { bash: "sh", powershell: "ps1", cmd: "cmd", python: "py", other: "txt" }[runtime];
}

function safeFilename(title: string, extension: string): string {
  const stem = title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "script";
  return `${stem}.${extension}`;
}
