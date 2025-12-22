#!/usr/bin/env node
import { loadBaseEnv } from "@bdx/config";
import { createDb, destroyDb, migrateToLatestWithLock } from "@bdx/db";
import { createLogger } from "@bdx/observability";

const [command] = process.argv.slice(2);

if (!command) {
  console.error("Usage: bdx <command>\n\nCommands:\n  db:migrate");
  process.exitCode = 2;
} else if (command === "db:migrate") {
  const env = loadBaseEnv();
  const logger = createLogger({ env: env.DEPLOY_ENV, level: env.LOG_LEVEL, service: "cli" });
  const db = createDb(env.DATABASE_URL);

  try {
    await migrateToLatestWithLock(db);
    logger.info("migrations complete");
  } catch (error) {
    logger.error({ error }, "migration failed");
    process.exitCode = 1;
  } finally {
    await destroyDb(db);
  }
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}
