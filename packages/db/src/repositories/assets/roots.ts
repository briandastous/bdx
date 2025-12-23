import type { DbOrTx } from "../../db.js";
import type { AssetInstanceFanoutMode, AssetSlug } from "../../database.js";
import { joinAssetInstances } from "../../queries/joins.js";
import type { AssetInstanceFanoutRootId, AssetInstanceId, AssetInstanceRootId } from "@bdx/ids";
import {
  AssetInstanceFanoutRootId as AssetInstanceFanoutRootIdBrand,
  AssetInstanceId as AssetInstanceIdBrand,
  AssetInstanceRootId as AssetInstanceRootIdBrand,
} from "@bdx/ids";

export interface AssetInstanceRootRecord {
  id: AssetInstanceRootId;
  instanceId: AssetInstanceId;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface AssetInstanceRootWithDetails extends AssetInstanceRootRecord {
  assetSlug: AssetSlug;
  paramsHash: string;
  paramsHashVersion: number;
}

export interface AssetInstanceFanoutRootRecord {
  id: AssetInstanceFanoutRootId;
  sourceInstanceId: AssetInstanceId;
  targetAssetSlug: AssetSlug;
  fanoutMode: AssetInstanceFanoutMode;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface AssetInstanceFanoutRootWithDetails extends AssetInstanceFanoutRootRecord {
  sourceAssetSlug: AssetSlug;
  sourceParamsHash: string;
  sourceParamsHashVersion: number;
}

export async function listEnabledAssetInstanceRoots(
  db: DbOrTx,
): Promise<AssetInstanceRootRecord[]> {
  const rows = await db
    .selectFrom("asset_instance_roots")
    .select(["id", "instance_id", "created_at", "disabled_at"])
    .where("disabled_at", "is", null)
    .orderBy("id", "asc")
    .execute();

  return rows.map((row) => ({
    id: AssetInstanceRootIdBrand(row.id),
    instanceId: AssetInstanceIdBrand(row.instance_id),
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  }));
}

export async function listEnabledAssetInstanceRootsWithDetails(
  db: DbOrTx,
): Promise<AssetInstanceRootWithDetails[]> {
  const rows = await joinAssetInstances(
    db.selectFrom("asset_instance_roots as roots"),
    "roots.instance_id",
  )
    .select([
      "roots.id as root_id",
      "roots.instance_id",
      "roots.created_at",
      "roots.disabled_at",
      "instances.asset_slug",
      "instances.params_hash",
      "instances.params_hash_version",
    ])
    .where("roots.disabled_at", "is", null)
    .orderBy("roots.id", "asc")
    .execute();

  return rows.map((row) => ({
    id: AssetInstanceRootIdBrand(row.root_id),
    instanceId: AssetInstanceIdBrand(row.instance_id),
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    assetSlug: row.asset_slug,
    paramsHash: row.params_hash,
    paramsHashVersion: row.params_hash_version,
  }));
}

export async function listEnabledAssetInstanceFanoutRoots(
  db: DbOrTx,
): Promise<AssetInstanceFanoutRootRecord[]> {
  const rows = await db
    .selectFrom("asset_instance_fanout_roots")
    .select([
      "id",
      "source_instance_id",
      "target_asset_slug",
      "fanout_mode",
      "created_at",
      "disabled_at",
    ])
    .where("disabled_at", "is", null)
    .orderBy("id", "asc")
    .execute();

  return rows.map((row) => ({
    id: AssetInstanceFanoutRootIdBrand(row.id),
    sourceInstanceId: AssetInstanceIdBrand(row.source_instance_id),
    targetAssetSlug: row.target_asset_slug,
    fanoutMode: row.fanout_mode,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  }));
}

export async function listEnabledAssetInstanceFanoutRootsWithDetails(
  db: DbOrTx,
): Promise<AssetInstanceFanoutRootWithDetails[]> {
  const rows = await joinAssetInstances(
    db.selectFrom("asset_instance_fanout_roots as roots"),
    "roots.source_instance_id",
  )
    .select([
      "roots.id as root_id",
      "roots.source_instance_id",
      "roots.target_asset_slug",
      "roots.fanout_mode",
      "roots.created_at",
      "roots.disabled_at",
      "instances.asset_slug",
      "instances.params_hash",
      "instances.params_hash_version",
    ])
    .where("roots.disabled_at", "is", null)
    .orderBy("roots.id", "asc")
    .execute();

  return rows.map((row) => ({
    id: AssetInstanceFanoutRootIdBrand(row.root_id),
    sourceInstanceId: AssetInstanceIdBrand(row.source_instance_id),
    targetAssetSlug: row.target_asset_slug,
    fanoutMode: row.fanout_mode,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    sourceAssetSlug: row.asset_slug,
    sourceParamsHash: row.params_hash,
    sourceParamsHashVersion: row.params_hash_version,
  }));
}

export async function enableAssetInstanceRoot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<AssetInstanceRootRecord> {
  const row =
    (await db
      .insertInto("asset_instance_roots")
      .values({ instance_id: instanceId, disabled_at: null })
      .onConflict((oc) => oc.column("instance_id").doUpdateSet({ disabled_at: null }))
      .returning(["id", "instance_id", "created_at", "disabled_at"])
      .executeTakeFirst()) ??
    (await db
      .selectFrom("asset_instance_roots")
      .select(["id", "instance_id", "created_at", "disabled_at"])
      .where("instance_id", "=", instanceId)
      .executeTakeFirstOrThrow());

  return {
    id: AssetInstanceRootIdBrand(row.id),
    instanceId: AssetInstanceIdBrand(row.instance_id),
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export async function disableAssetInstanceRoot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<number> {
  const result = await db
    .updateTable("asset_instance_roots")
    .set({ disabled_at: new Date() })
    .where("instance_id", "=", instanceId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function enableAssetInstanceFanoutRoot(
  db: DbOrTx,
  params: {
    sourceInstanceId: AssetInstanceId;
    targetAssetSlug: AssetSlug;
    fanoutMode: AssetInstanceFanoutMode;
  },
): Promise<AssetInstanceFanoutRootRecord> {
  const row =
    (await db
      .insertInto("asset_instance_fanout_roots")
      .values({
        source_instance_id: params.sourceInstanceId,
        target_asset_slug: params.targetAssetSlug,
        fanout_mode: params.fanoutMode,
        disabled_at: null,
      })
      .onConflict((oc) =>
        oc
          .columns(["source_instance_id", "target_asset_slug", "fanout_mode"])
          .doUpdateSet({ disabled_at: null }),
      )
      .returning([
        "id",
        "source_instance_id",
        "target_asset_slug",
        "fanout_mode",
        "created_at",
        "disabled_at",
      ])
      .executeTakeFirst()) ??
    (await db
      .selectFrom("asset_instance_fanout_roots")
      .select([
        "id",
        "source_instance_id",
        "target_asset_slug",
        "fanout_mode",
        "created_at",
        "disabled_at",
      ])
      .where("source_instance_id", "=", params.sourceInstanceId)
      .where("target_asset_slug", "=", params.targetAssetSlug)
      .where("fanout_mode", "=", params.fanoutMode)
      .executeTakeFirstOrThrow());

  return {
    id: AssetInstanceFanoutRootIdBrand(row.id),
    sourceInstanceId: AssetInstanceIdBrand(row.source_instance_id),
    targetAssetSlug: row.target_asset_slug,
    fanoutMode: row.fanout_mode,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export async function disableAssetInstanceFanoutRoot(
  db: DbOrTx,
  params: {
    sourceInstanceId: AssetInstanceId;
    targetAssetSlug: AssetSlug;
    fanoutMode: AssetInstanceFanoutMode;
  },
): Promise<number> {
  const result = await db
    .updateTable("asset_instance_fanout_roots")
    .set({ disabled_at: new Date() })
    .where("source_instance_id", "=", params.sourceInstanceId)
    .where("target_asset_slug", "=", params.targetAssetSlug)
    .where("fanout_mode", "=", params.fanoutMode)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}
