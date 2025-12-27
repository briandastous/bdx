import type {
  Db,
  IngestKind,
  PostInput,
  PostsMetaInput,
  SyncRunUpdateInput,
  UserProfileInput,
  UsersMetaInput,
} from "@bdx/db";
import {
  addPostsByIdsIngestRunRequestedPosts,
  addUsersByIdsIngestRunRequestedUsers,
  createPostsByIdsIngestRun,
  createUsersByIdsIngestRun,
  listExistingPostIds,
  listExistingUserIds,
  updatePostsByIdsIngestRun,
  updateUsersByIdsIngestRun,
  upsertPosts,
  upsertPostsMeta,
  upsertUserProfile,
  upsertUsersMeta,
  withTransaction,
} from "@bdx/db";
import type { IngestEventId, PostId, UserId } from "@bdx/ids";
import type { Logger } from "@bdx/observability";
import type { TweetData as PostData, TwitterApiClient, XUserData } from "@bdx/twitterapi-io";
import { TwitterApiError, TwitterApiRateLimitError } from "@bdx/twitterapi-io";
import { userProfileInputFromXUser } from "./graph_sync.js";
import { resolveHttpBodyMaxBytes, sanitizeHttpExchange } from "./http_snapshot.js";

const USERS_BY_IDS_INGEST_KIND: IngestKind = "twitterio_api_users_by_ids";
const POSTS_BY_IDS_INGEST_KIND: IngestKind = "twitterio_api_posts_by_ids";

export interface UsersByIdsIngestResult {
  ingestEventId: IngestEventId | null;
  requestedUserIds: readonly UserId[];
  ingestedUserIds: readonly UserId[];
  skippedUserIds: readonly UserId[];
}

export interface PostsByIdsIngestResult {
  ingestEventId: IngestEventId | null;
  requestedPostIds: readonly PostId[];
  ingestedPostIds: readonly PostId[];
  skippedPostIds: readonly PostId[];
  authorUserIds: readonly UserId[];
}

export class UsersByIdsIngestError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class UsersByIdsIngestRateLimitError extends UsersByIdsIngestError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export class PostsByIdsIngestError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class PostsByIdsIngestRateLimitError extends PostsByIdsIngestError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export class UsersByIdsIngestService {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly client: TwitterApiClient;
  private readonly batchSize: number;
  private readonly httpSnapshotMaxBytes: number;

  constructor(params: {
    db: Db;
    logger: Logger;
    client: TwitterApiClient;
    batchSize: number;
    httpSnapshotMaxBytes?: number;
  }) {
    if (!Number.isFinite(params.batchSize) || params.batchSize <= 0) {
      throw new Error("batchSize must be a positive number");
    }
    this.db = params.db;
    this.logger = params.logger;
    this.client = params.client;
    this.batchSize = Math.floor(params.batchSize);
    this.httpSnapshotMaxBytes = resolveHttpBodyMaxBytes(params.httpSnapshotMaxBytes);
  }

  async ingestUsersByIds(params: {
    userIds: Iterable<UserId>;
    force?: boolean;
  }): Promise<UsersByIdsIngestResult> {
    const requestedIds = normalizeUserIds(params.userIds);
    if (requestedIds.length === 0) {
      return {
        ingestEventId: null,
        requestedUserIds: [],
        ingestedUserIds: [],
        skippedUserIds: [],
      };
    }

    const existing =
      params.force === true ? new Set<UserId>() : await listExistingUserIds(this.db, requestedIds);
    const missingIds =
      params.force === true ? requestedIds : requestedIds.filter((id) => !existing.has(id));

    if (missingIds.length === 0) {
      return {
        ingestEventId: null,
        requestedUserIds: requestedIds,
        ingestedUserIds: [],
        skippedUserIds: requestedIds,
      };
    }

    const run = await createUsersByIdsIngestRun(this.db);
    const ingestEventId = run.id;
    await addUsersByIdsIngestRunRequestedUsers(this.db, ingestEventId, missingIds);

    this.logger.info(
      {
        ingestKind: USERS_BY_IDS_INGEST_KIND,
        ingestEventId: ingestEventId.toString(),
        run_id: ingestEventId.toString(),
        requestedUserIds: missingIds.map((id) => id.toString()),
      },
      "Starting users-by-ids ingest",
    );

    try {
      const result = await this.fetchUsersByIds(missingIds);
      const missing = missingIds.filter((id) => !result.usersById.has(id));
      if (missing.length > 0) {
        throw new UsersByIdsIngestError(
          `Users-by-ids ingest response missing ${missing.length} user id(s): ${missing
            .map((id) => id.toString())
            .join(", ")}`,
          { status: "missing-users" },
        );
      }

      const now = new Date();
      const profileInputs = buildUserProfileInputs({
        users: result.users,
        ingestEventId,
        ingestKind: USERS_BY_IDS_INGEST_KIND,
        updatedAt: now,
        requested: new Set(missingIds),
      });
      const usersMetaRows: UsersMetaInput[] = profileInputs.map((profile) => ({
        userId: profile.id,
        ingestEventId,
        ingestKind: USERS_BY_IDS_INGEST_KIND,
        updatedAt: now,
      }));

      await withTransaction(this.db, async (trx) => {
        for (const profile of profileInputs) {
          await upsertUserProfile(trx, profile);
        }
        if (usersMetaRows.length > 0) {
          await upsertUsersMeta(trx, usersMetaRows);
        }
        await updateUsersByIdsIngestRun(trx, ingestEventId, {
          status: "success",
          completedAt: now,
          lastApiStatus: "200",
          lastApiError: null,
        });
      });

      this.logger.info(
        {
          ingestKind: USERS_BY_IDS_INGEST_KIND,
          ingestEventId: ingestEventId.toString(),
          run_id: ingestEventId.toString(),
          ingestedUserIds: missingIds.map((id) => id.toString()),
        },
        "Completed users-by-ids ingest",
      );

      return {
        ingestEventId,
        requestedUserIds: requestedIds,
        ingestedUserIds: missingIds,
        skippedUserIds: requestedIds.filter((id) => !missingIds.includes(id)),
      };
    } catch (error) {
      await this.recordFailure(ingestEventId, error);
      throw this.unwrapError(error);
    }
  }

  private async fetchUsersByIds(
    userIds: UserId[],
  ): Promise<{ users: XUserData[]; usersById: Map<UserId, XUserData> }> {
    const users: XUserData[] = [];
    const usersById = new Map<UserId, XUserData>();

    for (const batch of chunkArray(userIds, this.batchSize)) {
      try {
        const batchUsers = await this.client.fetchUsersByIds(batch);
        for (const user of batchUsers.values()) {
          if (user.userId === null) continue;
          users.push(user);
          usersById.set(user.userId, user);
        }
      } catch (error) {
        if (error instanceof TwitterApiRateLimitError) {
          throw new UsersByIdsIngestRateLimitError(error.message, {
            retryAfterSeconds: error.retryAfterSeconds,
            original: error,
          });
        }
        if (error instanceof TwitterApiError) {
          const status = error.status !== undefined ? String(error.status) : "users-by-ids";
          throw new UsersByIdsIngestError(error.message, { status, original: error });
        }
        throw error;
      }
    }

    return { users, usersById };
  }

  private async recordFailure(ingestEventId: IngestEventId, error: unknown): Promise<void> {
    const status = error instanceof UsersByIdsIngestError ? error.status : "exception";
    const message = error instanceof Error ? error.message : String(error);
    const completionTime = new Date();
    const last = sanitizeHttpExchange(this.client.lastExchange(), this.httpSnapshotMaxBytes);

    const update: SyncRunUpdateInput = {
      status: "error",
      completedAt: completionTime,
      lastApiStatus: status,
      lastApiError: message,
    };

    if (last.request || last.response) {
      update.lastHttpRequest = last.request ?? null;
      update.lastHttpResponse = last.response ?? null;
    }

    await updateUsersByIdsIngestRun(this.db, ingestEventId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof UsersByIdsIngestError && error.original instanceof Error) {
      return error.original;
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}

export class PostsByIdsIngestService {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly client: TwitterApiClient;
  private readonly batchSize: number;
  private readonly httpSnapshotMaxBytes: number;

  constructor(params: {
    db: Db;
    logger: Logger;
    client: TwitterApiClient;
    batchSize: number;
    httpSnapshotMaxBytes?: number;
  }) {
    if (!Number.isFinite(params.batchSize) || params.batchSize <= 0) {
      throw new Error("batchSize must be a positive number");
    }
    this.db = params.db;
    this.logger = params.logger;
    this.client = params.client;
    this.batchSize = Math.floor(params.batchSize);
    this.httpSnapshotMaxBytes = resolveHttpBodyMaxBytes(params.httpSnapshotMaxBytes);
  }

  async ingestPostsByIds(params: {
    postIds: Iterable<PostId>;
    force?: boolean;
  }): Promise<PostsByIdsIngestResult> {
    const requestedIds = normalizePostIds(params.postIds);
    if (requestedIds.length === 0) {
      return {
        ingestEventId: null,
        requestedPostIds: [],
        ingestedPostIds: [],
        skippedPostIds: [],
        authorUserIds: [],
      };
    }

    const existing =
      params.force === true ? new Set<PostId>() : await listExistingPostIds(this.db, requestedIds);
    const missingIds =
      params.force === true ? requestedIds : requestedIds.filter((id) => !existing.has(id));

    if (missingIds.length === 0) {
      return {
        ingestEventId: null,
        requestedPostIds: requestedIds,
        ingestedPostIds: [],
        skippedPostIds: requestedIds,
        authorUserIds: [],
      };
    }

    const run = await createPostsByIdsIngestRun(this.db);
    const ingestEventId = run.id;
    await addPostsByIdsIngestRunRequestedPosts(this.db, ingestEventId, missingIds);

    this.logger.info(
      {
        ingestKind: POSTS_BY_IDS_INGEST_KIND,
        ingestEventId: ingestEventId.toString(),
        run_id: ingestEventId.toString(),
        requestedPostIds: missingIds.map((id) => id.toString()),
      },
      "Starting posts-by-ids ingest",
    );

    try {
      const result = await this.fetchPostsByIds(missingIds);
      const missing = missingIds.filter((id) => !result.postsById.has(id));
      if (missing.length > 0) {
        throw new PostsByIdsIngestError(
          `Posts-by-ids ingest response missing ${missing.length} post id(s): ${missing
            .map((id) => id.toString())
            .join(", ")}`,
          { status: "missing-posts" },
        );
      }

      const now = new Date();
      const requestedSet = new Set(missingIds);
      const postRows: PostInput[] = [];
      const postsMetaRows: PostsMetaInput[] = [];
      const usersMetaById = new Map<UserId, UsersMetaInput>();
      const userProfiles: UserProfileInput[] = [];

      for (const post of result.posts) {
        if (!requestedSet.has(post.postId)) continue;
        postRows.push({
          id: post.postId,
          authorId: post.authorUserId,
          postedAt: post.createdAt,
          text: post.text,
          lang: post.lang,
          rawJson: post.raw,
        });
        postsMetaRows.push({
          postId: post.postId,
          ingestEventId,
          updatedAt: now,
        });
        if (!usersMetaById.has(post.authorUserId)) {
          usersMetaById.set(post.authorUserId, {
            userId: post.authorUserId,
            ingestEventId,
            ingestKind: POSTS_BY_IDS_INGEST_KIND,
            updatedAt: now,
          });
        }
        if (post.authorProfile != null) {
          const { profile } = userProfileInputFromXUser({
            user: post.authorProfile,
            ingestEventId,
            ingestKind: POSTS_BY_IDS_INGEST_KIND,
            updatedAt: now,
          });
          if (profile != null) {
            userProfiles.push(profile);
          }
        }
      }

      await withTransaction(this.db, async (trx) => {
        for (const profile of userProfiles) {
          await upsertUserProfile(trx, profile);
        }
        if (postRows.length > 0) {
          await upsertPosts(trx, postRows);
        }
        if (postsMetaRows.length > 0) {
          await upsertPostsMeta(trx, postsMetaRows);
        }
        if (usersMetaById.size > 0) {
          await upsertUsersMeta(trx, Array.from(usersMetaById.values()));
        }
        await updatePostsByIdsIngestRun(trx, ingestEventId, {
          status: "success",
          completedAt: now,
          lastApiStatus: "200",
          lastApiError: null,
        });
      });

      this.logger.info(
        {
          ingestKind: POSTS_BY_IDS_INGEST_KIND,
          ingestEventId: ingestEventId.toString(),
          run_id: ingestEventId.toString(),
          ingestedPostIds: missingIds.map((id) => id.toString()),
        },
        "Completed posts-by-ids ingest",
      );

      return {
        ingestEventId,
        requestedPostIds: requestedIds,
        ingestedPostIds: missingIds,
        skippedPostIds: requestedIds.filter((id) => !missingIds.includes(id)),
        authorUserIds: Array.from(usersMetaById.keys()).sort(compareBigInt),
      };
    } catch (error) {
      await this.recordFailure(ingestEventId, error);
      throw this.unwrapError(error);
    }
  }

  private async fetchPostsByIds(
    postIds: PostId[],
  ): Promise<{ posts: PostData[]; postsById: Map<PostId, PostData> }> {
    const posts: PostData[] = [];
    const postsById = new Map<PostId, PostData>();

    for (const batch of chunkArray(postIds, this.batchSize)) {
      try {
        const batchPosts = await this.client.fetchTweetsByIds(batch);
        for (const post of batchPosts) {
          posts.push(post);
          postsById.set(post.postId, post);
        }
      } catch (error) {
        if (error instanceof TwitterApiRateLimitError) {
          throw new PostsByIdsIngestRateLimitError(error.message, {
            retryAfterSeconds: error.retryAfterSeconds,
            original: error,
          });
        }
        if (error instanceof TwitterApiError) {
          const status = error.status !== undefined ? String(error.status) : "posts-by-ids";
          throw new PostsByIdsIngestError(error.message, { status, original: error });
        }
        throw error;
      }
    }

    return { posts, postsById };
  }

  private async recordFailure(ingestEventId: IngestEventId, error: unknown): Promise<void> {
    const status = error instanceof PostsByIdsIngestError ? error.status : "exception";
    const message = error instanceof Error ? error.message : String(error);
    const completionTime = new Date();
    const last = sanitizeHttpExchange(this.client.lastExchange(), this.httpSnapshotMaxBytes);

    const update: SyncRunUpdateInput = {
      status: "error",
      completedAt: completionTime,
      lastApiStatus: status,
      lastApiError: message,
    };

    if (last.request || last.response) {
      update.lastHttpRequest = last.request ?? null;
      update.lastHttpResponse = last.response ?? null;
    }

    await updatePostsByIdsIngestRun(this.db, ingestEventId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof PostsByIdsIngestError && error.original instanceof Error) {
      return error.original;
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}

function normalizeUserIds(userIds: Iterable<UserId>): UserId[] {
  const unique = new Set<UserId>();
  for (const userId of userIds) {
    unique.add(userId);
  }
  return Array.from(unique).sort(compareBigInt);
}

function normalizePostIds(postIds: Iterable<PostId>): PostId[] {
  const unique = new Set<PostId>();
  for (const postId of postIds) {
    unique.add(postId);
  }
  return Array.from(unique).sort(compareBigInt);
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildUserProfileInputs(params: {
  users: XUserData[];
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
  updatedAt: Date;
  requested: Set<UserId>;
}): UserProfileInput[] {
  const outputs: UserProfileInput[] = [];
  for (const user of params.users) {
    if (user.userId == null) continue;
    if (!params.requested.has(user.userId)) continue;
    const { profile } = userProfileInputFromXUser({
      user,
      ingestEventId: params.ingestEventId,
      ingestKind: params.ingestKind,
      updatedAt: params.updatedAt,
    });
    if (profile != null) outputs.push(profile);
  }
  return outputs;
}
