import { loadApiEnv } from "@bdx/config";
import { createDb, destroyDb } from "@bdx/db";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient } from "@bdx/twitterapi-io";
import { buildServer } from "./server.js";

const env = loadApiEnv();
const logger = createLogger({ env: env.DEPLOY_ENV, level: env.LOG_LEVEL, service: "api" });

const db = createDb(env.DATABASE_URL, env.db);
const twitterClient = new TwitterApiClient({
  token: env.twitterapiIo.token,
  baseUrl: env.twitterapiIo.baseUrl,
  minIntervalMs: Math.ceil(1000 / env.twitterapiIo.rateLimitQps),
});
const server = buildServer({
  db,
  logger,
  webhookToken: env.WEBHOOK_TOKEN,
  twitterClient,
  xSelf: env.x.self,
  usersByIdsBatchSize: env.twitterapiIo.batchUsersByIdsMax,
});

let shuttingDown = false;
async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  server.log.info({ signal }, "shutting down");
  await server.close();
  await destroyDb(db);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ host: env.HOST, port: env.PORT });
  server.log.info({ host: env.HOST, port: env.PORT }, "api listening");
} catch (error) {
  server.log.error({ error }, "api failed to start");
  process.exitCode = 1;
  await shutdown("SIGTERM");
}
