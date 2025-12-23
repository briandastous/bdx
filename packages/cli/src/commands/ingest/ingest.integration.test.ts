import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, destroyDb, migrateToLatest, type Db } from "@bdx/db";
import IngestFollowers from "./followers.js";

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return { ...process.env };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("follows_meta").execute();
  await db.deleteFrom("follows").execute();
  await db.deleteFrom("followers_sync_runs").execute();
  await db.deleteFrom("ingest_events").execute();
  await db.deleteFrom("users_meta").execute();
  await db.deleteFrom("user_handle_history").execute();
  await db.deleteFrom("users").execute();
}

async function createFixtureServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/twitter/user/batch_info_by_ids") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ users: [{ id: "1", userName: "target", name: "Target" }] }));
      return;
    }
    if (url.pathname === "/twitter/user/followers") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          followers: [{ id: "10", userName: "follower", name: "Follower" }],
          next_cursor: null,
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("CLI ingest commands", () => {
  const cliRootUrl = new URL("../../../", import.meta.url).toString();
  let container: StartedPostgreSqlContainer;
  let db: Db;
  let envSnapshot: EnvSnapshot;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    envSnapshot = snapshotEnv();
    container = await new PostgreSqlContainer("postgres:18")
      .withDatabase("bdx_test")
      .withUsername("bdx")
      .withPassword("bdx")
      .start();
    db = createDb(container.getConnectionUri());
    await migrateToLatest(db);

    const fixtureServer = await createFixtureServer();
    server = fixtureServer.server;
    baseUrl = fixtureServer.url;
  });

  beforeEach(async () => {
    await resetDb(db);
    process.env["DATABASE_URL"] = container.getConnectionUri();
    process.env["NODE_ENV"] = "test";
    process.env["LOG_LEVEL"] = "silent";
    process.env["TWITTERAPI_IO_TOKEN"] = "test-token";
    process.env["TWITTERAPI_IO_BASE_URL"] = baseUrl;
    process.env["TWITTERAPI_IO_RATE_LIMIT_QPS"] = "1000";
    process.env["X_SELF_USER_ID"] = "1";
    process.env["X_SELF_HANDLE"] = "target";
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await destroyDb(db);
    await container.stop();
  });

  it("runs followers ingest via the CLI", async () => {
    await IngestFollowers.run(["--user-id", "1", "--mode", "full"], cliRootUrl);

    const run = await db
      .selectFrom("followers_sync_runs")
      .select(["status", "cursor_exhausted", "last_api_status"])
      .orderBy("ingest_event_id", "desc")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("success");
    expect(run.cursor_exhausted).toBe(true);
    expect(run.last_api_status).toBe("200");

    const edges = await db
      .selectFrom("follows")
      .select(["target_id", "follower_id", "is_deleted"])
      .orderBy("follower_id", "asc")
      .execute();
    expect(edges).toEqual([{ target_id: 1n, follower_id: 10n, is_deleted: false }]);
  });
});
