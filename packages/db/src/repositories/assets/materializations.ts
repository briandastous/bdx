import type { DbOrTx } from "../../db.js";
import type { AssetMaterializationStatus, AssetSlug, JsonValue } from "../../database.js";

export interface AssetMaterializationRecord {
  id: bigint;
  assetInstanceId: bigint;
  assetSlug: AssetSlug;
  inputsHashVersion: number;
  inputsHash: string;
  dependencyRevisionsHashVersion: number;
  dependencyRevisionsHash: string;
  outputRevision: bigint;
  status: AssetMaterializationStatus;
  startedAt: Date;
  completedAt: Date | null;
  triggerReason: string | null;
  errorPayload: JsonValue | null;
}

export interface AssetMaterializationWithRelations extends AssetMaterializationRecord {
  dependencyMaterializationIds: bigint[];
  requestedByMaterializationIds: bigint[];
}

function toMaterializationRecord(row: {
  id: bigint;
  asset_instance_id: bigint;
  asset_slug: AssetSlug;
  inputs_hash_version: number;
  inputs_hash: string;
  dependency_revisions_hash_version: number;
  dependency_revisions_hash: string;
  output_revision: bigint;
  status: AssetMaterializationStatus;
  started_at: Date;
  completed_at: Date | null;
  trigger_reason: string | null;
  error_payload: JsonValue | null;
}): AssetMaterializationRecord {
  return {
    id: row.id,
    assetInstanceId: row.asset_instance_id,
    assetSlug: row.asset_slug,
    inputsHashVersion: row.inputs_hash_version,
    inputsHash: row.inputs_hash,
    dependencyRevisionsHashVersion: row.dependency_revisions_hash_version,
    dependencyRevisionsHash: row.dependency_revisions_hash,
    outputRevision: row.output_revision,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    triggerReason: row.trigger_reason,
    errorPayload: row.error_payload,
  };
}

export async function createAssetMaterialization(
  db: DbOrTx,
  input: {
    assetInstanceId: bigint;
    assetSlug: AssetSlug;
    inputsHashVersion: number;
    inputsHash: string;
    dependencyRevisionsHashVersion: number;
    dependencyRevisionsHash: string;
    triggerReason: string | null;
  },
): Promise<AssetMaterializationRecord> {
  const row = await db
    .insertInto("asset_materializations")
    .values({
      asset_instance_id: input.assetInstanceId,
      asset_slug: input.assetSlug,
      inputs_hash_version: input.inputsHashVersion,
      inputs_hash: input.inputsHash,
      dependency_revisions_hash_version: input.dependencyRevisionsHashVersion,
      dependency_revisions_hash: input.dependencyRevisionsHash,
      trigger_reason: input.triggerReason,
      status: "in_progress",
    })
    .returning([
      "id",
      "asset_instance_id",
      "asset_slug",
      "inputs_hash_version",
      "inputs_hash",
      "dependency_revisions_hash_version",
      "dependency_revisions_hash",
      "output_revision",
      "status",
      "started_at",
      "completed_at",
      "trigger_reason",
      "error_payload",
    ])
    .executeTakeFirstOrThrow();

  return toMaterializationRecord(row);
}

export async function updateAssetMaterialization(
  db: DbOrTx,
  materializationId: bigint,
  update: {
    status: AssetMaterializationStatus;
    completedAt: Date | null;
    outputRevision: bigint | null;
    errorPayload?: JsonValue | null;
  },
): Promise<number> {
  const result = await db
    .updateTable("asset_materializations")
    .set({
      status: update.status,
      completed_at: update.completedAt,
      output_revision: update.outputRevision ?? 0n,
      error_payload: update.errorPayload ?? null,
    })
    .where("id", "=", materializationId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0n);
}

export async function getAssetMaterializationById(
  db: DbOrTx,
  materializationId: bigint,
): Promise<AssetMaterializationWithRelations | null> {
  const row = await db
    .selectFrom("asset_materializations")
    .select([
      "id",
      "asset_instance_id",
      "asset_slug",
      "inputs_hash_version",
      "inputs_hash",
      "dependency_revisions_hash_version",
      "dependency_revisions_hash",
      "output_revision",
      "status",
      "started_at",
      "completed_at",
      "trigger_reason",
      "error_payload",
    ])
    .where("id", "=", materializationId)
    .executeTakeFirst();

  if (!row) return null;

  const dependencies = await db
    .selectFrom("asset_materialization_dependencies")
    .select(["dependency_materialization_id"])
    .where("materialization_id", "=", materializationId)
    .execute();

  const requests = await db
    .selectFrom("asset_materialization_requests")
    .select(["requested_by_materialization_id"])
    .where("materialization_id", "=", materializationId)
    .execute();

  return {
    ...toMaterializationRecord(row),
    dependencyMaterializationIds: dependencies.map((dep) => dep.dependency_materialization_id),
    requestedByMaterializationIds: requests.map((req) => req.requested_by_materialization_id),
  };
}

export async function getLatestSuccessfulMaterialization(
  db: DbOrTx,
  instanceId: bigint,
): Promise<AssetMaterializationRecord | null> {
  const row = await db
    .selectFrom("asset_materializations")
    .select([
      "id",
      "asset_instance_id",
      "asset_slug",
      "inputs_hash_version",
      "inputs_hash",
      "dependency_revisions_hash_version",
      "dependency_revisions_hash",
      "output_revision",
      "status",
      "started_at",
      "completed_at",
      "trigger_reason",
      "error_payload",
    ])
    .where("asset_instance_id", "=", instanceId)
    .where("status", "=", "success")
    .orderBy("completed_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  return row ? toMaterializationRecord(row) : null;
}

export async function listMaterializationsForInstance(
  db: DbOrTx,
  params: { instanceId: bigint; limit: number },
): Promise<AssetMaterializationRecord[]> {
  const rows = await db
    .selectFrom("asset_materializations")
    .select([
      "id",
      "asset_instance_id",
      "asset_slug",
      "inputs_hash_version",
      "inputs_hash",
      "dependency_revisions_hash_version",
      "dependency_revisions_hash",
      "output_revision",
      "status",
      "started_at",
      "completed_at",
      "trigger_reason",
      "error_payload",
    ])
    .where("asset_instance_id", "=", params.instanceId)
    .orderBy("id", "desc")
    .limit(params.limit)
    .execute();

  return rows.map(toMaterializationRecord);
}

export async function insertMaterializationDependencies(
  db: DbOrTx,
  materializationId: bigint,
  dependencyMaterializationIds: bigint[],
): Promise<number> {
  if (dependencyMaterializationIds.length === 0) return 0;

  const values = dependencyMaterializationIds.map((dependencyId) => ({
    materialization_id: materializationId,
    dependency_materialization_id: dependencyId,
  }));

  const result = await db
    .insertInto("asset_materialization_dependencies")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["materialization_id", "dependency_materialization_id"]).doNothing(),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function insertMaterializationRequests(
  db: DbOrTx,
  materializationId: bigint,
  requestedByMaterializationIds: bigint[],
): Promise<number> {
  if (requestedByMaterializationIds.length === 0) return 0;

  const values = requestedByMaterializationIds.map((requestedId) => ({
    materialization_id: materializationId,
    requested_by_materialization_id: requestedId,
  }));

  const result = await db
    .insertInto("asset_materialization_requests")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["materialization_id", "requested_by_materialization_id"]).doNothing(),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}
