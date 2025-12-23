import { loadWorkerEnv } from "@bdx/config";
import {
  createDb,
  destroyDb,
  migrateToLatestWithLock,
  recordWorkerHeartbeat,
  releaseAdvisoryLock,
  runRetention,
  tryAdvisoryLock,
} from "@bdx/db";
import { AssetEngine, runEngineLoop } from "@bdx/engine";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient } from "@bdx/twitterapi-io";
import http from "node:http";
import os from "node:os";

const env = loadWorkerEnv();
const logger = createLogger({ env: env.DEPLOY_ENV, level: env.LOG_LEVEL, service: "worker" });
const db = createDb(env.DATABASE_URL, env.db);

const abortController = new AbortController();
process.once("SIGINT", () => {
  abortController.abort();
});
process.once("SIGTERM", () => {
  abortController.abort();
});

function rateLimitQpsToMinIntervalMs(rateLimitQps: number): number {
  return Math.ceil(1000 / rateLimitQps);
}

const twitterClient = new TwitterApiClient({
  token: env.twitterapiIo.token,
  baseUrl: env.twitterapiIo.baseUrl,
  minIntervalMs: rateLimitQpsToMinIntervalMs(env.twitterapiIo.rateLimitQps),
});

const workerId = `${os.hostname()}:${process.pid}`;
const heartbeatIntervalMs = 60_000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let healthServer: http.Server | null = null;
let retentionTimer: NodeJS.Timeout | null = null;

async function recordHeartbeat() {
  await recordWorkerHeartbeat(db, {
    service: "worker",
    workerId,
    lastHeartbeatAt: new Date(),
  });
}

async function runRetentionOnce(): Promise<void> {
  if (!env.retention.enabled) return;
  const lockKey = "retention:cleanup";
  const acquired = await tryAdvisoryLock(db, lockKey);
  if (!acquired) {
    logger.info("retention skipped (lock held)");
    return;
  }

  try {
    const result = await runRetention(db, env.retention);
    logger.info(
      {
        plannerEventsDeleted: result.plannerEventsDeleted,
        ingestEventsDeleted: result.ingestEventsDeleted,
        webhookEventsDeleted: result.webhookEventsDeleted,
      },
      "retention run completed",
    );
  } finally {
    await releaseAdvisoryLock(db, lockKey);
  }
}

try {
  if (env.WORKER_HEALTH_PORT) {
    healthServer = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });
    healthServer.listen(env.WORKER_HEALTH_PORT, () => {
      logger.info({ port: env.WORKER_HEALTH_PORT }, "worker health server listening");
    });
  }

  if (env.RUN_MIGRATIONS) {
    await migrateToLatestWithLock(db);
  }

  if (env.retention.enabled) {
    await runRetentionOnce();
    retentionTimer = setInterval(() => {
      void runRetentionOnce().catch((error: unknown) => {
        logger.warn({ error }, "retention run failed");
      });
    }, env.retention.periodMs);
  }

  await recordHeartbeat();
  heartbeatTimer = setInterval(() => {
    void recordHeartbeat().catch((error: unknown) => {
      logger.warn({ error }, "failed to record worker heartbeat");
    });
  }, heartbeatIntervalMs);

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
    singleTick: env.ENGINE_SINGLE_TICK,
    onError: (error) => {
      logger.error({ error }, "engine tick failed");
    },
  });
} catch (error: unknown) {
  logger.error({ error }, "worker failed");
  process.exitCode = 1;
} finally {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  if (retentionTimer) {
    clearInterval(retentionTimer);
  }
  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer?.close(() => {
        resolve();
      });
    });
  }
  await destroyDb(db);
}
