import { loadWorkerEnv } from "@bdx/config";
import { createDb, destroyDb, migrateToLatestWithLock } from "@bdx/db";
import { AssetEngine, runEngineLoop } from "@bdx/engine";
import { createLogger } from "@bdx/observability";

const env = loadWorkerEnv();
const logger = createLogger({ env: env.DEPLOY_ENV, level: env.LOG_LEVEL, service: "worker" });
const db = createDb(env.DATABASE_URL);

const abortController = new AbortController();
process.once("SIGINT", () => abortController.abort());
process.once("SIGTERM", () => abortController.abort());

try {
  if (env.RUN_MIGRATIONS) {
    await migrateToLatestWithLock(db);
  }

  const engine = new AssetEngine({ db, logger });
  await runEngineLoop({ engine, intervalMs: env.ENGINE_TICK_INTERVAL_MS, signal: abortController.signal });
} catch (error) {
  logger.error({ error }, "worker failed");
  process.exitCode = 1;
} finally {
  await destroyDb(db);
}
