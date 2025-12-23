import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type StartedPostgreSqlContainer,
  PostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Db } from "../../index.js";
import {
  createDb,
  destroyDb,
  migrateToLatest,
  disableAssetInstanceFanoutRoot,
  disableAssetInstanceRoot,
  enableAssetInstanceFanoutRoot,
  enableAssetInstanceRoot,
  getOrCreateAssetInstance,
  getOrCreateAssetParams,
  listEnabledAssetInstanceFanoutRoots,
  listEnabledAssetInstanceRoots,
} from "../../index.js";

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("asset_instance_fanout_roots").execute();
  await db.deleteFrom("asset_instance_roots").execute();
  await db.deleteFrom("asset_instances").execute();
  await db.deleteFrom("asset_params").execute();
}

async function createAssetInstance(db: Db): Promise<bigint> {
  const params = await getOrCreateAssetParams(db, {
    assetSlug: "segment_specified_users",
    paramsHash: "roots-test",
    paramsHashVersion: 1,
    stableKey: "roots",
  });
  const instance = await getOrCreateAssetInstance(db, {
    paramsId: params.id,
    assetSlug: "segment_specified_users",
    paramsHash: "roots-test",
    paramsHashVersion: 1,
  });
  return instance.id;
}

describe("asset roots repository", () => {
  let container: StartedPostgreSqlContainer;
  let db: Db;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  it("enables and disables asset instance roots", async () => {
    const instanceId = await createAssetInstance(db);

    await enableAssetInstanceRoot(db, instanceId);
    let roots = await listEnabledAssetInstanceRoots(db);
    expect(roots.map((root) => root.instanceId)).toEqual([instanceId]);

    await disableAssetInstanceRoot(db, instanceId);
    roots = await listEnabledAssetInstanceRoots(db);
    expect(roots).toEqual([]);
  });

  it("enables and disables fanout roots", async () => {
    const instanceId = await createAssetInstance(db);

    await enableAssetInstanceFanoutRoot(db, {
      sourceInstanceId: instanceId,
      targetAssetSlug: "segment_followers",
      fanoutMode: "global_per_item",
    });

    let roots = await listEnabledAssetInstanceFanoutRoots(db);
    expect(roots.map((root) => root.sourceInstanceId)).toEqual([instanceId]);

    await disableAssetInstanceFanoutRoot(db, {
      sourceInstanceId: instanceId,
      targetAssetSlug: "segment_followers",
      fanoutMode: "global_per_item",
    });

    roots = await listEnabledAssetInstanceFanoutRoots(db);
    expect(roots).toEqual([]);
  });
});
