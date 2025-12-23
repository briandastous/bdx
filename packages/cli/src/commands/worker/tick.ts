import { Command } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { migrateToLatestWithLock } from "@bdx/db";
import { AssetEngine, runEngineLoop } from "@bdx/engine";
import { createDbFromEnv, createLoggerFromEnv, createTwitterClient, destroyDbSafely } from "../../lib/context.js";

export default class WorkerTick extends Command {
  static override description = "Run a single asset engine tick and exit.";

  async run(): Promise<void> {
    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    const abortController = new AbortController();
    process.once("SIGINT", () => abortController.abort());
    process.once("SIGTERM", () => abortController.abort());

    try {
      if (env.RUN_MIGRATIONS) {
        await migrateToLatestWithLock(db);
      }

      const twitterClient = createTwitterClient(env);
      const engine = new AssetEngine({
        db,
        logger,
        twitterClient,
        postsMaxQueryLength: env.twitterapiIo.maxQueryLength,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      await runEngineLoop({
        engine,
        intervalMs: env.ENGINE_TICK_INTERVAL_MS,
        signal: abortController.signal,
        singleTick: true,
        onError: (error) => {
          logger.error({ error }, "engine tick failed");
        },
      });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
