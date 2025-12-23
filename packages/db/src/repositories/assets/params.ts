import type { DbOrTx } from "../../db.js";
import type { AssetSlug } from "../../database.js";
import { withTransaction } from "../../transactions.js";

export type AssetParamsInput =
  | {
      assetSlug: "segment_specified_users";
      paramsHash: string;
      paramsHashVersion: number;
      fanoutSourceParamsHash?: string | null;
      fanoutSourceParamsHashVersion?: number | null;
      stableKey: string;
    }
  | {
      assetSlug: "segment_followers" | "segment_followed" | "segment_mutuals" | "segment_unreciprocated_followed";
      paramsHash: string;
      paramsHashVersion: number;
      fanoutSourceParamsHash?: string | null;
      fanoutSourceParamsHashVersion?: number | null;
      subjectExternalId: bigint;
    }
  | {
      assetSlug: "post_corpus_for_segment";
      paramsHash: string;
      paramsHashVersion: number;
      fanoutSourceParamsHash?: string | null;
      fanoutSourceParamsHashVersion?: number | null;
      sourceSegmentParamsId: bigint;
    };

type BaseAssetParamsRecord = {
  id: bigint;
  assetSlug: AssetSlug;
  paramsHashVersion: number;
  paramsHash: string;
  fanoutSourceParamsHash: string | null;
  fanoutSourceParamsHashVersion: number | null;
};

export type AssetParamsRecord =
  | (BaseAssetParamsRecord & {
      assetSlug: "segment_specified_users";
      stableKey: string;
    })
  | (BaseAssetParamsRecord & {
      assetSlug: "segment_followers" | "segment_followed" | "segment_mutuals" | "segment_unreciprocated_followed";
      subjectExternalId: bigint;
    })
  | (BaseAssetParamsRecord & {
      assetSlug: "post_corpus_for_segment";
      sourceSegmentParamsId: bigint;
    });

function normalizeFanoutSourceParamsHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function normalizeFanoutSourceParamsHashVersion(
  value: number | null | undefined,
  hash: string | null,
): number | null {
  if (!hash) return null;
  return value ?? null;
}

async function fetchBaseAssetParamsById(
  db: DbOrTx,
  assetParamsId: bigint,
): Promise<BaseAssetParamsRecord | null> {
  const base = await db
    .selectFrom("asset_params")
    .select([
      "id",
      "asset_slug",
      "params_hash_version",
      "params_hash",
      "fanout_source_params_hash",
      "fanout_source_params_hash_version",
    ])
    .where("id", "=", assetParamsId)
    .executeTakeFirst();

  if (!base) return null;
  return {
    id: base.id,
    assetSlug: base.asset_slug,
    paramsHashVersion: base.params_hash_version,
    paramsHash: base.params_hash,
    fanoutSourceParamsHash: base.fanout_source_params_hash,
    fanoutSourceParamsHashVersion: base.fanout_source_params_hash_version,
  };
}

async function fetchBaseAssetParamsBySlugHash(
  db: DbOrTx,
  params: { assetSlug: AssetSlug; paramsHash: string; paramsHashVersion: number },
): Promise<BaseAssetParamsRecord | null> {
  const base = await db
    .selectFrom("asset_params")
    .select([
      "id",
      "asset_slug",
      "params_hash_version",
      "params_hash",
      "fanout_source_params_hash",
      "fanout_source_params_hash_version",
    ])
    .where("asset_slug", "=", params.assetSlug)
    .where("params_hash_version", "=", params.paramsHashVersion)
    .where("params_hash", "=", params.paramsHash)
    .executeTakeFirst();

  if (!base) return null;
  return {
    id: base.id,
    assetSlug: base.asset_slug,
    paramsHashVersion: base.params_hash_version,
    paramsHash: base.params_hash,
    fanoutSourceParamsHash: base.fanout_source_params_hash,
    fanoutSourceParamsHashVersion: base.fanout_source_params_hash_version,
  };
}

async function fetchSegmentSpecifiedUsersParams(
  db: DbOrTx,
  base: BaseAssetParamsRecord,
): Promise<AssetParamsRecord> {
  const row = await db
    .selectFrom("segment_specified_users_params")
    .select(["stable_key"])
    .where("asset_params_id", "=", base.id)
    .executeTakeFirst();

  if (!row) {
    throw new Error(`Missing segment_specified_users_params for asset_params_id=${base.id.toString()}`);
  }

  return {
    ...base,
    assetSlug: "segment_specified_users",
    stableKey: row.stable_key,
  };
}

async function fetchSubjectSegmentParams(
  db: DbOrTx,
  base: BaseAssetParamsRecord,
): Promise<AssetParamsRecord> {
  let row:
    | { subject_external_id: bigint }
    | undefined;

  switch (base.assetSlug) {
    case "segment_followers":
      row = await db
        .selectFrom("segment_followers_params")
        .select(["subject_external_id"])
        .where("asset_params_id", "=", base.id)
        .executeTakeFirst();
      break;
    case "segment_followed":
      row = await db
        .selectFrom("segment_followed_params")
        .select(["subject_external_id"])
        .where("asset_params_id", "=", base.id)
        .executeTakeFirst();
      break;
    case "segment_mutuals":
      row = await db
        .selectFrom("segment_mutuals_params")
        .select(["subject_external_id"])
        .where("asset_params_id", "=", base.id)
        .executeTakeFirst();
      break;
    case "segment_unreciprocated_followed":
      row = await db
        .selectFrom("segment_unreciprocated_followed_params")
        .select(["subject_external_id"])
        .where("asset_params_id", "=", base.id)
        .executeTakeFirst();
      break;
    default:
      throw new Error(`Unexpected asset slug for subject params: ${base.assetSlug}`);
  }

  if (!row) {
    throw new Error(`Missing subject params for asset_params_id=${base.id.toString()}`);
  }

  return {
    ...base,
    assetSlug: base.assetSlug,
    subjectExternalId: row.subject_external_id,
  };
}

async function fetchPostCorpusParams(
  db: DbOrTx,
  base: BaseAssetParamsRecord,
): Promise<AssetParamsRecord> {
  const row = await db
    .selectFrom("post_corpus_for_segment_params")
    .select(["source_segment_params_id"])
    .where("asset_params_id", "=", base.id)
    .executeTakeFirst();

  if (!row) {
    throw new Error(`Missing post_corpus_for_segment_params for asset_params_id=${base.id.toString()}`);
  }

  return {
    ...base,
    assetSlug: "post_corpus_for_segment",
    sourceSegmentParamsId: row.source_segment_params_id,
  };
}

export async function getAssetParamsById(
  db: DbOrTx,
  assetParamsId: bigint,
): Promise<AssetParamsRecord | null> {
  const base = await fetchBaseAssetParamsById(db, assetParamsId);
  if (!base) return null;

  switch (base.assetSlug) {
    case "segment_specified_users":
      return fetchSegmentSpecifiedUsersParams(db, base);
    case "segment_followers":
    case "segment_followed":
    case "segment_mutuals":
    case "segment_unreciprocated_followed":
      return fetchSubjectSegmentParams(db, base);
    case "post_corpus_for_segment":
      return fetchPostCorpusParams(db, base);
    default:
      throw new Error(`Unknown asset slug '${base.assetSlug}' for asset_params_id=${base.id.toString()}`);
  }
}

export async function getAssetParamsBySlugHash(
  db: DbOrTx,
  params: { assetSlug: AssetSlug; paramsHash: string; paramsHashVersion: number },
): Promise<AssetParamsRecord | null> {
  const base = await fetchBaseAssetParamsBySlugHash(db, params);
  if (!base) return null;
  return getAssetParamsById(db, base.id);
}

export async function getAssetParamsByInstanceId(
  db: DbOrTx,
  instanceId: bigint,
): Promise<AssetParamsRecord | null> {
  const row = await db
    .selectFrom("asset_instances")
    .select(["params_id"])
    .where("id", "=", instanceId)
    .executeTakeFirst();

  if (!row) return null;
  return getAssetParamsById(db, row.params_id);
}

export async function getOrCreateAssetParams(
  db: DbOrTx,
  input: AssetParamsInput,
): Promise<AssetParamsRecord> {
  return withTransaction(db, async (trx) => {
    const fanoutSourceParamsHash = normalizeFanoutSourceParamsHash(input.fanoutSourceParamsHash);
    const fanoutSourceParamsHashVersion = normalizeFanoutSourceParamsHashVersion(
      input.fanoutSourceParamsHashVersion,
      fanoutSourceParamsHash,
    );

    const baseRecord =
      (await trx
        .insertInto("asset_params")
        .values({
          asset_slug: input.assetSlug,
          params_hash_version: input.paramsHashVersion,
          params_hash: input.paramsHash,
          fanout_source_params_hash: fanoutSourceParamsHash,
          fanout_source_params_hash_version: fanoutSourceParamsHashVersion,
        })
        .onConflict((oc) =>
          oc.columns(["asset_slug", "params_hash_version", "params_hash"]).doNothing(),
        )
        .returning([
          "id",
          "asset_slug",
          "params_hash_version",
          "params_hash",
          "fanout_source_params_hash",
          "fanout_source_params_hash_version",
        ])
        .executeTakeFirst()) ??
      (await trx
        .selectFrom("asset_params")
        .select([
          "id",
          "asset_slug",
          "params_hash_version",
          "params_hash",
          "fanout_source_params_hash",
          "fanout_source_params_hash_version",
        ])
        .where("asset_slug", "=", input.assetSlug)
        .where("params_hash_version", "=", input.paramsHashVersion)
        .where("params_hash", "=", input.paramsHash)
        .executeTakeFirstOrThrow());

    const base: BaseAssetParamsRecord = {
      id: baseRecord.id,
      assetSlug: baseRecord.asset_slug,
      paramsHashVersion: baseRecord.params_hash_version,
      paramsHash: baseRecord.params_hash,
      fanoutSourceParamsHash: baseRecord.fanout_source_params_hash,
      fanoutSourceParamsHashVersion: baseRecord.fanout_source_params_hash_version,
    };

    switch (input.assetSlug) {
      case "segment_specified_users":
        await trx
          .insertInto("segment_specified_users_params")
          .values({
            asset_params_id: base.id,
            stable_key: input.stableKey,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      case "segment_followers":
        await trx
          .insertInto("segment_followers_params")
          .values({
            asset_params_id: base.id,
            subject_external_id: input.subjectExternalId,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      case "segment_followed":
        await trx
          .insertInto("segment_followed_params")
          .values({
            asset_params_id: base.id,
            subject_external_id: input.subjectExternalId,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      case "segment_mutuals":
        await trx
          .insertInto("segment_mutuals_params")
          .values({
            asset_params_id: base.id,
            subject_external_id: input.subjectExternalId,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      case "segment_unreciprocated_followed":
        await trx
          .insertInto("segment_unreciprocated_followed_params")
          .values({
            asset_params_id: base.id,
            subject_external_id: input.subjectExternalId,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      case "post_corpus_for_segment":
        await trx
          .insertInto("post_corpus_for_segment_params")
          .values({
            asset_params_id: base.id,
            source_segment_params_id: input.sourceSegmentParamsId,
          })
          .onConflict((oc) => oc.column("asset_params_id").doNothing())
          .execute();
        break;
      default:
        throw new Error("Unknown asset slug");
    }

    const record = await getAssetParamsById(trx, base.id);
    if (!record) {
      throw new Error(`Failed to resolve asset params after insert: ${base.id.toString()}`);
    }
    return record;
  });
}
