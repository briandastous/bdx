import { randomUUID } from "node:crypto";
import type { Db, DbOrTx } from "@bdx/db";
import {
  acquireAdvisoryLock,
  createAssetMaterialization,
  getAssetInstanceById,
  getAssetParamsById,
  getAssetParamsByInstanceId,
  getLatestFollowersSyncRun,
  getLatestFollowingsSyncRun,
  getLatestPostsSyncRun,
  getLatestSuccessfulMaterialization,
  getOrCreateAssetInstance,
  getOrCreateAssetParams,
  insertMaterializationDependencies,
  insertMaterializationRequests,
  insertPostCorpusEvents,
  insertSegmentEvents,
  listEnabledAssetInstanceFanoutRoots,
  listEnabledAssetInstanceRoots,
  listPostCorpusEnteredPostIds,
  listPostCorpusMembershipSnapshot,
  listSegmentEnteredUserIds,
  listSegmentMembershipSnapshot,
  linkPostsSyncRunToMaterializations,
  rebuildPostCorpusMembershipSnapshot,
  rebuildSegmentMembershipSnapshot,
  recordPlannerEvent,
  replacePostCorpusMembershipSnapshot,
  replaceSegmentMembershipSnapshot,
  releaseAdvisoryLock,
  updateAssetMaterialization,
  withTransaction,
} from "@bdx/db";
import type { AssetInstanceRecord, AssetParamsRecord, AssetSlug } from "@bdx/db";
import type { Logger } from "@bdx/observability";
import {
  FollowersSyncService,
  FollowingsSyncService,
  GraphSyncError,
  GraphSyncRateLimitError,
  PostsSyncError,
  PostsSyncRateLimitError,
  PostsSyncService,
} from "@bdx/ingest";
import { TwitterApiClient } from "@bdx/twitterapi-io";
import type { AssetParams } from "./assets/params.js";
import { PARAMS_HASH_VERSION, formatAssetParams, paramsHashV1 } from "./assets/params.js";
import { getAssetDefinition } from "./assets/registry.js";
import type { AssetItemKind, IngestRequirement, ResolvedDependency } from "./assets/types.js";
import type { HashVersion } from "./hashing.js";
import { hashPartsV1 } from "./hashing.js";

type MaterializationOutcome = {
  instanceId: bigint;
  materializationId: bigint | null;
  outputRevision: bigint | null;
  status: "success" | "skipped" | "error";
  errorMessage?: string | null;
};

export interface AssetEngineParams {
  db: Db;
  logger: Logger;
  twitterClient: TwitterApiClient;
  postsMaxQueryLength: number;
  lockTimeoutMs?: number;
  httpSnapshotMaxBytes?: number;
}

export class AssetEngine {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly followersService: FollowersSyncService;
  private readonly followingsService: FollowingsSyncService;
  private readonly postsService: PostsSyncService;
  private readonly lockTimeoutMs: number;

  constructor(params: AssetEngineParams) {
    this.db = params.db;
    this.logger = params.logger;
    this.lockTimeoutMs = params.lockTimeoutMs ?? 10_000;
    const httpSnapshotParam =
      params.httpSnapshotMaxBytes !== undefined
        ? { httpSnapshotMaxBytes: params.httpSnapshotMaxBytes }
        : {};
    this.followersService = new FollowersSyncService({
      db: params.db,
      logger: params.logger,
      client: params.twitterClient,
      ...httpSnapshotParam,
    });
    this.followingsService = new FollowingsSyncService({
      db: params.db,
      logger: params.logger,
      client: params.twitterClient,
      ...httpSnapshotParam,
    });
    this.postsService = new PostsSyncService({
      db: params.db,
      logger: params.logger,
      client: params.twitterClient,
      maxQueryLength: params.postsMaxQueryLength,
      ...httpSnapshotParam,
    });
  }

  async materializeInstanceById(
    instanceId: bigint,
    options?: { triggerReason?: string },
  ): Promise<MaterializationOutcome> {
    const plannerRunId = randomUUID();
    const memo = new Map<bigint, Promise<MaterializationOutcome>>();
    return this.materializeInstance(instanceId, {
      memo,
      plannerRunId,
      triggerReason: options?.triggerReason ?? "manual",
      requestedByMaterializationIds: [],
    });
  }

  async materializeParams(
    params: AssetParams,
    options?: { triggerReason?: string },
  ): Promise<MaterializationOutcome> {
    const plannerRunId = randomUUID();
    const memo = new Map<bigint, Promise<MaterializationOutcome>>();
    return this.ensureAssetInstanceAndMaterialize(params, {
      memo,
      plannerRunId,
      triggerReason: options?.triggerReason ?? "manual",
      requestedByMaterializationIds: [],
    });
  }

  async tick(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    const plannerRunId = randomUUID();
    const memo = new Map<bigint, Promise<MaterializationOutcome>>();
    const tickLogger = this.logger.child({ planner_run_id: plannerRunId });

    tickLogger.info("asset engine tick started");

    const roots = await listEnabledAssetInstanceRoots(this.db);
    for (const root of roots) {
      if (signal.aborted) break;
      await this.materializeInstance(root.instanceId, {
        memo,
        plannerRunId,
        triggerReason: "root",
        requestedByMaterializationIds: [],
      });
    }

    const fanoutRoots = await listEnabledAssetInstanceFanoutRoots(this.db);
    for (const root of fanoutRoots) {
      if (signal.aborted) break;
      await this.materializeFanoutRoot(root, { memo, plannerRunId, signal });
    }

    tickLogger.info("asset engine tick completed");
  }

  private async materializeFanoutRoot(
    root: {
      sourceInstanceId: bigint;
      targetAssetSlug: AssetSlug;
      fanoutMode: "global_per_item" | "scoped_by_source";
    },
    params: { memo: Map<bigint, Promise<MaterializationOutcome>>; plannerRunId: string; signal: AbortSignal },
  ): Promise<void> {
    const sourceOutcome = await this.materializeInstance(root.sourceInstanceId, {
      memo: params.memo,
      plannerRunId: params.plannerRunId,
      triggerReason: "fanout_source",
      requestedByMaterializationIds: [],
    });

    if (!sourceOutcome.materializationId) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: root.sourceInstanceId.toString(),
        targetParams: null,
        decision: "fanout_source_unavailable",
        reason: "Source instance did not materialize",
        plannerRunId: params.plannerRunId,
      });
      return;
    }

    const sourceInstance = await getAssetInstanceById(this.db, root.sourceInstanceId);
    if (!sourceInstance) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: root.sourceInstanceId.toString(),
        targetParams: null,
        decision: "fanout_source_missing",
        reason: "Source instance record missing",
        plannerRunId: params.plannerRunId,
      });
      return;
    }

    const sourceDefinition = getAssetDefinition(sourceInstance.assetSlug);
    const sourceMembers =
      sourceDefinition.outputItemKind === "user"
        ? await listSegmentMembershipSnapshot(this.db, root.sourceInstanceId)
        : await listPostCorpusMembershipSnapshot(this.db, root.sourceInstanceId);

    const targetDefinition = getAssetDefinition(root.targetAssetSlug);
    if (!targetDefinition.paramsFromFanoutItem) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: root.sourceInstanceId.toString(),
        targetParams: null,
        decision: "fanout_target_invalid",
        reason: `Target asset ${root.targetAssetSlug} cannot be fanout from items`,
        plannerRunId: params.plannerRunId,
      });
      return;
    }

    for (const memberId of sourceMembers) {
      if (params.signal.aborted) return;
      const fanoutSourceParamsHash =
        root.fanoutMode === "scoped_by_source" ? sourceInstance.paramsHash : null;
      const targetParams = targetDefinition.paramsFromFanoutItem(
        sourceDefinition.outputItemKind,
        memberId,
        fanoutSourceParamsHash,
      );
      const targetOutcome = await this.ensureAssetInstanceAndMaterialize(targetParams, {
        memo: params.memo,
        plannerRunId: params.plannerRunId,
        triggerReason: "fanout",
        requestedByMaterializationIds: [sourceOutcome.materializationId],
      });
      if (targetOutcome.status === "error") {
        await this.recordDecision({
          jobId: "asset_engine",
          targetId: root.sourceInstanceId.toString(),
          targetParams: formatAssetParams(targetParams),
          decision: "fanout_target_error",
          reason: "Failed to materialize fanout target",
          plannerRunId: params.plannerRunId,
        });
      }
    }
  }

  private async ensureAssetInstanceAndMaterialize(
    params: AssetParams,
    options: {
      memo: Map<bigint, Promise<MaterializationOutcome>>;
      plannerRunId: string;
      triggerReason: string;
      requestedByMaterializationIds: bigint[];
    },
  ): Promise<MaterializationOutcome> {
    const paramsHash = paramsHashV1(params);
    const paramsHashVersion = PARAMS_HASH_VERSION;
    const assetParamsId = await this.ensureAssetParams(params, paramsHash, paramsHashVersion);
    const instance = await getOrCreateAssetInstance(this.db, {
      paramsId: assetParamsId,
      assetSlug: params.assetSlug,
      paramsHash,
      paramsHashVersion,
    });

    return this.materializeInstance(instance.id, {
      memo: options.memo,
      plannerRunId: options.plannerRunId,
      triggerReason: options.triggerReason,
      requestedByMaterializationIds: options.requestedByMaterializationIds,
    });
  }

  private async ensureAssetParams(
    params: AssetParams,
    paramsHash: string,
    paramsHashVersion: number,
  ): Promise<bigint> {
    switch (params.assetSlug) {
      case "segment_specified_users": {
        const record = await getOrCreateAssetParams(this.db, {
          assetSlug: "segment_specified_users",
          paramsHash,
          paramsHashVersion,
          stableKey: params.stableKey,
          fanoutSourceParamsHash: params.fanoutSourceParamsHash,
          fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? PARAMS_HASH_VERSION : null,
        });
        return record.id;
      }
      case "segment_followers":
      case "segment_followed":
      case "segment_mutuals":
      case "segment_unreciprocated_followed": {
        const record = await getOrCreateAssetParams(this.db, {
          assetSlug: params.assetSlug,
          paramsHash,
          paramsHashVersion,
          subjectExternalId: params.subjectExternalId,
          fanoutSourceParamsHash: params.fanoutSourceParamsHash,
          fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? PARAMS_HASH_VERSION : null,
        });
        return record.id;
      }
      case "post_corpus_for_segment": {
        const sourceParamsHash = paramsHashV1(params.sourceSegmentParams);
        const sourceParamsHashVersion = PARAMS_HASH_VERSION;
        const sourceParamsId = await this.ensureAssetParams(
          params.sourceSegmentParams,
          sourceParamsHash,
          sourceParamsHashVersion,
        );
        const record = await getOrCreateAssetParams(this.db, {
          assetSlug: "post_corpus_for_segment",
          paramsHash,
          paramsHashVersion,
          sourceSegmentParamsId: sourceParamsId,
          fanoutSourceParamsHash: params.fanoutSourceParamsHash,
          fanoutSourceParamsHashVersion: params.fanoutSourceParamsHash ? PARAMS_HASH_VERSION : null,
        });
        return record.id;
      }
      default:
        throw new Error("Unsupported asset params");
    }
  }

  private async materializeInstance(
    instanceId: bigint,
    options: {
      memo: Map<bigint, Promise<MaterializationOutcome>>;
      plannerRunId: string;
      triggerReason: string | null;
      requestedByMaterializationIds: bigint[];
    },
  ): Promise<MaterializationOutcome> {
    const existing = options.memo.get(instanceId);
    if (existing) return existing;

    const promise = this.materializeInstanceInternal(instanceId, options);
    options.memo.set(instanceId, promise);
    return promise;
  }

  private async materializeInstanceInternal(
    instanceId: bigint,
    options: {
      memo: Map<bigint, Promise<MaterializationOutcome>>;
      plannerRunId: string;
      triggerReason: string | null;
      requestedByMaterializationIds: bigint[];
    },
  ): Promise<MaterializationOutcome> {
    const instance = await getAssetInstanceById(this.db, instanceId);
    if (!instance) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: instanceId.toString(),
        targetParams: null,
        decision: "instance_missing",
        reason: "Asset instance not found",
        plannerRunId: options.plannerRunId,
      });
      return { instanceId, materializationId: null, outputRevision: null, status: "error" };
    }

    const paramsRecord = await getAssetParamsByInstanceId(this.db, instanceId);
    if (!paramsRecord) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: instanceId.toString(),
        targetParams: null,
        decision: "params_missing",
        reason: "Asset params not found for instance",
        plannerRunId: options.plannerRunId,
      });
      return { instanceId, materializationId: null, outputRevision: null, status: "error" };
    }

    const params = await this.resolveParams(paramsRecord);
    const definition = getAssetDefinition(instance.assetSlug);

    if (definition.validateInputs) {
      const issues = await definition.validateInputs(params, { db: this.db, instanceId });
      const errors = issues.filter((issue) => issue.severity === "error");
      for (const issue of issues) {
        await this.recordDecision({
          jobId: "asset_engine",
          targetId: instanceId.toString(),
          targetParams: formatAssetParams(params),
          decision: `validation_${issue.severity}`,
          reason: issue.message,
          plannerRunId: options.plannerRunId,
        });
      }
      if (errors.length > 0) {
        return { instanceId, materializationId: null, outputRevision: null, status: "error" };
      }
    }

    const dependencies = await this.resolveDependencies(params, {
      memo: options.memo,
      plannerRunId: options.plannerRunId,
    });
    if (dependencies === null) {
      return { instanceId, materializationId: null, outputRevision: null, status: "error" };
    }

    const ingestReqs = await definition.ingestRequirements(params, dependencies, { db: this.db });
    const ingestOk = await this.ensureIngests(ingestReqs, {
      plannerRunId: options.plannerRunId,
      paramsLabel: formatAssetParams(params),
    });
    if (!ingestOk) {
      return { instanceId, materializationId: null, outputRevision: null, status: "error" };
    }

    const latestSuccess = await getLatestSuccessfulMaterialization(this.db, instanceId);
    const inputsHash = await this.computeInputsHash(definition, params, instanceId);
    const dependencyRevisionsHash = computeDependencyRevisionsHash(dependencies);

    if (
      latestSuccess &&
      latestSuccess.inputsHashVersion === inputsHash.version &&
      latestSuccess.dependencyRevisionsHashVersion === dependencyRevisionsHash.version &&
      latestSuccess.inputsHash === inputsHash.hash &&
      latestSuccess.dependencyRevisionsHash === dependencyRevisionsHash.hash
    ) {
      this.logger.info(
        {
          asset_instance_id: instanceId.toString(),
          asset_slug: instance.assetSlug,
          planner_run_id: options.plannerRunId,
        },
        "Materialization skipped (no input changes)",
      );
      return {
        instanceId,
        materializationId: latestSuccess.id,
        outputRevision: latestSuccess.outputRevision,
        status: "skipped",
      };
    }

    const lockKey = instanceId;
    const outcome = await withTransaction(this.db, async (trx): Promise<MaterializationOutcome | null> => {
      const acquired = await acquireAdvisoryLock(trx, lockKey, {
        timeoutMs: this.lockTimeoutMs,
      });
      if (!acquired) {
        return null;
      }

      let materializationId: bigint | null = null;
      try {
        this.logger.info(
          {
            asset_instance_id: instanceId.toString(),
            asset_slug: instance.assetSlug,
            planner_run_id: options.plannerRunId,
            trigger_reason: options.triggerReason,
          },
          "Materialization started",
        );
        const materialization = await createAssetMaterialization(trx, {
          assetInstanceId: instanceId,
          assetSlug: instance.assetSlug,
          inputsHash: inputsHash.hash,
          inputsHashVersion: inputsHash.version,
          dependencyRevisionsHash: dependencyRevisionsHash.hash,
          dependencyRevisionsHashVersion: dependencyRevisionsHash.version,
          triggerReason: options.triggerReason,
        });
        materializationId = materialization.id;

        if (dependencies.length > 0) {
          await insertMaterializationDependencies(
            trx,
            materialization.id,
            dependencies.map((dep) => dep.materializationId),
          );
        }
        if (options.requestedByMaterializationIds.length > 0) {
          await insertMaterializationRequests(
            trx,
            materialization.id,
            options.requestedByMaterializationIds,
          );
        }

        await this.ensureCheckpoint(trx, instance, definition.outputItemKind, options.plannerRunId);

        const membership = await definition.computeMembership(params, dependencies, {
          db: trx,
          instanceId,
        });
        const previousMembership =
          definition.outputItemKind === "user"
            ? await listSegmentMembershipSnapshot(trx, instanceId)
            : await listPostCorpusMembershipSnapshot(trx, instanceId);

        const previousSet = new Set(previousMembership);
        const currentSet = new Set(membership);

        const enterItems = membership.filter((id) => !previousSet.has(id));
        const exitItems = previousMembership.filter((id) => !currentSet.has(id));

        if (definition.outputItemKind === "user") {
          const seen = await listSegmentEnteredUserIds(trx, instanceId);
          await insertSegmentEvents(
            trx,
            materialization.id,
            [
              ...enterItems.map((userId) => ({
                userId,
                eventType: "enter" as const,
                isFirstAppearance: !seen.has(userId),
              })),
              ...exitItems.map((userId) => ({
                userId,
                eventType: "exit" as const,
                isFirstAppearance: null,
              })),
            ],
          );
        } else {
          const seen = await listPostCorpusEnteredPostIds(trx, instanceId);
          await insertPostCorpusEvents(
            trx,
            materialization.id,
            [
              ...enterItems.map((postId) => ({
                postId,
                eventType: "enter" as const,
                isFirstAppearance: !seen.has(postId),
              })),
              ...exitItems.map((postId) => ({
                postId,
                eventType: "exit" as const,
                isFirstAppearance: null,
              })),
            ],
          );
        }

        const previousRevision = latestSuccess?.outputRevision ?? 0n;
        const membershipChanged = enterItems.length > 0 || exitItems.length > 0;
        const outputRevision = membershipChanged ? previousRevision + 1n : previousRevision;

        if (definition.outputItemKind === "user") {
          await replaceSegmentMembershipSnapshot(trx, {
            instanceId,
            materializationId: materialization.id,
            userIds: membership,
          });
        } else {
          await replacePostCorpusMembershipSnapshot(trx, {
            instanceId,
            materializationId: materialization.id,
            postIds: membership,
          });
        }

        await updateAssetMaterialization(trx, materialization.id, {
          status: "success",
          completedAt: new Date(),
          outputRevision,
          errorPayload: null,
        });

        this.logger.info(
          {
            asset_instance_id: instanceId.toString(),
            asset_slug: instance.assetSlug,
            materialization_id: materialization.id.toString(),
            output_revision: outputRevision.toString(),
            member_count: membership.length,
            planner_run_id: options.plannerRunId,
          },
          "Materialization completed",
        );

        return {
          instanceId,
          materializationId: materialization.id,
          outputRevision,
          status: "success",
        } satisfies MaterializationOutcome;
      } catch (error) {
        if (materializationId) {
          await updateAssetMaterialization(trx, materializationId, {
            status: "error",
            completedAt: new Date(),
            outputRevision: 0n,
            errorPayload: serializeError(error),
          });
        }
        this.logger.error(
          {
            asset_instance_id: instanceId.toString(),
            asset_slug: instance.assetSlug,
            materialization_id: materializationId ? materializationId.toString() : null,
            planner_run_id: options.plannerRunId,
            error,
          },
          "Materialization failed",
        );
        return {
          instanceId,
          materializationId: null,
          outputRevision: null,
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        };
      } finally {
        await releaseAdvisoryLock(trx, instanceId);
      }
    });

    if (!outcome) {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: instanceId.toString(),
        targetParams: formatAssetParams(params),
        decision: "lock_timeout",
        reason: "Failed to acquire materialization lock",
        plannerRunId: options.plannerRunId,
      });
      return { instanceId, materializationId: null, outputRevision: null, status: "error" };
    }

    if (outcome.status === "error") {
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: instanceId.toString(),
        targetParams: formatAssetParams(params),
        decision: "materialization_error",
        reason: outcome.errorMessage ?? "Materialization failed",
        plannerRunId: options.plannerRunId,
      });
    }

    return outcome;
  }

  private async ensureCheckpoint(
    db: DbOrTx,
    instance: AssetInstanceRecord,
    itemKind: AssetItemKind,
    plannerRunId: string,
  ): Promise<void> {
    if (instance.currentMembershipMaterializationId !== null) return;

    const result =
      itemKind === "user"
        ? await rebuildSegmentMembershipSnapshot(db, instance.id)
        : await rebuildPostCorpusMembershipSnapshot(db, instance.id);

    await this.recordDecision({
      jobId: "asset_engine",
      targetId: instance.id.toString(),
      targetParams: null,
      decision: "checkpoint_repair",
      reason: `Checkpoint rebuilt at materialization ${result.materializationId ?? "none"}`,
      plannerRunId,
    });
  }

  private async resolveDependencies(
    params: AssetParams,
    options: { memo: Map<bigint, Promise<MaterializationOutcome>>; plannerRunId: string },
  ): Promise<ResolvedDependency[] | null> {
    const definition = getAssetDefinition(params.assetSlug);
    const specs = definition.dependencies(params);
    if (specs.length === 0) return [];

    const dependencies: ResolvedDependency[] = [];
    for (const spec of specs) {
      const paramsHash = paramsHashV1(spec.params);
      const paramsHashVersion = PARAMS_HASH_VERSION;
      const paramsId = await this.ensureAssetParams(spec.params, paramsHash, paramsHashVersion);
      const instance = await getOrCreateAssetInstance(this.db, {
        paramsId,
        assetSlug: spec.assetSlug,
        paramsHash,
        paramsHashVersion,
      });

      const outcome = await this.materializeInstance(instance.id, {
        memo: options.memo,
        plannerRunId: options.plannerRunId,
        triggerReason: "dependency",
        requestedByMaterializationIds: [],
      });
      if (!outcome.materializationId || outcome.outputRevision === null) {
        await this.recordDecision({
          jobId: "asset_engine",
          targetId: instance.id.toString(),
          targetParams: formatAssetParams(spec.params),
          decision: "dependency_failed",
          reason: "Dependency materialization failed",
          plannerRunId: options.plannerRunId,
        });
        return null;
      }

      dependencies.push({
        name: spec.name,
        assetSlug: spec.assetSlug,
        instanceId: instance.id,
        params: spec.params,
        paramsHash,
        paramsHashVersion,
        materializationId: outcome.materializationId,
        outputRevision: outcome.outputRevision,
      });
    }

    return dependencies;
  }

  private async ensureIngests(
    requirements: IngestRequirement[],
    params: { plannerRunId: string; paramsLabel: string },
  ): Promise<boolean> {
    if (requirements.length === 0) return true;

    const followers = new Set<bigint>();
    const followings = new Set<bigint>();
    const posts = new Set<bigint>();
    const postsRequestedBy = new Set<bigint>();
    const followersIncremental = new Set<bigint>();
    const followingsIncremental = new Set<bigint>();

    for (const requirement of requirements) {
      if (requirement.ingestKind === "twitterio_api_user_followers") {
        const mode = await this.selectFollowersSyncMode(requirement);
        if (mode === "full_refresh") followers.add(requirement.targetUserId);
        if (mode === "incremental") followersIncremental.add(requirement.targetUserId);
      } else if (requirement.ingestKind === "twitterio_api_user_followings") {
        const mode = await this.selectFollowingsSyncMode(requirement);
        if (mode === "full_refresh") followings.add(requirement.targetUserId);
        if (mode === "incremental") followingsIncremental.add(requirement.targetUserId);
      } else if (requirement.ingestKind === "twitterio_api_users_posts") {
        if (!(await this.isPostsFresh(requirement))) {
          posts.add(requirement.targetUserId);
          for (const requestedId of requirement.requestedByMaterializationIds ?? []) {
            postsRequestedBy.add(requestedId);
          }
        }
      }
    }

    try {
      for (const targetId of followers) {
        const ran = await this.withIngestLock(
          `ingest:followers:${targetId.toString()}`,
          { plannerRunId: params.plannerRunId, paramsLabel: params.paramsLabel, targetId },
          () => this.followersService.syncFollowersFull({ targetUserId: targetId }),
        );
        if (!ran) return false;
      }
      for (const targetId of followersIncremental) {
        const ran = await this.withIngestLock(
          `ingest:followers:${targetId.toString()}`,
          { plannerRunId: params.plannerRunId, paramsLabel: params.paramsLabel, targetId },
          () => this.followersService.syncFollowersIncremental({ targetUserId: targetId }),
        );
        if (!ran) return false;
      }
      for (const targetId of followings) {
        const ran = await this.withIngestLock(
          `ingest:followings:${targetId.toString()}`,
          { plannerRunId: params.plannerRunId, paramsLabel: params.paramsLabel, targetId },
          () => this.followingsService.syncFollowingsFull({ sourceUserId: targetId }),
        );
        if (!ran) return false;
      }
      for (const targetId of followingsIncremental) {
        const ran = await this.withIngestLock(
          `ingest:followings:${targetId.toString()}`,
          { plannerRunId: params.plannerRunId, paramsLabel: params.paramsLabel, targetId },
          () => this.followingsService.syncFollowingsIncremental({ sourceUserId: targetId }),
        );
        if (!ran) return false;
      }
      if (posts.size > 0) {
        const lockKey = `ingest:posts:${Array.from(posts).map((id) => id.toString()).sort().join(",")}`;
        const result = await this.withIngestLock(
          lockKey,
          { plannerRunId: params.plannerRunId, paramsLabel: params.paramsLabel, targetId: null },
          () => this.postsService.syncPostsFull({ userIds: posts }),
        );
        if (!result) return false;
        if (postsRequestedBy.size > 0) {
          await linkPostsSyncRunToMaterializations(this.db, result.syncRunId, Array.from(postsRequestedBy));
        }
      }
      return true;
    } catch (error) {
      const decision =
        error instanceof GraphSyncRateLimitError || error instanceof PostsSyncRateLimitError
          ? "ingest_rate_limited"
          : "ingest_failed";
      const reason = error instanceof Error ? error.message : "Unknown ingest error";
      await this.recordDecision({
        jobId: "asset_engine",
        targetId: null,
        targetParams: params.paramsLabel,
        decision,
        reason,
        plannerRunId: params.plannerRunId,
      });

      if (error instanceof GraphSyncError || error instanceof PostsSyncError) {
        this.logger.warn({ error }, "Ingest error");
        return false;
      }
      throw error;
    }
  }

  private async isFollowersFresh(requirement: IngestRequirement): Promise<boolean> {
    const latest = await getLatestFollowersSyncRun(this.db, {
      targetUserId: requirement.targetUserId,
      status: "success",
    });
    return this.isFresh(latest?.completedAt ?? null, requirement.freshnessMs);
  }

  private async selectFollowersSyncMode(
    requirement: IngestRequirement,
  ): Promise<"full_refresh" | "incremental" | null> {
    if (await this.isFollowersFresh(requirement)) return null;

    const latestFull = await getLatestFollowersSyncRun(this.db, {
      targetUserId: requirement.targetUserId,
      status: "success",
      syncMode: "full_refresh",
    });
    return latestFull ? "incremental" : "full_refresh";
  }

  private async isFollowingsFresh(requirement: IngestRequirement): Promise<boolean> {
    const latest = await getLatestFollowingsSyncRun(this.db, {
      sourceUserId: requirement.targetUserId,
      status: "success",
    });
    return this.isFresh(latest?.completedAt ?? null, requirement.freshnessMs);
  }

  private async selectFollowingsSyncMode(
    requirement: IngestRequirement,
  ): Promise<"full_refresh" | "incremental" | null> {
    if (await this.isFollowingsFresh(requirement)) return null;

    const latestFull = await getLatestFollowingsSyncRun(this.db, {
      sourceUserId: requirement.targetUserId,
      status: "success",
      syncMode: "full_refresh",
    });
    return latestFull ? "incremental" : "full_refresh";
  }

  private async isPostsFresh(requirement: IngestRequirement): Promise<boolean> {
    const latest = await getLatestPostsSyncRun(this.db, {
      targetUserId: requirement.targetUserId,
      status: "success",
    });
    return this.isFresh(latest?.completedAt ?? null, requirement.freshnessMs);
  }

  private isFresh(completedAt: Date | null, freshnessMs: number | null): boolean {
    if (!completedAt) return false;
    if (freshnessMs === null) return true;
    return Date.now() - completedAt.getTime() <= freshnessMs;
  }

  private async withIngestLock<T>(
    lockKey: string,
    params: { plannerRunId: string; paramsLabel: string; targetId: bigint | null },
    run: () => Promise<T>,
  ): Promise<T | null> {
    return this.db.connection().execute(async (conn) => {
      const acquired = await acquireAdvisoryLock(conn, lockKey, { timeoutMs: this.lockTimeoutMs });
      if (!acquired) {
        await this.recordDecision({
          jobId: "asset_engine",
          targetId: params.targetId ? params.targetId.toString() : null,
          targetParams: params.paramsLabel,
          decision: "ingest_lock_timeout",
          reason: "Failed to acquire ingest lock",
          plannerRunId: params.plannerRunId,
        });
        return null;
      }
      try {
        return await run();
      } finally {
        await releaseAdvisoryLock(conn, lockKey);
      }
    });
  }

  private async resolveParams(record: AssetParamsRecord): Promise<AssetParams> {
    switch (record.assetSlug) {
      case "segment_specified_users":
        return {
          assetSlug: "segment_specified_users",
          stableKey: record.stableKey,
          fanoutSourceParamsHash: record.fanoutSourceParamsHash,
        };
      case "segment_followers":
      case "segment_followed":
      case "segment_mutuals":
      case "segment_unreciprocated_followed":
        return {
          assetSlug: record.assetSlug,
          subjectExternalId: record.subjectExternalId,
          fanoutSourceParamsHash: record.fanoutSourceParamsHash,
        };
      case "post_corpus_for_segment": {
        const sourceRecord = await getAssetParamsById(this.db, record.sourceSegmentParamsId);
        if (!sourceRecord) {
          throw new Error(
            `Missing source segment params ${record.sourceSegmentParamsId.toString()} for post corpus`,
          );
        }
        const sourceParams = await this.resolveParams(sourceRecord);
        if (sourceParams.assetSlug === "post_corpus_for_segment") {
          throw new Error("Post corpus source params must be a segment");
        }
        return {
          assetSlug: "post_corpus_for_segment",
          sourceSegmentParams: sourceParams,
          fanoutSourceParamsHash: record.fanoutSourceParamsHash,
        };
      }
      default:
        throw new Error("Unknown asset slug");
    }
  }

  private async computeInputsHash(
    definition: ReturnType<typeof getAssetDefinition>,
    params: AssetParams,
    instanceId: bigint,
  ): Promise<{ hash: string; version: HashVersion }> {
    const parts: string[] = [
      "kind=inputs_hash:v1",
      `asset_slug=${params.assetSlug}`,
      `params_hash_version=${PARAMS_HASH_VERSION}`,
      `params_hash=${paramsHashV1(params)}`,
    ];
    const extras = await definition.inputsHashParts(params, { db: this.db, instanceId });
    parts.push(...extras);
    return hashPartsV1(parts);
  }

  private async recordDecision(input: {
    jobId: string;
    targetId: string | null;
    targetParams: string | null;
    decision: string;
    reason?: string | null;
    plannerRunId: string;
  }): Promise<void> {
    await recordPlannerEvent(this.db, {
      jobId: input.jobId,
      targetId: input.targetId,
      targetParams: input.targetParams,
      decision: input.decision,
      reason: input.reason ?? null,
      plannerRunId: input.plannerRunId,
    });
  }
}

function computeDependencyRevisionsHash(deps: ResolvedDependency[]): { hash: string; version: HashVersion } {
  if (deps.length === 0) return hashPartsV1(["kind=dependency_revisions_hash:v1"]);

  const sorted = [...deps].sort((left, right) => {
    const leftKey = `${left.assetSlug}:${left.paramsHashVersion}:${left.paramsHash}`;
    const rightKey = `${right.assetSlug}:${right.paramsHashVersion}:${right.paramsHash}`;
    return leftKey.localeCompare(rightKey);
  });

  const parts = ["kind=dependency_revisions_hash:v1"];
  for (const dep of sorted) {
    parts.push(
      `dep=${dep.assetSlug}:${dep.paramsHashVersion}:${dep.paramsHash}:rev=${dep.outputRevision.toString()}`,
    );
  }
  return hashPartsV1(parts);
}

function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    const payload: { message: string; name?: string; stack?: string } = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) {
      payload.stack = error.stack;
    }
    return payload;
  }
  return { message: "Unknown error" };
}
