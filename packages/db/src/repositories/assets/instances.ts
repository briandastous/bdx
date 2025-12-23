import type { DbOrTx } from "../../db.js";
import type { AssetSlug } from "../../database.js";

export interface AssetInstanceRecord {
  id: bigint;
  paramsId: bigint;
  assetSlug: AssetSlug;
  paramsHashVersion: number;
  paramsHash: string;
  currentMembershipMaterializationId: bigint | null;
}

function toInstanceRecord(row: {
  id: bigint;
  params_id: bigint;
  asset_slug: AssetSlug;
  params_hash_version: number;
  params_hash: string;
  current_membership_materialization_id: bigint | null;
}): AssetInstanceRecord {
  return {
    id: row.id,
    paramsId: row.params_id,
    assetSlug: row.asset_slug,
    paramsHashVersion: row.params_hash_version,
    paramsHash: row.params_hash,
    currentMembershipMaterializationId: row.current_membership_materialization_id,
  };
}

export async function getAssetInstanceById(
  db: DbOrTx,
  instanceId: bigint,
): Promise<AssetInstanceRecord | null> {
  const row = await db
    .selectFrom("asset_instances")
    .select([
      "id",
      "params_id",
      "asset_slug",
      "params_hash_version",
      "params_hash",
      "current_membership_materialization_id",
    ])
    .where("id", "=", instanceId)
    .executeTakeFirst();

  return row ? toInstanceRecord(row) : null;
}

export async function getAssetInstanceBySlugHash(
  db: DbOrTx,
  params: { assetSlug: AssetSlug; paramsHash: string; paramsHashVersion: number },
): Promise<AssetInstanceRecord | null> {
  const row = await db
    .selectFrom("asset_instances")
    .select([
      "id",
      "params_id",
      "asset_slug",
      "params_hash_version",
      "params_hash",
      "current_membership_materialization_id",
    ])
    .where("asset_slug", "=", params.assetSlug)
    .where("params_hash_version", "=", params.paramsHashVersion)
    .where("params_hash", "=", params.paramsHash)
    .executeTakeFirst();

  return row ? toInstanceRecord(row) : null;
}

export async function getOrCreateAssetInstance(
  db: DbOrTx,
  input: { paramsId: bigint; assetSlug: AssetSlug; paramsHash: string; paramsHashVersion: number },
): Promise<AssetInstanceRecord> {
  const inserted =
    (await db
      .insertInto("asset_instances")
      .values({
        params_id: input.paramsId,
        asset_slug: input.assetSlug,
        params_hash_version: input.paramsHashVersion,
        params_hash: input.paramsHash,
      })
      .onConflict((oc) => oc.column("params_id").doNothing())
      .returning([
        "id",
        "params_id",
        "asset_slug",
        "params_hash_version",
        "params_hash",
        "current_membership_materialization_id",
      ])
      .executeTakeFirst()) ??
    (await db
      .selectFrom("asset_instances")
      .select([
        "id",
        "params_id",
        "asset_slug",
        "params_hash_version",
        "params_hash",
        "current_membership_materialization_id",
      ])
      .where("params_id", "=", input.paramsId)
      .executeTakeFirstOrThrow());

  return toInstanceRecord(inserted);
}

export async function updateCurrentMembershipMaterialization(
  db: DbOrTx,
  params: { instanceId: bigint; materializationId: bigint | null },
): Promise<number> {
  const result = await db
    .updateTable("asset_instances")
    .set({ current_membership_materialization_id: params.materializationId })
    .where("id", "=", params.instanceId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0n);
}
