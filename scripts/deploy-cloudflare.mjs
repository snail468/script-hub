import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const databaseName = process.env.CLOUDFLARE_D1_NAME || "script-hub";
const workerName = process.env.CLOUDFLARE_WORKER_NAME || "script-hub";
const adminSecret = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
const adminUsername = process.env.ADMIN_USERNAME || "admin";

if (!adminSecret) {
  throw new Error("部署前必须设置 ADMIN_PASSWORD（ADMIN_TOKEN 仅作为旧配置兼容）");
}
if (adminSecret.length < 12 || adminSecret.length > 128) {
  throw new Error("ADMIN_PASSWORD 长度须为 12–128 个字符");
}
if (adminSecret !== adminSecret.trim()) {
  throw new Error("ADMIN_PASSWORD 不能包含首尾空格或换行");
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.log("未检测到 CLOUDFLARE_API_TOKEN，将使用 `wrangler login` 的本地登录状态。");
}

const databases = parseJson(runWrangler(["d1", "list", "--json"], true));
let database = databases.find((item) => item.name === databaseName);

if (!database) {
  console.log(`正在创建 D1 数据库：${databaseName}`);
  const output = runWrangler(["d1", "create", databaseName], true);
  const id = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!id) {
    console.error(output);
    throw new Error("已执行 D1 创建命令，但无法识别数据库 ID");
  }
  database = { name: databaseName, uuid: id };
}

const databaseId = database.uuid || database.id;
if (!databaseId) throw new Error("D1 数据库记录中缺少 UUID");

const generatedConfig = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: workerName,
  main: "./server/worker.ts",
  compatibility_date: "2026-10-01",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    directory: "./dist",
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: ["/api/*"],
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "migrations",
    },
  ],
  vars: {
    ADMIN_USERNAME: adminUsername,
    ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION || "true",
    IMPORT_HOSTS: process.env.IMPORT_HOSTS || "raw.githubusercontent.com,gist.githubusercontent.com,gitlab.com,bitbucket.org",
    MAX_SCRIPT_BYTES: process.env.MAX_SCRIPT_BYTES || "262144",
  },
  observability: { enabled: true },
  secrets: { required: ["ADMIN_PASSWORD"] },
};

const configPath = ".wrangler.generated.json";
const secretsPath = ".wrangler.secrets.json";
writeFileSync(configPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, { mode: 0o600 });
writeFileSync(secretsPath, `${JSON.stringify({ ADMIN_PASSWORD: adminSecret })}\n`, { mode: 0o600 });

try {
  runPnpm(["run", "build:web"]);
  runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath]);
  const deployOutput = runWrangler([
    "deploy",
    "--config",
    configPath,
    "--secrets-file",
    secretsPath,
  ], true);
  process.stdout.write(deployOutput);

  const workerUrl = process.env.CLOUDFLARE_WORKER_URL
    || deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (!workerUrl) {
    throw new Error("无法识别 Worker 地址；请设置 CLOUDFLARE_WORKER_URL 后重试");
  }

  await verifyAdminLogin(workerUrl, adminUsername, adminSecret);
  console.log(`部署及管理员登录自检完成。Worker：${workerName}，D1：${databaseName}`);
} finally {
  rmSync(configPath, { force: true });
  rmSync(secretsPath, { force: true });
}

async function verifyAdminLogin(workerUrl, username, password) {
  const loginUrl = new URL("/api/auth/login", workerUrl);
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      lastStatus = response.status;
      if (response.ok) {
        const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
        if (cookie) {
          await fetch(new URL("/api/auth/logout", workerUrl), {
            method: "POST",
            headers: { cookie },
          }).catch(() => undefined);
        }
        console.log("管理员登录自检通过。");
        return;
      }
    } catch {
      lastStatus = 0;
    }
    if (attempt < 8) await delay(1_500);
  }
  throw new Error(`管理员登录自检失败（HTTP ${lastStatus || "network"}）；请检查 ADMIN_USERNAME 与 ADMIN_PASSWORD`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runWrangler(args, capture = false, input) {
  return runPnpm(["exec", "wrangler", ...args], capture, input);
}

function runPnpm(args, capture = false, input) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
      WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS || "false",
    },
    input,
    stdio: capture ? ["inherit", "pipe", "pipe"] : input ? ["pipe", "inherit", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || "命令执行失败\n");
    throw new Error(`命令执行失败（退出码 ${result.status || 1}）`);
  }
  return capture ? `${result.stdout || ""}${result.stderr || ""}` : "";
}

function parseJson(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Wrangler 未返回可识别的 JSON");
  return JSON.parse(output.slice(start, end + 1));
}
