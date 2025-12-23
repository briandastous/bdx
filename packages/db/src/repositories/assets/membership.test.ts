import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, destroyDb, migrateToLatest, type Db } from "../../index.js";
import { UserId } from "@bdx/ids";
import { ensureUsers } from "../users.js";
import { getOrCreateAssetParams } from "./params.js";
import { getOrCreateAssetInstance } from "./instances.js";
import {
  insertSegmentEvents,
  replaceSegmentMembershipSnapshot,
  getSegmentMembershipAsOf,
} from "./membership.js";
import { createAssetMaterialization, updateAssetMaterialization } from "./materializations.js";

describe("segment membership as-of reads", () => {
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

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  it("reuses asset params and instances for identical identity hashes", async () => {
    const params1 = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash: "identity-hash",
      paramsHashVersion: 1,
      stableKey: "alpha",
    });
    const params2 = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash: "identity-hash",
      paramsHashVersion: 1,
      stableKey: "alpha",
    });

    expect(params1.id).toBe(params2.id);

    const instance1 = await getOrCreateAssetInstance(db, {
      paramsId: params1.id,
      assetSlug: "segment_specified_users",
      paramsHash: "identity-hash",
      paramsHashVersion: 1,
    });
    const instance2 = await getOrCreateAssetInstance(db, {
      paramsId: params1.id,
      assetSlug: "segment_specified_users",
      paramsHash: "identity-hash",
      paramsHashVersion: 1,
    });

    expect(instance1.id).toBe(instance2.id);
  });

  it("rewinds membership snapshots by toggling enter/exit events", async () => {
    const user101 = UserId(101n);
    const user102 = UserId(102n);
    const user103 = UserId(103n);
    await ensureUsers(db, [user101, user102, user103]);

    const params = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash: "test-hash",
      paramsHashVersion: 1,
      stableKey: "test",
    });
    const instance = await getOrCreateAssetInstance(db, {
      paramsId: params.id,
      assetSlug: "segment_specified_users",
      paramsHash: "test-hash",
      paramsHashVersion: 1,
    });

    const mat1 = await createAssetMaterialization(db, {
      assetInstanceId: instance.id,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs-1",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps-1",
      triggerReason: "test",
    });
    await insertSegmentEvents(db, mat1.id, [
      { userId: user101, eventType: "enter", isFirstAppearance: true },
    ]);
    await expect(
      insertSegmentEvents(db, mat1.id, [
        { userId: user101, eventType: "enter", isFirstAppearance: true },
      ]),
    ).rejects.toThrow();
    await updateAssetMaterialization(db, mat1.id, {
      status: "success",
      completedAt: new Date("2024-01-01T00:00:00Z"),
      outputRevision: 1n,
      errorPayload: null,
    });
    await replaceSegmentMembershipSnapshot(db, {
      instanceId: instance.id,
      materializationId: mat1.id,
      userIds: [user101],
    });

    const mat2 = await createAssetMaterialization(db, {
      assetInstanceId: instance.id,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs-2",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps-2",
      triggerReason: "test",
    });
    await insertSegmentEvents(db, mat2.id, [
      { userId: user102, eventType: "enter", isFirstAppearance: true },
    ]);
    await updateAssetMaterialization(db, mat2.id, {
      status: "success",
      completedAt: new Date("2024-01-02T00:00:00Z"),
      outputRevision: 2n,
      errorPayload: null,
    });
    await replaceSegmentMembershipSnapshot(db, {
      instanceId: instance.id,
      materializationId: mat2.id,
      userIds: [user101, user102],
    });

    const mat3 = await createAssetMaterialization(db, {
      assetInstanceId: instance.id,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "inputs-3",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "deps-3",
      triggerReason: "test",
    });
    await insertSegmentEvents(db, mat3.id, [
      { userId: user101, eventType: "exit", isFirstAppearance: null },
      { userId: user103, eventType: "enter", isFirstAppearance: true },
    ]);
    await updateAssetMaterialization(db, mat3.id, {
      status: "success",
      completedAt: new Date("2024-01-03T00:00:00Z"),
      outputRevision: 3n,
      errorPayload: null,
    });
    await replaceSegmentMembershipSnapshot(db, {
      instanceId: instance.id,
      materializationId: mat3.id,
      userIds: [user102, user103],
    });

    const membershipAtMat2 = await getSegmentMembershipAsOf(db, {
      instanceId: instance.id,
      targetMaterializationId: mat2.id,
    });
    expect(membershipAtMat2).toEqual([user101, user102]);

    const membershipAtMat1 = await getSegmentMembershipAsOf(db, {
      instanceId: instance.id,
      targetMaterializationId: mat1.id,
    });
    expect(membershipAtMat1).toEqual([user101]);

    const membershipAtMat3 = await getSegmentMembershipAsOf(db, {
      instanceId: instance.id,
      targetMaterializationId: mat3.id,
    });
    expect(membershipAtMat3).toEqual([user102, user103]);
  });
});
