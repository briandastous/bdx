import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  destroyDb,
  listEnabledAssetInstanceRoots,
  listSpecifiedUsersInputs,
  migrateToLatest,
  type Db,
} from "@bdx/db";
import { UserId } from "@bdx/ids";
import AssetsRootsDisable from "./roots/disable.js";
import AssetsRootsEnable from "./roots/enable.js";

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
  await db.deleteFrom("users_by_ids_ingest_run_requested_users").execute();
  await db.deleteFrom("users_by_ids_ingest_runs").execute();
  await db.deleteFrom("posts_by_ids_ingest_run_requested_posts").execute();
  await db.deleteFrom("posts_by_ids_ingest_runs").execute();
  await db.deleteFrom("ingest_events").execute();
  await db.deleteFrom("users_meta").execute();
  await db.deleteFrom("user_handle_history").execute();
  await db.deleteFrom("users").execute();
  await db.deleteFrom("segment_specified_users_inputs").execute();
  await db.deleteFrom("asset_instance_fanout_roots").execute();
  await db.deleteFrom("asset_instance_roots").execute();
  await db.deleteFrom("asset_instances").execute();
  await db.deleteFrom("asset_params").execute();
}

async function createFixtureServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/twitter/user/batch_info_by_ids") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          users: [
            { id: "101", userName: "user101", name: "User 101" },
            { id: "102", userName: "user102", name: "User 102" },
          ],
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

describe("CLI asset roots", () => {
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
    process.env["X_SELF_HANDLE"] = "self";
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

  it("enables and disables roots via the CLI", async () => {
    await AssetsRootsEnable.run(
      [
        "--slug",
        "segment_specified_users",
        "--params",
        JSON.stringify({ stableKey: "cli-roots" }),
        "--specified-user-ids",
        "101,102",
      ],
      cliRootUrl,
    );

    const roots = await listEnabledAssetInstanceRoots(db);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    if (!root) {
      throw new Error("Expected at least one root");
    }

    const specifiedUsers = await listSpecifiedUsersInputs(db, root.instanceId);
    expect(specifiedUsers).toEqual([UserId(101n), UserId(102n)]);

    await AssetsRootsDisable.run(["--instance-id", root.instanceId.toString()], cliRootUrl);

    const remainingRoots = await listEnabledAssetInstanceRoots(db);
    expect(remainingRoots).toEqual([]);
  });
});
