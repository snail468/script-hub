import { createApi } from "./api";
import { D1ScriptStore } from "./d1-store";

interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ALLOW_REGISTRATION?: string;
  IMPORT_HOSTS?: string;
  MAX_SCRIPT_BYTES?: string;
}

const stores = new WeakMap<D1Database, D1ScriptStore>();

const app = createApi({
  getStore: (context) => {
    const database = (context.env as Bindings).DB;
    let store = stores.get(database);
    if (!store) {
      store = new D1ScriptStore(database);
      stores.set(database, store);
    }
    return store;
  },
  getConfig: (context) => {
    const env = context.env as Bindings;
    return {
      adminToken: env.ADMIN_TOKEN,
      adminUsername: env.ADMIN_USERNAME,
      adminPassword: env.ADMIN_PASSWORD,
      allowRegistration: env.ALLOW_REGISTRATION,
      importHosts: env.IMPORT_HOSTS,
      maxScriptBytes: env.MAX_SCRIPT_BYTES,
      // Cloudflare Workers production currently rejects PBKDF2 counts above 100,000.
      passwordIterations: 100_000,
    };
  },
});

export default app;
