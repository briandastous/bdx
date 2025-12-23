import type { BaseEnv, WorkerEnv } from "@bdx/config";
import { createDb, destroyDb, type Db } from "@bdx/db";
import { createLogger } from "@bdx/observability";
import type { Logger } from "@bdx/observability";
import { TwitterApiClient } from "@bdx/twitterapi-io";

function rateLimitQpsToMinIntervalMs(rateLimitQps: number): number {
  return Math.ceil(1000 / rateLimitQps);
}

export function createLoggerFromEnv(env: { DEPLOY_ENV: string; LOG_LEVEL: string }): Logger {
  return createLogger({ env: env.DEPLOY_ENV, level: env.LOG_LEVEL, service: "cli" });
}

export function createDbFromEnv(env: BaseEnv): Db {
  return createDb(env.DATABASE_URL, env.db);
}

export async function destroyDbSafely(db: Db): Promise<void> {
  await destroyDb(db);
}

export function createTwitterClient(env: WorkerEnv): TwitterApiClient {
  return new TwitterApiClient({
    token: env.twitterapiIo.token,
    baseUrl: env.twitterapiIo.baseUrl,
    minIntervalMs: rateLimitQpsToMinIntervalMs(env.twitterapiIo.rateLimitQps),
  });
}
