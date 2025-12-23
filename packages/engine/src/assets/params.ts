import type { AssetSlug } from "@bdx/db";
import { z } from "zod";
import { HASH_VERSION_V1, hashPartsV1 } from "../hashing.js";

export type SpecifiedUsersSegmentParams = {
  assetSlug: "segment_specified_users";
  stableKey: string;
  fanoutSourceParamsHash: string | null;
};

export type SubjectSegmentParams = {
  assetSlug:
    | "segment_followers"
    | "segment_followed"
    | "segment_mutuals"
    | "segment_unreciprocated_followed";
  subjectExternalId: bigint;
  fanoutSourceParamsHash: string | null;
};

export type SegmentParams = SpecifiedUsersSegmentParams | SubjectSegmentParams;

export type PostCorpusForSegmentParams = {
  assetSlug: "post_corpus_for_segment";
  sourceSegmentParams: SegmentParams;
  fanoutSourceParamsHash: string | null;
};

export type AssetParams = SegmentParams | PostCorpusForSegmentParams;

export const PARAMS_HASH_VERSION = HASH_VERSION_V1;

const bigintSchema = z.union([z.string(), z.number().int(), z.bigint()]).transform((value) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Expected bigint string");
  }
  return BigInt(trimmed);
});

const fanoutSchema = z.object({
  fanoutSourceParamsHash: z.string().min(1).optional().nullable(),
});

const specifiedUsersInputSchema = z
  .object({
    assetSlug: z.literal("segment_specified_users"),
    stableKey: z.string().min(1),
  })
  .merge(fanoutSchema);

const subjectSegmentInputSchema = z
  .object({
    assetSlug: z.enum([
      "segment_followers",
      "segment_followed",
      "segment_mutuals",
      "segment_unreciprocated_followed",
    ]),
    subjectExternalId: bigintSchema,
  })
  .merge(fanoutSchema);

const segmentParamsSchema = z
  .discriminatedUnion("assetSlug", [specifiedUsersInputSchema, subjectSegmentInputSchema])
  .transform(
    (value): SegmentParams => ({
      ...value,
      fanoutSourceParamsHash: value.fanoutSourceParamsHash ?? null,
    }),
  );

const postCorpusInputSchema = z
  .object({
    assetSlug: z.literal("post_corpus_for_segment"),
    sourceSegment: segmentParamsSchema,
  })
  .merge(fanoutSchema);

const assetParamsSchema = z
  .discriminatedUnion("assetSlug", [
    specifiedUsersInputSchema,
    subjectSegmentInputSchema,
    postCorpusInputSchema,
  ])
  .transform((value): AssetParams => {
    switch (value.assetSlug) {
      case "segment_specified_users":
        return {
          assetSlug: "segment_specified_users",
          stableKey: value.stableKey,
          fanoutSourceParamsHash: value.fanoutSourceParamsHash ?? null,
        };
      case "segment_followers":
      case "segment_followed":
      case "segment_mutuals":
      case "segment_unreciprocated_followed":
        return {
          assetSlug: value.assetSlug,
          subjectExternalId: value.subjectExternalId,
          fanoutSourceParamsHash: value.fanoutSourceParamsHash ?? null,
        };
      case "post_corpus_for_segment":
        return {
          assetSlug: "post_corpus_for_segment",
          sourceSegmentParams: value.sourceSegment,
          fanoutSourceParamsHash: value.fanoutSourceParamsHash ?? null,
        };
    }
  });

export function parseAssetParams(slug: AssetSlug, input: unknown): AssetParams {
  const base = typeof input === "object" && input !== null ? input : null;
  const result = assetParamsSchema.safeParse({ assetSlug: slug, ...(base ?? {}) });
  if (!result.success) {
    throw new Error(`Invalid params for asset ${slug}: ${result.error.message}`);
  }
  return result.data;
}

function appendFanoutPart(parts: string[], fanoutSourceParamsHash: string | null) {
  if (fanoutSourceParamsHash) {
    parts.push(`fanout_source_params_hash=${fanoutSourceParamsHash}`);
  }
}

export function paramsHashV1(params: AssetParams): string {
  const parts: string[] = ["kind=params_hash:v1", `asset_slug=${params.assetSlug}`];

  switch (params.assetSlug) {
    case "segment_specified_users":
      parts.push(`stable_key=${params.stableKey}`);
      appendFanoutPart(parts, params.fanoutSourceParamsHash);
      break;
    case "segment_followers":
    case "segment_followed":
    case "segment_mutuals":
    case "segment_unreciprocated_followed":
      parts.push(`subject_external_id=${params.subjectExternalId.toString()}`);
      appendFanoutPart(parts, params.fanoutSourceParamsHash);
      break;
    case "post_corpus_for_segment": {
      const sourceHash = paramsHashV1(params.sourceSegmentParams);
      parts.push(`source_segment.asset_slug=${params.sourceSegmentParams.assetSlug}`);
      parts.push(`source_segment.params_hash=${sourceHash}`);
      appendFanoutPart(parts, params.fanoutSourceParamsHash);
      break;
    }
    default:
      throw new Error("Unsupported asset slug for params hash");
  }

  return hashPartsV1(parts).hash;
}

export function formatAssetParams(params: AssetParams): string {
  const parts: string[] = [];
  switch (params.assetSlug) {
    case "segment_specified_users":
      parts.push(`stableKey=${params.stableKey}`);
      break;
    case "segment_followers":
    case "segment_followed":
    case "segment_mutuals":
    case "segment_unreciprocated_followed":
      parts.push(`subjectExternalId=${params.subjectExternalId.toString()}`);
      break;
    case "post_corpus_for_segment":
      parts.push(
        `sourceSegment=${params.sourceSegmentParams.assetSlug}(${formatAssetParams(
          params.sourceSegmentParams,
        )})`,
      );
      break;
    default:
      break;
  }
  if (params.fanoutSourceParamsHash) {
    parts.push(`fanoutSource=${params.fanoutSourceParamsHash.slice(0, 8)}`);
  }
  return parts.join(", ");
}

export function asSegmentParams(params: AssetParams): SegmentParams {
  if (params.assetSlug === "post_corpus_for_segment") {
    return params.sourceSegmentParams;
  }
  return params;
}
