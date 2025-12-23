import type {
  Db,
  FollowsSyncMode,
  IngestEventRecord,
  IngestKind,
  SyncRunUpdateInput,
  UserProfileInput,
  UsersMetaInput,
} from "@bdx/db";
import {
  upsertFollows,
  upsertFollowsMeta,
  upsertUserProfile,
  upsertUsersMeta,
  withTransaction,
} from "@bdx/db";
import type { Logger } from "@bdx/observability";
import type {
  RequestSnapshot,
  ResponseSnapshot,
  TwitterApiClient,
  XUserData,
} from "@bdx/twitterapi-io";
import { sanitizeHttpExchange } from "./http_snapshot.js";

export interface CounterpartMetadata {
  userName: string | null;
  displayName: string | null;
  followersCount: bigint | null;
  followingCount: bigint | null;
}

export interface CounterpartMetadataWithSync {
  counterpartMetadata: CounterpartMetadata;
  syncedAt: Date;
  syncRunId: bigint;
}

export interface SyncedCounterpart {
  userId: bigint;
  metadata: CounterpartMetadataWithSync;
}

export interface GraphSyncState {
  primaryUserId: bigint;
  primaryHandle: string;
  counterparts: SyncedCounterpart[];
  counterpartCount: number;
  syncRunId: bigint;
  cursorExhausted: boolean;
}

export interface GraphSyncPage {
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface GraphSyncOrientation {
  ingestKind: IngestKind;
  primaryIsTarget: boolean;
  createRun: (
    db: Db,
    params: { primaryUserId: bigint; syncMode: FollowsSyncMode },
  ) => Promise<IngestEventRecord>;
  updateRun: (db: Db, ingestEventId: bigint, input: SyncRunUpdateInput) => Promise<number>;
  existingIds: (db: Db, primaryUserId: bigint) => Promise<Set<bigint>>;
  softDelete: (db: Db, primaryUserId: bigint, activeIds: Iterable<bigint>) => Promise<number>;
}

export class GraphSyncError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class GraphSyncRateLimitError extends GraphSyncError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export function userProfileInputFromXUser(params: {
  user: XUserData;
  ingestEventId: bigint;
  ingestKind: IngestKind;
  updatedAt: Date;
}): { profile: UserProfileInput | null; metadata: CounterpartMetadata | null } {
  const userId = params.user.userId;
  if (userId === null) return { profile: null, metadata: null };

  const profile: UserProfileInput = {
    id: userId,
    handle: params.user.userName,
    displayName: params.user.displayName,
    profileUrl: params.user.profileUrl,
    profileImageUrl: params.user.profileImageUrl,
    coverImageUrl: params.user.coverImageUrl,
    bio: params.user.bio,
    location: params.user.location,
    isBlueVerified: params.user.isBlueVerified,
    verifiedType: params.user.verifiedType,
    isTranslator: params.user.isTranslator,
    isAutomated: params.user.isAutomated,
    automatedBy: params.user.automatedBy,
    possiblySensitive: params.user.possiblySensitive,
    unavailable: params.user.unavailable,
    unavailableMessage: params.user.unavailableMessage,
    unavailableReason: params.user.unavailableReason,
    followersCount: params.user.followersCount,
    followingCount: params.user.followingCount,
    favouritesCount: params.user.favouritesCount,
    mediaCount: params.user.mediaCount,
    statusesCount: params.user.statusesCount,
    userCreatedAt: params.user.createdAt,
    bioEntities: params.user.bioEntities,
    affiliatesHighlightedLabel: params.user.affiliatesHighlightedLabel,
    pinnedTweetIds: params.user.pinnedTweetIds,
    withheldCountries: params.user.withheldCountries,
    ingestEventId: params.ingestEventId,
    ingestKind: params.ingestKind,
    updatedAt: params.updatedAt,
  };

  const metadata: CounterpartMetadata = {
    userName: params.user.userName,
    displayName: params.user.displayName,
    followersCount: params.user.followersCount,
    followingCount: params.user.followingCount,
  };

  return { profile, metadata };
}

export abstract class BaseGraphSyncService<PageT extends GraphSyncPage> {
  protected readonly db: Db;
  protected readonly logger: Logger;
  protected readonly client: TwitterApiClient;
  protected readonly orientation: GraphSyncOrientation;
  protected readonly httpSnapshotMaxBytes: number | undefined;

  constructor(params: {
    db: Db;
    logger: Logger;
    client: TwitterApiClient;
    orientation: GraphSyncOrientation;
    httpSnapshotMaxBytes?: number;
  }) {
    this.db = params.db;
    this.logger = params.logger;
    this.client = params.client;
    this.orientation = params.orientation;
    this.httpSnapshotMaxBytes = params.httpSnapshotMaxBytes;
  }

  protected abstract fetchPrimaryProfile(primaryUserId: bigint): Promise<XUserData | null>;
  protected abstract fetchPage(handle: string, cursor: string | null): Promise<PageT>;
  protected abstract pageUsers(page: PageT): Iterable<XUserData>;
  protected abstract validatePrimaryProfile(
    primaryProfile: XUserData | null,
    primaryUserId: bigint,
  ): string;

  protected lastHttpExchange(): { request: RequestSnapshot | null; response: ResponseSnapshot | null } {
    return this.client.lastExchange();
  }

  protected async syncGraph(params: {
    primaryUserId: bigint;
    fullRefresh: boolean;
  }): Promise<GraphSyncState> {
    const counterpartIds = new Set<bigint>();
    const counterpartMaterializations: SyncedCounterpart[] = [];
    const allUserUpdates: UserProfileInput[] = [];
    const allFollowEdges: { targetId: bigint; followerId: bigint }[] = [];
    const allFollowMetaUpdates: {
      targetId: bigint;
      followerId: bigint;
      ingestEventId: bigint;
      ingestKind: IngestKind;
      updatedAt: Date;
    }[] = [];
    const allUserMetaUpdates: UsersMetaInput[] = [];
    let cursor: string | null = null;
    let exhausted = false;

    const runRecord = await this.orientation.createRun(this.db, {
      primaryUserId: params.primaryUserId,
      syncMode: params.fullRefresh ? "full_refresh" : "incremental",
    });
    const syncRunId = runRecord.id;

    this.logger.info(
      {
        ingestKind: this.orientation.ingestKind,
        primaryUserId: params.primaryUserId.toString(),
        fullRefresh: params.fullRefresh,
        syncRunId: syncRunId.toString(),
        run_id: syncRunId.toString(),
      },
      "Starting graph sync",
    );

    let existingCounterparts = new Set<bigint>();
    if (!params.fullRefresh) {
      existingCounterparts = await this.orientation.existingIds(this.db, params.primaryUserId);
    }

    let primaryProfile: XUserData | null = null;
    let primaryHandle: string;

    try {
      primaryProfile = await this.fetchPrimaryProfile(params.primaryUserId);
      primaryHandle = this.validatePrimaryProfile(primaryProfile, params.primaryUserId);

      if (primaryProfile && primaryProfile.userId !== null) {
        const now = new Date();
        const { profile } = userProfileInputFromXUser({
          user: primaryProfile,
          ingestEventId: syncRunId,
          ingestKind: this.orientation.ingestKind,
          updatedAt: now,
        });
        if (profile) {
          allUserUpdates.push(profile);
        }
        allUserMetaUpdates.push({
          userId: primaryProfile.userId,
          ingestEventId: syncRunId,
          ingestKind: this.orientation.ingestKind,
          updatedAt: now,
        });
      }

      while (true) {
        const previousCursor: string | null = cursor;
        this.logger.debug(
          {
            ingestKind: this.orientation.ingestKind,
            primaryUserId: params.primaryUserId.toString(),
            cursor,
            run_id: syncRunId.toString(),
          },
          "Fetching graph page",
        );

        const page = await this.fetchPage(primaryHandle, cursor);

        const batch = this.processPage(page, {
          primaryUserId: params.primaryUserId,
          syncRunId,
          counterpartIds,
          fullRefresh: params.fullRefresh,
          existingCounterparts,
        });

        if (batch.materializations.length > 0) {
          counterpartMaterializations.push(...batch.materializations);
        }
        if (batch.userUpdates.length > 0) {
          allUserUpdates.push(...batch.userUpdates);
        }
        if (batch.followEdges.length > 0) {
          allFollowEdges.push(...batch.followEdges);
        }
        if (batch.followMetaUpdates.length > 0) {
          allFollowMetaUpdates.push(...batch.followMetaUpdates);
        }
        if (batch.userMetaUpdates.length > 0) {
          allUserMetaUpdates.push(...batch.userMetaUpdates);
        }

        this.logger.debug(
          {
            ingestKind: this.orientation.ingestKind,
            newCounterparts: batch.materializations.length,
            userUpdates: batch.userUpdates.length,
            followEdges: batch.followEdges.length,
          },
          "Processed graph page",
        );

        if (!params.fullRefresh && batch.materializations.length === 0) {
          exhausted = true;
          break;
        }

        const nextCursorValue = page.nextCursor;
        if (!page.hasNextPage || !nextCursorValue) {
          exhausted = !page.hasNextPage;
          break;
        }

        if (nextCursorValue === previousCursor) {
          exhausted = false;
          break;
        }

        cursor = nextCursorValue;
      }

      const completionTime = new Date();

      const hasWrites =
        allUserUpdates.length > 0 ||
        allFollowEdges.length > 0 ||
        allFollowMetaUpdates.length > 0 ||
        allUserMetaUpdates.length > 0;

      if (hasWrites) {
        await withTransaction(this.db, async (trx) => {
          for (const user of allUserUpdates) {
            await upsertUserProfile(trx, user);
          }
          if (allFollowEdges.length > 0) {
            await upsertFollows(trx, allFollowEdges);
          }
          if (allFollowMetaUpdates.length > 0) {
            await upsertFollowsMeta(trx, allFollowMetaUpdates);
          }
          if (allUserMetaUpdates.length > 0) {
            await upsertUsersMeta(trx, allUserMetaUpdates);
          }
        });
      }

      if (params.fullRefresh) {
        await this.orientation.softDelete(this.db, params.primaryUserId, counterpartIds);
      }

      const update: SyncRunUpdateInput = {
        status: "success",
        completedAt: completionTime,
        cursorExhausted: exhausted,
        lastApiStatus: "200",
        lastApiError: null,
      };

      await this.orientation.updateRun(this.db, syncRunId, update);

      const state: GraphSyncState = {
        primaryUserId: params.primaryUserId,
        primaryHandle,
        counterparts: counterpartMaterializations,
        counterpartCount: counterpartIds.size,
        syncRunId,
        cursorExhausted: exhausted,
      };

      this.logger.info(
        {
          ingestKind: this.orientation.ingestKind,
          primaryUserId: params.primaryUserId.toString(),
          counterpartCount: counterpartIds.size,
          cursorExhausted: exhausted,
          syncRunId: syncRunId.toString(),
          run_id: syncRunId.toString(),
        },
        "Completed graph sync",
      );

      return state;
    } catch (error) {
      await this.recordFailure(syncRunId, error);
      throw this.unwrapError(error);
    }
  }

  protected relationshipIds(
    primaryUserId: bigint,
    counterpartUserId: bigint,
  ): { targetId: bigint; followerId: bigint } {
    if (this.orientation.primaryIsTarget) {
      return { targetId: primaryUserId, followerId: counterpartUserId };
    }
    return { targetId: counterpartUserId, followerId: primaryUserId };
  }

  protected processPage(
    page: PageT,
    params: {
      primaryUserId: bigint;
      syncRunId: bigint;
      counterpartIds: Set<bigint>;
      fullRefresh: boolean;
      existingCounterparts: Set<bigint>;
    },
  ): {
    userUpdates: UserProfileInput[];
    followEdges: { targetId: bigint; followerId: bigint }[];
    followMetaUpdates: {
      targetId: bigint;
      followerId: bigint;
      ingestEventId: bigint;
      ingestKind: IngestKind;
      updatedAt: Date;
    }[];
    userMetaUpdates: UsersMetaInput[];
    materializations: SyncedCounterpart[];
  } {
    const now = new Date();
    const userUpdates: UserProfileInput[] = [];
    const followEdges: { targetId: bigint; followerId: bigint }[] = [];
    const followMetaUpdates: {
      targetId: bigint;
      followerId: bigint;
      ingestEventId: bigint;
      ingestKind: IngestKind;
      updatedAt: Date;
    }[] = [];
    const userMetaUpdates: UsersMetaInput[] = [];
    const materializations: SyncedCounterpart[] = [];

    for (const counterpart of this.pageUsers(page)) {
      const { profile, metadata } = userProfileInputFromXUser({
        user: counterpart,
        ingestEventId: params.syncRunId,
        ingestKind: this.orientation.ingestKind,
        updatedAt: now,
      });
      if (!profile) continue;

      const counterpartId = profile.id;
      const isNew = !params.existingCounterparts.has(counterpartId);
      const includeForWrite = params.fullRefresh || isNew;

      if (params.fullRefresh || isNew) {
        params.counterpartIds.add(counterpartId);
      }

      const { targetId, followerId } = this.relationshipIds(params.primaryUserId, counterpartId);
      if (includeForWrite) {
        userUpdates.push(profile);
        followEdges.push({ targetId, followerId });
      }
      followMetaUpdates.push({
        targetId,
        followerId,
        ingestEventId: params.syncRunId,
        ingestKind: this.orientation.ingestKind,
        updatedAt: now,
      });
      userMetaUpdates.push({
        userId: counterpartId,
        ingestEventId: params.syncRunId,
        ingestKind: this.orientation.ingestKind,
        updatedAt: now,
      });
      if (includeForWrite && metadata) {
        materializations.push({
          userId: counterpartId,
          metadata: {
            counterpartMetadata: metadata,
            syncedAt: now,
            syncRunId: params.syncRunId,
          },
        });
      }

      if (isNew) {
        params.existingCounterparts.add(counterpartId);
      }
    }

    return { userUpdates, followEdges, followMetaUpdates, userMetaUpdates, materializations };
  }

  private async recordFailure(syncRunId: bigint, error: unknown): Promise<void> {
    const status = error instanceof GraphSyncError ? error.status : "exception";
    const message = error instanceof Error ? error.message : String(error);
    const completionTime = new Date();
    const last = sanitizeHttpExchange(this.lastHttpExchange(), this.httpSnapshotMaxBytes);

    const update: SyncRunUpdateInput = {
      status: "error",
      completedAt: completionTime,
      cursorExhausted: false,
      lastApiStatus: status,
      lastApiError: message,
    };

    if (last.request || last.response) {
      update.lastHttpRequest = last.request ?? null;
      update.lastHttpResponse = last.response ?? null;
    }

    await this.orientation.updateRun(this.db, syncRunId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof GraphSyncError && error.original instanceof Error) {
      return error.original;
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}
