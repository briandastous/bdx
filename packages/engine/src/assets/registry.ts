import type { DbOrTx } from "@bdx/db";
import {
  getActiveFollowerIds,
  getActiveFollowedIds,
  getActivePostIdsByAuthors,
  getSegmentMembershipAsOf,
  listSpecifiedUsersInputs,
} from "@bdx/db";
import type { AssetSlug } from "@bdx/db";
import type { AssetParams, SegmentParams, SubjectSegmentParams } from "./params.js";
import { paramsHashV1 } from "./params.js";
import type { AssetItemKind, DependencySpec, IngestRequirement, ResolvedDependency } from "./types.js";

export interface AssetValidationIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface AssetDefinition {
  slug: AssetSlug;
  outputItemKind: AssetItemKind;
  subjectItemKind?: AssetItemKind;
  dependencies(params: AssetParams): DependencySpec[];
  ingestRequirements(
    params: AssetParams,
    deps: ResolvedDependency[],
    context: { db: DbOrTx },
  ): Promise<IngestRequirement[]>;
  inputsHashParts(params: AssetParams, context: { db: DbOrTx; instanceId: bigint }): Promise<string[]>;
  computeMembership(
    params: AssetParams,
    deps: ResolvedDependency[],
    context: { db: DbOrTx; instanceId: bigint },
  ): Promise<bigint[]>;
  validateInputs?(
    params: AssetParams,
    context: { db: DbOrTx; instanceId: bigint },
  ): Promise<AssetValidationIssue[]>;
  paramsHash(params: AssetParams): string;
  paramsFromFanoutItem?(
    itemKind: AssetItemKind,
    itemExternalId: bigint,
    fanoutSourceParamsHash: string | null,
  ): AssetParams;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function expectSegmentParams(params: AssetParams, slug: SegmentParams["assetSlug"]): SegmentParams {
  if (params.assetSlug !== slug) {
    throw new Error(`Expected segment params for ${slug}, received ${params.assetSlug}`);
  }
  return params;
}

function subjectParamsFromItem(
  slug: SubjectSegmentParams["assetSlug"],
  itemKind: AssetItemKind,
  itemExternalId: bigint,
  fanoutSourceParamsHash: string | null,
): AssetParams {
  if (itemKind !== "user") {
    throw new Error(`Fanout for ${slug} expects user items`);
  }
  const params: SubjectSegmentParams = {
    assetSlug: slug,
    subjectExternalId: itemExternalId,
    fanoutSourceParamsHash,
  };
  return params;
}

const specifiedUsers: AssetDefinition = {
  slug: "segment_specified_users",
  outputItemKind: "user",
  dependencies: () => [],
  ingestRequirements: async () => [],
  inputsHashParts: async (_params, context) => {
    const ids = await listSpecifiedUsersInputs(context.db, context.instanceId);
    return ids.map((id) => `user_external_id=${id.toString()}`);
  },
  computeMembership: async (_params, _deps, context) => {
    const ids = await listSpecifiedUsersInputs(context.db, context.instanceId);
    return ids;
  },
  validateInputs: async (_params, context) => {
    const ids = await listSpecifiedUsersInputs(context.db, context.instanceId);
    if (ids.length === 0) {
      return [
        {
          code: "empty_input_set",
          severity: "warning",
          message: "Specified users segment has an empty user set.",
        },
      ];
    }
    return [];
  },
  paramsHash: paramsHashV1,
};

const followers: AssetDefinition = {
  slug: "segment_followers",
  outputItemKind: "user",
  subjectItemKind: "user",
  dependencies: () => [],
  ingestRequirements: async (params) => {
    const typed = expectSegmentParams(params, "segment_followers");
    if (typed.assetSlug !== "segment_followers") {
      throw new Error("Unexpected params for followers segment");
    }
    return [
      {
        ingestKind: "twitterio_api_user_followers",
        targetUserId: typed.subjectExternalId,
        freshnessMs: SIX_HOURS_MS,
      },
    ];
  },
  inputsHashParts: async () => [],
  computeMembership: async (params, _deps, context) => {
    const typed = expectSegmentParams(params, "segment_followers");
    if (typed.assetSlug !== "segment_followers") {
      throw new Error("Unexpected params for followers segment");
    }
    const followersSet = await getActiveFollowerIds(context.db, {
      targetUserId: typed.subjectExternalId,
    });
    return Array.from(followersSet).sort((a, b) => (a < b ? -1 : 1));
  },
  paramsHash: paramsHashV1,
  paramsFromFanoutItem: (itemKind, itemExternalId, fanoutSourceParamsHash) =>
    subjectParamsFromItem("segment_followers", itemKind, itemExternalId, fanoutSourceParamsHash),
};

const followed: AssetDefinition = {
  slug: "segment_followed",
  outputItemKind: "user",
  subjectItemKind: "user",
  dependencies: () => [],
  ingestRequirements: async (params) => {
    const typed = expectSegmentParams(params, "segment_followed");
    if (typed.assetSlug !== "segment_followed") {
      throw new Error("Unexpected params for followed segment");
    }
    return [
      {
        ingestKind: "twitterio_api_user_followings",
        targetUserId: typed.subjectExternalId,
        freshnessMs: SIX_HOURS_MS,
      },
    ];
  },
  inputsHashParts: async () => [],
  computeMembership: async (params, _deps, context) => {
    const typed = expectSegmentParams(params, "segment_followed");
    if (typed.assetSlug !== "segment_followed") {
      throw new Error("Unexpected params for followed segment");
    }
    const followedSet = await getActiveFollowedIds(context.db, {
      followerUserId: typed.subjectExternalId,
    });
    return Array.from(followedSet).sort((a, b) => (a < b ? -1 : 1));
  },
  paramsHash: paramsHashV1,
  paramsFromFanoutItem: (itemKind, itemExternalId, fanoutSourceParamsHash) =>
    subjectParamsFromItem("segment_followed", itemKind, itemExternalId, fanoutSourceParamsHash),
};

const mutuals: AssetDefinition = {
  slug: "segment_mutuals",
  outputItemKind: "user",
  subjectItemKind: "user",
  dependencies: (params) => {
    const typed = expectSegmentParams(params, "segment_mutuals");
    if (typed.assetSlug !== "segment_mutuals") {
      throw new Error("Unexpected params for mutuals segment");
    }
    return [
      {
        name: "followers",
        assetSlug: "segment_followers",
        params: {
          assetSlug: "segment_followers",
          subjectExternalId: typed.subjectExternalId,
          fanoutSourceParamsHash: null,
        },
      },
      {
        name: "followed",
        assetSlug: "segment_followed",
        params: {
          assetSlug: "segment_followed",
          subjectExternalId: typed.subjectExternalId,
          fanoutSourceParamsHash: null,
        },
      },
    ];
  },
  ingestRequirements: async () => [],
  inputsHashParts: async () => [],
  computeMembership: async (_params, deps, context) => {
    const followersDep = deps.find((dep) => dep.name === "followers");
    const followedDep = deps.find((dep) => dep.name === "followed");
    if (!followersDep || !followedDep) {
      throw new Error("Mutuals dependencies missing");
    }

    const followersMembership = await getSegmentMembershipAsOf(context.db, {
      instanceId: followersDep.instanceId,
      targetMaterializationId: followersDep.materializationId,
    });
    const followedMembership = await getSegmentMembershipAsOf(context.db, {
      instanceId: followedDep.instanceId,
      targetMaterializationId: followedDep.materializationId,
    });

    const followedSet = new Set(followedMembership);
    const mutuals = followersMembership.filter((userId) => followedSet.has(userId));
    return mutuals.sort((a, b) => (a < b ? -1 : 1));
  },
  paramsHash: paramsHashV1,
  paramsFromFanoutItem: (itemKind, itemExternalId, fanoutSourceParamsHash) =>
    subjectParamsFromItem("segment_mutuals", itemKind, itemExternalId, fanoutSourceParamsHash),
};

const unreciprocated: AssetDefinition = {
  slug: "segment_unreciprocated_followed",
  outputItemKind: "user",
  subjectItemKind: "user",
  dependencies: (params) => {
    const typed = expectSegmentParams(params, "segment_unreciprocated_followed");
    if (typed.assetSlug !== "segment_unreciprocated_followed") {
      throw new Error("Unexpected params for unreciprocated segment");
    }
    return [
      {
        name: "followed",
        assetSlug: "segment_followed",
        params: {
          assetSlug: "segment_followed",
          subjectExternalId: typed.subjectExternalId,
          fanoutSourceParamsHash: null,
        },
      },
      {
        name: "followers",
        assetSlug: "segment_followers",
        params: {
          assetSlug: "segment_followers",
          subjectExternalId: typed.subjectExternalId,
          fanoutSourceParamsHash: null,
        },
      },
    ];
  },
  ingestRequirements: async () => [],
  inputsHashParts: async () => [],
  computeMembership: async (_params, deps, context) => {
    const followedDep = deps.find((dep) => dep.name === "followed");
    const followersDep = deps.find((dep) => dep.name === "followers");
    if (!followedDep || !followersDep) {
      throw new Error("Unreciprocated dependencies missing");
    }

    const followedMembership = await getSegmentMembershipAsOf(context.db, {
      instanceId: followedDep.instanceId,
      targetMaterializationId: followedDep.materializationId,
    });
    const followersMembership = await getSegmentMembershipAsOf(context.db, {
      instanceId: followersDep.instanceId,
      targetMaterializationId: followersDep.materializationId,
    });

    const followersSet = new Set(followersMembership);
    const unreciprocated = followedMembership.filter((userId) => !followersSet.has(userId));
    return unreciprocated.sort((a, b) => (a < b ? -1 : 1));
  },
  paramsHash: paramsHashV1,
  paramsFromFanoutItem: (itemKind, itemExternalId, fanoutSourceParamsHash) =>
    subjectParamsFromItem(
      "segment_unreciprocated_followed",
      itemKind,
      itemExternalId,
      fanoutSourceParamsHash,
    ),
};

const postCorpus: AssetDefinition = {
  slug: "post_corpus_for_segment",
  outputItemKind: "post",
  dependencies: (params) => {
    if (params.assetSlug !== "post_corpus_for_segment") {
      throw new Error("Unexpected params for post corpus");
    }
    return [
      {
        name: "source_segment",
        assetSlug: params.sourceSegmentParams.assetSlug,
        params: params.sourceSegmentParams,
      },
    ];
  },
  ingestRequirements: async (_params, deps, context) => {
    const source = deps.find((dep) => dep.name === "source_segment");
    if (!source) {
      throw new Error("Post corpus dependency missing");
    }

    const members = await getSegmentMembershipAsOf(context.db, {
      instanceId: source.instanceId,
      targetMaterializationId: source.materializationId,
    });

    return members.map((userId) => ({
      ingestKind: "twitterio_api_users_posts",
      targetUserId: userId,
      freshnessMs: SIX_HOURS_MS,
      requestedByMaterializationIds: [source.materializationId],
    }));
  },
  inputsHashParts: async () => [],
  computeMembership: async (_params, deps, context) => {
    const source = deps.find((dep) => dep.name === "source_segment");
    if (!source) {
      throw new Error("Post corpus dependency missing");
    }

    const members = await getSegmentMembershipAsOf(context.db, {
      instanceId: source.instanceId,
      targetMaterializationId: source.materializationId,
    });
    const posts = await getActivePostIdsByAuthors(context.db, { authorIds: members });
    return Array.from(posts).sort((a, b) => (a < b ? -1 : 1));
  },
  paramsHash: paramsHashV1,
};

const registry: Record<AssetSlug, AssetDefinition> = {
  segment_specified_users: specifiedUsers,
  segment_followers: followers,
  segment_followed: followed,
  segment_mutuals: mutuals,
  segment_unreciprocated_followed: unreciprocated,
  post_corpus_for_segment: postCorpus,
};

export function getAssetDefinition(slug: AssetSlug): AssetDefinition {
  const definition = registry[slug];
  if (!definition) {
    throw new Error(`Unknown asset slug: ${slug}`);
  }
  return definition;
}

export function listAssetDefinitions(): AssetDefinition[] {
  return Object.values(registry);
}
