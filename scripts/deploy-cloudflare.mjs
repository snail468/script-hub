import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const databaseName = process.env.CLOUDFLARE_D1_NAME || "script-hub";
const workerName = process.env.CLOUDFLARE_WORKER_NAME || "script-hub";
const adminSecret = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;

if (!adminSecret) {
  throw new Error("部署前必须设置 ADMIN_PASSWORD（ADMIN_TOKEN 仅作为旧配置兼容）");
}
if (adminSecret.length < 12 || adminSecret.length > 128) {
  throw new Error("ADMIN_PASSWORD 长度须为 12–128 个字符");
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
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
    ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION || "true",
    IMPORT_HOSTS: process.env.IMPORT_HOSTS || "raw.githubusercontent.com,gist.githubusercontent.com,gitlab.com,bitbucket.org",
    MAX_SCRIPT_BYTES: process.env.MAX_SCRIPT_BYTES || "262144",
    DEBUG_ERRORS: process.env.DEBUG_ERRORS || "false",
  },
  observability: { enabled: true },
};

const configPath = ".wrangler.generated.json";
writeFileSync(configPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, { mode: 0o600 });

runPnpm(["run", "build:web"]);
runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath]);
runWrangler(["deploy", "--config", configPath]);

console.log("正在更新 ADMIN_PASSWORD Secret…");
runWrangler(["secret", "put", "ADMIN_PASSWORD", "--config", configPath], false, `${adminSecret}\n`);

console.log(`部署完成。Worker：${workerName}，D1：${databaseName}`);

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
    process.exit(result.status || 1);
  }
  return capture ? `${result.stdout || ""}${result.stderr || ""}` : "";
}

function parseJson(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Wrangler 未返回可识别的 JSON");
  return JSON.parse(output.slice(start, end + 1));
}
