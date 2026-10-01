import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApi } from "./api";
import { NodeScriptStore } from "./node-store";

const store = new NodeScriptStore();
const app = createApi({
  getStore: () => store,
  getConfig: () => ({
    adminToken: process.env.ADMIN_TOKEN,
    importHosts: process.env.IMPORT_HOSTS,
    maxScriptBytes: process.env.MAX_SCRIPT_BYTES,
  }),
});

app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const port = Number(process.env.PORT || 8787);
const hostname = process.env.HOST || "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Script Hub listening on http://${hostname}:${info.port}`);
});
