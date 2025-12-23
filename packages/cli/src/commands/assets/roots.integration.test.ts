import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type StartedPostgreSqlContainer,
  PostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  createDb,
  destroyDb,
  listEnabledAssetInstanceRoots,
  listSpecifiedUsersInputs,
  migrateToLatest,
  type Db,
} from "@bdx/db";
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
  await db.deleteFrom("segment_specified_users_inputs").execute();
  await db.deleteFrom("asset_instance_fanout_roots").execute();
  await db.deleteFrom("asset_instance_roots").execute();
  await db.deleteFrom("asset_instances").execute();
  await db.deleteFrom("asset_params").execute();
}

describe("CLI asset roots", () => {
  const cliRootUrl = new URL("../../../", import.meta.url).toString();
  let container: StartedPostgreSqlContainer;
  let db: Db;
  let envSnapshot: EnvSnapshot;

  beforeAll(async () => {
    envSnapshot = snapshotEnv();
    container = await new PostgreSqlContainer("postgres:18")
      .withDatabase("bdx_test")
      .withUsername("bdx")
      .withPassword("bdx")
      .start();
    db = createDb(container.getConnectionUri());
    await migrateToLatest(db);
  });

  beforeEach(async () => {
    await resetDb(db);
    process.env["DATABASE_URL"] = container.getConnectionUri();
    process.env["NODE_ENV"] = "test";
    process.env["LOG_LEVEL"] = "silent";
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  it("enables and disables roots via the CLI", async () => {
    await AssetsRootsEnable.run([
      "--slug",
      "segment_specified_users",
      "--params",
      JSON.stringify({ stableKey: "cli-roots" }),
      "--specified-user-ids",
      "101,102",
    ], cliRootUrl);

    const roots = await listEnabledAssetInstanceRoots(db);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    if (!root) {
      throw new Error("Expected at least one root");
    }

    const specifiedUsers = await listSpecifiedUsersInputs(db, root.instanceId);
    expect(specifiedUsers).toEqual([101n, 102n]);

    await AssetsRootsDisable.run(["--instance-id", root.instanceId.toString()], cliRootUrl);

    const remainingRoots = await listEnabledAssetInstanceRoots(db);
    expect(remainingRoots).toEqual([]);
  });
});
