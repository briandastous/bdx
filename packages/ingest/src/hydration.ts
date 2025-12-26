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
  addPostsByIdsHydrationRunRequestedPosts,
  addUsersByIdsHydrationRunRequestedUsers,
  createPostsByIdsHydrationRun,
  createUsersByIdsHydrationRun,
  listExistingPostIds,
  listExistingUserIds,
  updatePostsByIdsHydrationRun,
  updateUsersByIdsHydrationRun,
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

export interface UsersHydrationResult {
  ingestEventId: IngestEventId | null;
  requestedUserIds: readonly UserId[];
  hydratedUserIds: readonly UserId[];
  skippedUserIds: readonly UserId[];
}

export interface PostsHydrationResult {
  ingestEventId: IngestEventId | null;
  requestedPostIds: readonly PostId[];
  hydratedPostIds: readonly PostId[];
  skippedPostIds: readonly PostId[];
  authorUserIds: readonly UserId[];
}

export class UsersHydrationError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class UsersHydrationRateLimitError extends UsersHydrationError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export class PostsHydrationError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class PostsHydrationRateLimitError extends PostsHydrationError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export class UsersHydrationService {
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

  async hydrateUsersByIds(params: {
    userIds: Iterable<UserId>;
    force?: boolean;
  }): Promise<UsersHydrationResult> {
    const requestedIds = normalizeUserIds(params.userIds);
    if (requestedIds.length === 0) {
      return {
        ingestEventId: null,
        requestedUserIds: [],
        hydratedUserIds: [],
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
        hydratedUserIds: [],
        skippedUserIds: requestedIds,
      };
    }

    const run = await createUsersByIdsHydrationRun(this.db);
    const ingestEventId = run.id;
    await addUsersByIdsHydrationRunRequestedUsers(this.db, ingestEventId, missingIds);

    this.logger.info(
      {
        ingestKind: USERS_BY_IDS_INGEST_KIND,
        ingestEventId: ingestEventId.toString(),
        run_id: ingestEventId.toString(),
        requestedUserIds: missingIds.map((id) => id.toString()),
      },
      "Starting users-by-ids hydration",
    );

    try {
      const result = await this.fetchUsersByIds(missingIds);
      const missing = missingIds.filter((id) => !result.usersById.has(id));
      if (missing.length > 0) {
        throw new UsersHydrationError(
          `Hydration response missing ${missing.length} user id(s): ${missing
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
        await updateUsersByIdsHydrationRun(trx, ingestEventId, {
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
          hydratedUserIds: missingIds.map((id) => id.toString()),
        },
        "Completed users-by-ids hydration",
      );

      return {
        ingestEventId,
        requestedUserIds: requestedIds,
        hydratedUserIds: missingIds,
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
          throw new UsersHydrationRateLimitError(error.message, {
            retryAfterSeconds: error.retryAfterSeconds,
            original: error,
          });
        }
        if (error instanceof TwitterApiError) {
          const status = error.status !== undefined ? String(error.status) : "users-by-ids";
          throw new UsersHydrationError(error.message, { status, original: error });
        }
        throw error;
      }
    }

    return { users, usersById };
  }

  private async recordFailure(ingestEventId: IngestEventId, error: unknown): Promise<void> {
    const status = error instanceof UsersHydrationError ? error.status : "exception";
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

    await updateUsersByIdsHydrationRun(this.db, ingestEventId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof UsersHydrationError && error.original instanceof Error) {
      return error.original;
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}

export class PostsHydrationService {
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

  async hydratePostsByIds(params: {
    postIds: Iterable<PostId>;
    force?: boolean;
  }): Promise<PostsHydrationResult> {
    const requestedIds = normalizePostIds(params.postIds);
    if (requestedIds.length === 0) {
      return {
        ingestEventId: null,
        requestedPostIds: [],
        hydratedPostIds: [],
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
        hydratedPostIds: [],
        skippedPostIds: requestedIds,
        authorUserIds: [],
      };
    }

    const run = await createPostsByIdsHydrationRun(this.db);
    const ingestEventId = run.id;
    await addPostsByIdsHydrationRunRequestedPosts(this.db, ingestEventId, missingIds);

    this.logger.info(
      {
        ingestKind: POSTS_BY_IDS_INGEST_KIND,
        ingestEventId: ingestEventId.toString(),
        run_id: ingestEventId.toString(),
        requestedPostIds: missingIds.map((id) => id.toString()),
      },
      "Starting posts-by-ids hydration",
    );

    try {
      const result = await this.fetchPostsByIds(missingIds);
      const missing = missingIds.filter((id) => !result.postsById.has(id));
      if (missing.length > 0) {
        throw new PostsHydrationError(
          `Hydration response missing ${missing.length} post id(s): ${missing
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
        await updatePostsByIdsHydrationRun(trx, ingestEventId, {
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
          hydratedPostIds: missingIds.map((id) => id.toString()),
        },
        "Completed posts-by-ids hydration",
      );

      return {
        ingestEventId,
        requestedPostIds: requestedIds,
        hydratedPostIds: missingIds,
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
          throw new PostsHydrationRateLimitError(error.message, {
            retryAfterSeconds: error.retryAfterSeconds,
            original: error,
          });
        }
        if (error instanceof TwitterApiError) {
          const status = error.status !== undefined ? String(error.status) : "posts-by-ids";
          throw new PostsHydrationError(error.message, { status, original: error });
        }
        throw error;
      }
    }

    return { posts, postsById };
  }

  private async recordFailure(ingestEventId: IngestEventId, error: unknown): Promise<void> {
    const status = error instanceof PostsHydrationError ? error.status : "exception";
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

    await updatePostsByIdsHydrationRun(this.db, ingestEventId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof PostsHydrationError && error.original instanceof Error) {
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
