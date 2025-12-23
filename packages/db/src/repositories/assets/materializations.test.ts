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
  createAssetMaterialization,
  getAssetMaterializationById,
  getOrCreateAssetInstance,
  getOrCreateAssetParams,
  insertMaterializationDependencies,
  insertMaterializationRequests,
  updateAssetMaterialization,
} from "../../index.js";

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("asset_materializations").execute();
  await db.deleteFrom("asset_instances").execute();
  await db.deleteFrom("asset_params").execute();
}

async function createAssetInstance(db: Db): Promise<bigint> {
  const params = await getOrCreateAssetParams(db, {
    assetSlug: "segment_specified_users",
    paramsHash: "mat-test",
    paramsHashVersion: 1,
    stableKey: "materializations",
  });
  const instance = await getOrCreateAssetInstance(db, {
    paramsId: params.id,
    assetSlug: "segment_specified_users",
    paramsHash: "mat-test",
    paramsHashVersion: 1,
  });
  return instance.id;
}

describe("asset materialization constraints", () => {
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

  it("requires completed_at for non-in-progress statuses", async () => {
    const instanceId = await createAssetInstance(db);

    const materialization = await createAssetMaterialization(db, {
      assetInstanceId: instanceId,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps",
      triggerReason: "test",
    });

    await expect(
      updateAssetMaterialization(db, materialization.id, {
        status: "success",
        completedAt: null,
        outputRevision: 1n,
        errorPayload: null,
      }),
    ).rejects.toThrow();

    await updateAssetMaterialization(db, materialization.id, {
      status: "success",
      completedAt: new Date("2024-01-01T00:00:00Z"),
      outputRevision: 1n,
      errorPayload: null,
    });

    const row = await db
      .selectFrom("asset_materializations")
      .select(["status", "completed_at"])
      .where("id", "=", materialization.id)
      .executeTakeFirstOrThrow();

    expect(row.status).toBe("success");
    expect(row.completed_at).not.toBeNull();
  });

  it("stores dependency and request links for provenance", async () => {
    const instanceId = await createAssetInstance(db);

    const base = await createAssetMaterialization(db, {
      assetInstanceId: instanceId,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs-base",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps-base",
      triggerReason: "test",
    });
    const related = await createAssetMaterialization(db, {
      assetInstanceId: instanceId,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs-related",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps-related",
      triggerReason: "test",
    });

    await insertMaterializationDependencies(db, base.id, [related.id]);
    await insertMaterializationRequests(db, base.id, [related.id]);

    const record = await getAssetMaterializationById(db, base.id);
    expect(record?.dependencyMaterializationIds).toEqual([related.id]);
    expect(record?.requestedByMaterializationIds).toEqual([related.id]);
  });
});
