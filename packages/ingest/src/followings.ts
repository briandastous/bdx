import type { Db, IngestKind } from "@bdx/db";
import {
  createFollowingsSyncRun,
  getActiveFollowedIds,
  markFollowingsSoftDeleted,
  updateFollowingsSyncRun,
} from "@bdx/db";
import type { Logger } from "@bdx/observability";
import { TwitterApiError, TwitterApiRateLimitError } from "@bdx/twitterapi-io";
import type { FollowingsPage, TwitterApiClient, XUserData } from "@bdx/twitterapi-io";
import { BaseGraphSyncService, GraphSyncError, GraphSyncRateLimitError } from "./graph_sync.js";
import type { GraphSyncOrientation, GraphSyncState, SyncedCounterpart } from "./graph_sync.js";

export type SyncedFollowing = SyncedCounterpart;

export interface FollowingsSyncResult {
  sourceUserId: bigint;
  followingCount: number;
  sourceHandle: string;
  followings: SyncedFollowing[];
  syncRunId: bigint;
  cursorExhausted: boolean;
}

const FOLLOWINGS_INGEST_KIND: IngestKind = "twitterio_api_user_followings";

export class FollowingsSyncService extends BaseGraphSyncService<FollowingsPage> {
  constructor(params: { db: Db; logger: Logger; client: TwitterApiClient; httpSnapshotMaxBytes?: number }) {
    const orientation: GraphSyncOrientation = {
      ingestKind: FOLLOWINGS_INGEST_KIND,
      primaryIsTarget: false,
      createRun: (db, input) =>
        createFollowingsSyncRun(db, {
          sourceUserId: input.primaryUserId,
          ingestKind: FOLLOWINGS_INGEST_KIND,
          syncMode: input.syncMode,
        }),
      updateRun: (db, ingestEventId, update) => updateFollowingsSyncRun(db, ingestEventId, update),
      existingIds: (db, primaryUserId) => getActiveFollowedIds(db, { followerUserId: primaryUserId }),
      softDelete: (db, primaryUserId, activeIds) =>
        markFollowingsSoftDeleted(db, {
          followerUserId: primaryUserId,
          activeFollowedIds: activeIds,
        }),
    };
    super({
      db: params.db,
      logger: params.logger,
      client: params.client,
      orientation,
      ...(params.httpSnapshotMaxBytes !== undefined
        ? { httpSnapshotMaxBytes: params.httpSnapshotMaxBytes }
        : {}),
    });
  }

  async syncFollowingsFull(params: { sourceUserId: bigint }): Promise<FollowingsSyncResult> {
    const state = await this.syncGraph({ primaryUserId: params.sourceUserId, fullRefresh: true });
    return this.toResult(state);
  }

  async syncFollowingsIncremental(params: { sourceUserId: bigint }): Promise<FollowingsSyncResult> {
    const state = await this.syncGraph({ primaryUserId: params.sourceUserId, fullRefresh: false });
    return this.toResult(state);
  }

  protected async fetchPrimaryProfile(primaryUserId: bigint): Promise<XUserData | null> {
    try {
      return await this.client.fetchUserProfileById(primaryUserId);
    } catch (error) {
      if (error instanceof TwitterApiRateLimitError) {
        throw new GraphSyncRateLimitError(error.message, {
          retryAfterSeconds: error.retryAfterSeconds,
          original: error,
        });
      }
      if (error instanceof TwitterApiError) {
        throw new GraphSyncError(error.message, { status: "user-info", original: error });
      }
      throw error;
    }
  }

  protected async fetchPage(handle: string, cursor: string | null): Promise<FollowingsPage> {
    try {
      return await this.client.fetchFollowingsPage(handle, cursor);
    } catch (error) {
      if (error instanceof TwitterApiRateLimitError) {
        throw new GraphSyncRateLimitError(error.message, {
          retryAfterSeconds: error.retryAfterSeconds,
          original: error,
        });
      }
      if (error instanceof TwitterApiError) {
        throw new GraphSyncError(error.message, { status: "followings-page", original: error });
      }
      throw error;
    }
  }

  protected pageUsers(page: FollowingsPage): Iterable<XUserData> {
    return page.followings;
  }

  protected validatePrimaryProfile(
    primaryProfile: XUserData | null,
    primaryUserId: bigint,
  ): string {
    if (!primaryProfile || primaryProfile.userId === null) {
      throw new GraphSyncError(`Unable to load profile for user id '${primaryUserId}'`, {
        status: "user-info",
      });
    }
    if (!primaryProfile.userName) {
      throw new GraphSyncError(`Profile for user id '${primaryUserId}' missing handle`, {
        status: "user-info",
      });
    }
    return primaryProfile.userName;
  }

  private toResult(state: GraphSyncState): FollowingsSyncResult {
    return {
      sourceUserId: state.primaryUserId,
      followingCount: state.counterpartCount,
      sourceHandle: state.primaryHandle,
      followings: state.counterparts,
      syncRunId: state.syncRunId,
      cursorExhausted: state.cursorExhausted,
    };
  }
}
