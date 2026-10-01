import { createApi } from "./api";
import { D1ScriptStore } from "./d1-store";

interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
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
      importHosts: env.IMPORT_HOSTS,
      maxScriptBytes: env.MAX_SCRIPT_BYTES,
    };
  },
});

export default app;
