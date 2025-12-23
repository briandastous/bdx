import { Command } from "@oclif/core";
import { loadBaseEnv } from "@bdx/config";
import { migrateToLatestWithLock } from "@bdx/db";
import { createLoggerFromEnv, createDbFromEnv, destroyDbSafely } from "../../lib/context.js";

export default class DbMigrate extends Command {
  static override description = "Run database migrations with advisory locking.";

  async run(): Promise<void> {
    const env = loadBaseEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      await migrateToLatestWithLock(db);
      this.log("migrations complete");
    } catch (error) {
      logger.error({ error }, "migration failed");
      this.error("migration failed", { exit: 1 });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
