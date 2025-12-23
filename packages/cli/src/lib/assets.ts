import type { Db } from "@bdx/db";
import {
  getAssetInstanceBySlugHash,
  getOrCreateAssetInstance,
  getOrCreateAssetParams,
} from "@bdx/db";
import type { AssetInstanceRecord, AssetSlug } from "@bdx/db";
import {
  PARAMS_HASH_VERSION,
  formatAssetParams,
  listAssetDefinitions,
  parseAssetParams,
  paramsHashV1,
  type AssetParams,
} from "@bdx/engine";
import type { AssetParamsId } from "@bdx/ids";
import { parseJson } from "./parsers.js";

const assetSlugSet = new Set<AssetSlug>(
  listAssetDefinitions().map((definition) => definition.slug),
);

export function resolveAssetSlug(value: string): AssetSlug {
  if (!assetSlugSet.has(value as AssetSlug)) {
    const available = Array.from(assetSlugSet).join(", ");
    throw new Error(`Unknown asset slug '${value}'. Available: ${available}`);
  }
  return value as AssetSlug;
}

export function parseAssetParamsInput(slug: AssetSlug, rawJson: string): AssetParams {
  const parsed = parseJson(rawJson, "params");
  try {
    return parseAssetParams(slug, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid asset params";
    throw new Error(message);
  }
}

export function formatAssetParamsForLog(params: AssetParams): string {
  return formatAssetParams(params);
}

type AssetParamsResolution = {
  paramsId: AssetParamsId;
  paramsHash: string;
  paramsHashVersion: number;
};

async function ensureAssetParamsRecord(
  db: Db,
  params: AssetParams,
): Promise<AssetParamsResolution> {
  const paramsHash = paramsHashV1(params);
  const paramsHashVersion = PARAMS_HASH_VERSION;

  switch (params.assetSlug) {
    case "segment_specified_users": {
      const record = await getOrCreateAssetParams(db, {
        assetSlug: "segment_specified_users",
        paramsHash,
        paramsHashVersion,
        stableKey: params.stableKey,
        fanoutSourceParamsHash: params.fanoutSourceParamsHash,
        fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? paramsHashVersion : null,
      });
      return { paramsId: record.id, paramsHash, paramsHashVersion };
    }
    case "segment_followers":
    case "segment_followed":
    case "segment_mutuals":
    case "segment_unreciprocated_followed": {
      const record = await getOrCreateAssetParams(db, {
        assetSlug: params.assetSlug,
        paramsHash,
        paramsHashVersion,
        subjectExternalId: params.subjectExternalId,
        fanoutSourceParamsHash: params.fanoutSourceParamsHash,
        fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? paramsHashVersion : null,
      });
      return { paramsId: record.id, paramsHash, paramsHashVersion };
    }
    case "post_corpus_for_segment": {
      const source = await ensureAssetParamsRecord(db, params.sourceSegmentParams);
      const record = await getOrCreateAssetParams(db, {
        assetSlug: "post_corpus_for_segment",
        paramsHash,
        paramsHashVersion,
        sourceSegmentParamsId: source.paramsId,
        fanoutSourceParamsHash: params.fanoutSourceParamsHash,
        fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? paramsHashVersion : null,
      });
      return { paramsId: record.id, paramsHash, paramsHashVersion };
    }
    default:
      throw new Error(`Unsupported asset params: ${formatAssetParams(params)}`);
  }
}

export async function ensureAssetInstance(
  db: Db,
  params: AssetParams,
): Promise<AssetInstanceRecord> {
  const resolved = await ensureAssetParamsRecord(db, params);
  return getOrCreateAssetInstance(db, {
    paramsId: resolved.paramsId,
    assetSlug: params.assetSlug,
    paramsHash: resolved.paramsHash,
    paramsHashVersion: resolved.paramsHashVersion,
  });
}

export async function getAssetInstanceForParams(
  db: Db,
  params: AssetParams,
): Promise<AssetInstanceRecord | null> {
  const paramsHash = paramsHashV1(params);
  return getAssetInstanceBySlugHash(db, {
    assetSlug: params.assetSlug,
    paramsHash,
    paramsHashVersion: PARAMS_HASH_VERSION,
  });
}
