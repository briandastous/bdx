import type { Db, IngestKind } from "@bdx/db";
import type { IngestEventId, UserId } from "@bdx/ids";
import {
  createFollowersSyncRun,
  getActiveFollowerIds,
  markFollowersSoftDeleted,
  updateFollowersSyncRun,
} from "@bdx/db";
import type { Logger } from "@bdx/observability";
import { TwitterApiError, TwitterApiRateLimitError } from "@bdx/twitterapi-io";
import type { FollowersPage, TwitterApiClient, XUserData } from "@bdx/twitterapi-io";
import { BaseGraphSyncService, GraphSyncError, GraphSyncRateLimitError } from "./graph_sync.js";
import type { GraphSyncOrientation, GraphSyncState, SyncedCounterpart } from "./graph_sync.js";

export type SyncedFollower = SyncedCounterpart;

export interface FollowersSyncResult {
  targetUserId: UserId;
  followerCount: number;
  targetHandle: string;
  followers: readonly SyncedFollower[];
  syncRunId: IngestEventId;
  cursorExhausted: boolean;
}

const FOLLOWERS_INGEST_KIND: IngestKind = "twitterio_api_user_followers";

export class FollowersSyncService extends BaseGraphSyncService<FollowersPage> {
  constructor(params: {
    db: Db;
    logger: Logger;
    client: TwitterApiClient;
    httpSnapshotMaxBytes?: number;
  }) {
    const orientation: GraphSyncOrientation = {
      ingestKind: FOLLOWERS_INGEST_KIND,
      primaryIsTarget: true,
      createRun: (db, input) =>
        createFollowersSyncRun(db, {
          targetUserId: input.primaryUserId,
          ingestKind: FOLLOWERS_INGEST_KIND,
          syncMode: input.syncMode,
        }),
      updateRun: (db, ingestEventId, update) => updateFollowersSyncRun(db, ingestEventId, update),
      existingIds: (db, primaryUserId) => getActiveFollowerIds(db, { targetUserId: primaryUserId }),
      softDelete: (db, primaryUserId, activeIds) =>
        markFollowersSoftDeleted(db, {
          targetUserId: primaryUserId,
          activeFollowerIds: activeIds,
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

  async syncFollowersFull(params: { targetUserId: UserId }): Promise<FollowersSyncResult> {
    const state = await this.syncGraph({ primaryUserId: params.targetUserId, fullRefresh: true });
    return this.toResult(state);
  }

  async syncFollowersIncremental(params: { targetUserId: UserId }): Promise<FollowersSyncResult> {
    const state = await this.syncGraph({ primaryUserId: params.targetUserId, fullRefresh: false });
    return this.toResult(state);
  }

  protected async fetchPrimaryProfile(primaryUserId: UserId): Promise<XUserData | null> {
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

  protected async fetchPage(handle: string, cursor: string | null): Promise<FollowersPage> {
    try {
      return await this.client.fetchFollowersPage(handle, cursor);
    } catch (error) {
      if (error instanceof TwitterApiRateLimitError) {
        throw new GraphSyncRateLimitError(error.message, {
          retryAfterSeconds: error.retryAfterSeconds,
          original: error,
        });
      }
      if (error instanceof TwitterApiError) {
        throw new GraphSyncError(error.message, { status: "followers-page", original: error });
      }
      throw error;
    }
  }

  protected pageUsers(page: FollowersPage): Iterable<XUserData> {
    return page.followers;
  }

  protected validatePrimaryProfile(
    primaryProfile: XUserData | null,
    primaryUserId: UserId,
  ): string {
    if (primaryProfile?.userId == null) {
      throw new GraphSyncError(`Unable to load profile for user id '${primaryUserId.toString()}'`, {
        status: "user-info",
      });
    }
    if (!primaryProfile.userName) {
      throw new GraphSyncError(`Profile for user id '${primaryUserId.toString()}' missing handle`, {
        status: "user-info",
      });
    }
    return primaryProfile.userName;
  }

  private toResult(state: GraphSyncState): FollowersSyncResult {
    return {
      targetUserId: state.primaryUserId,
      followerCount: state.counterpartCount,
      targetHandle: state.primaryHandle,
      followers: state.counterparts,
      syncRunId: state.syncRunId,
      cursorExhausted: state.cursorExhausted,
    };
  }
}
