import type {
  Db,
  IngestKind,
  PostInput,
  PostsMetaInput,
  PostsSyncRunUpdateInput,
  UserProfileInput,
  UsersMetaInput,
} from "@bdx/db";
import type { IngestEventId, PostId, UserId } from "@bdx/ids";
import {
  addPostsSyncRunTargetUsers,
  createPostsSyncRun,
  listUserHandlesByIds,
  updatePostsSyncRun,
  upsertPosts,
  upsertPostsMeta,
  upsertUserProfile,
  upsertUsersMeta,
  withTransaction,
} from "@bdx/db";
import type { Logger } from "@bdx/observability";
import { TwitterApiError, TwitterApiRateLimitError } from "@bdx/twitterapi-io";
import type { TweetData, TwitterApiClient } from "@bdx/twitterapi-io";
import {
  UsersByIdsIngestError,
  UsersByIdsIngestRateLimitError,
  UsersByIdsIngestService,
} from "./hydration.js";
import { userProfileInputFromXUser } from "./graph_sync.js";
import { resolveHttpBodyMaxBytes, sanitizeHttpExchange } from "./http_snapshot.js";

export const POSTS_RESULT_WINDOW_LIMIT = 1000;

const POSTS_INGEST_KIND: IngestKind = "twitterio_api_users_posts";

export class PostsSyncError extends Error {
  readonly status: string;
  readonly original: unknown;

  constructor(message: string, params: { status: string; original?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = params.status;
    this.original = params.original;
  }
}

export class PostsSyncRateLimitError extends PostsSyncError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { status?: string; retryAfterSeconds?: number | null; original?: unknown },
  ) {
    super(message, { status: params.status ?? "429", original: params.original });
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export interface PostsSyncResult {
  syncRunId: IngestEventId;
  targetUserIds: readonly UserId[];
  postCount: number;
  postIds: readonly PostId[];
  cursorExhausted: boolean;
  syncedSince: Date | null;
}

export class PostsSyncService {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly client: TwitterApiClient;
  private readonly maxQueryLength: number;
  private readonly httpSnapshotMaxBytes: number;
  private readonly usersByIdsIngest: UsersByIdsIngestService;

  constructor(params: {
    db: Db;
    logger: Logger;
    client: TwitterApiClient;
    maxQueryLength: number;
    batchUsersByIdsMax: number;
    httpSnapshotMaxBytes?: number;
  }) {
    if (!Number.isFinite(params.maxQueryLength) || params.maxQueryLength <= 0) {
      throw new Error("maxQueryLength must be a positive number");
    }
    this.db = params.db;
    this.logger = params.logger;
    this.client = params.client;
    this.maxQueryLength = params.maxQueryLength;
    this.httpSnapshotMaxBytes = resolveHttpBodyMaxBytes(params.httpSnapshotMaxBytes);
    const httpSnapshotParam =
      params.httpSnapshotMaxBytes !== undefined
        ? { httpSnapshotMaxBytes: params.httpSnapshotMaxBytes }
        : {};
    this.usersByIdsIngest = new UsersByIdsIngestService({
      db: params.db,
      logger: params.logger,
      client: params.client,
      batchSize: params.batchUsersByIdsMax,
      ...httpSnapshotParam,
    });
  }

  async syncPostsFull(params: { userIds: Iterable<UserId> }): Promise<PostsSyncResult> {
    return this.syncPosts({ userIds: params.userIds, since: null });
  }

  async syncPostsIncremental(params: {
    userIds: Iterable<UserId>;
    since: Date;
  }): Promise<PostsSyncResult> {
    if (!Number.isFinite(params.since.getTime())) {
      throw new Error("since must be a valid Date");
    }
    return this.syncPosts({ userIds: params.userIds, since: params.since });
  }

  private async syncPosts(params: {
    userIds: Iterable<UserId>;
    since: Date | null;
  }): Promise<PostsSyncResult> {
    const uniqueUserIds = normalizeUserIds(params.userIds);
    if (uniqueUserIds.length === 0) {
      throw new Error("userIds must contain at least one id");
    }

    const run = await createPostsSyncRun(this.db, { ingestKind: POSTS_INGEST_KIND });
    const syncRunId = run.id;

    this.logger.info(
      {
        ingestKind: POSTS_INGEST_KIND,
        targetUserIds: uniqueUserIds.map((id) => id.toString()),
        syncRunId: syncRunId.toString(),
        run_id: syncRunId.toString(),
      },
      "Starting posts sync",
    );

    try {
      await this.ensureTargetUsersIngested(uniqueUserIds);
      await addPostsSyncRunTargetUsers(this.db, syncRunId, uniqueUserIds);
    } catch (error) {
      await this.recordFailure(syncRunId, error, params.since);
      throw this.unwrapError(error);
    }

    let targetHandles: Map<UserId, string>;
    try {
      targetHandles = await this.loadTargetHandles(uniqueUserIds);
    } catch (error) {
      await this.recordFailure(syncRunId, error, params.since);
      throw this.unwrapError(error);
    }

    let baseQueries: string[] = [];
    try {
      baseQueries = this.buildQueries(uniqueUserIds, targetHandles);
    } catch (error) {
      await this.recordFailure(syncRunId, error, params.since);
      throw this.unwrapError(error);
    }

    const postsRows: PostInput[] = [];
    const postsMetaRows: PostsMetaInput[] = [];
    const usersMetaRows = new Map<UserId, UsersMetaInput>();
    const userProfilesById = new Map<UserId, UserProfileInput>();
    const unexpectedAuthors = new Set<UserId>();
    const targetUserIds = new Set(uniqueUserIds);
    const seenPostIds = new Set<PostId>();
    let cursorExhausted = true;

    try {
      for (const baseQuery of baseQueries) {
        let windowUntil: Date | null = null;
        for (;;) {
          const boundedQuery = applyTimeBounds(baseQuery, {
            since: params.since,
            until: windowUntil,
          });
          let cursor: string | null = null;
          let windowCount = 0;
          let windowOldest: Date | null = null;

          for (;;) {
            let page;
            try {
              page = await this.client.fetchPostsPage(boundedQuery, cursor);
            } catch (error) {
              if (error instanceof TwitterApiRateLimitError) {
                throw new PostsSyncRateLimitError(error.message, {
                  retryAfterSeconds: error.retryAfterSeconds,
                  original: error,
                });
              }
              if (error instanceof TwitterApiError) {
                throw new PostsSyncError(error.message, { status: "posts-page", original: error });
              }
              throw error;
            }

            const { postRows, metaRows, usersMeta, postIds, userProfiles } = this.processPage(
              page.posts,
              syncRunId,
            );
            postsRows.push(...postRows);
            postsMetaRows.push(...metaRows);
            for (const [userId, meta] of usersMeta.entries()) {
              usersMetaRows.set(userId, meta);
            }
            for (const profile of userProfiles) {
              userProfilesById.set(profile.id, profile);
            }
            for (const postId of postIds) {
              seenPostIds.add(postId);
            }
            for (const row of postRows) {
              if (!targetUserIds.has(row.authorId)) {
                unexpectedAuthors.add(row.authorId);
              }
            }

            windowCount += page.posts.length;
            const oldestInPage = oldestTimestamp(page.posts);
            if (oldestInPage && (!windowOldest || oldestInPage < windowOldest)) {
              windowOldest = oldestInPage;
            }

            const pageExhausted = !(page.hasNextPage && page.nextCursor);
            if (pageExhausted) {
              break;
            }
            cursor = page.nextCursor;
          }

          const shouldContinue =
            windowCount >= POSTS_RESULT_WINDOW_LIMIT &&
            windowOldest !== null &&
            (params.since === null || windowOldest > params.since);

          if (!shouldContinue) {
            cursorExhausted = true;
            break;
          }

          cursorExhausted = false;
          windowUntil = subtractOneSecond(windowOldest);
        }
      }
    } catch (error) {
      await this.recordFailure(syncRunId, error, params.since);
      throw this.unwrapError(error);
    }

    if (unexpectedAuthors.size > 0) {
      this.logger.warn(
        {
          ingestKind: POSTS_INGEST_KIND,
          syncRunId: syncRunId.toString(),
          run_id: syncRunId.toString(),
          unexpectedAuthorIds: Array.from(unexpectedAuthors)
            .map((id) => id.toString())
            .sort(),
        },
        "Posts sync returned tweets authored by unexpected users",
      );
    }

    const now = new Date();
    for (const userId of uniqueUserIds) {
      if (!usersMetaRows.has(userId)) {
        usersMetaRows.set(userId, {
          userId,
          ingestEventId: syncRunId,
          ingestKind: POSTS_INGEST_KIND,
          updatedAt: now,
        });
      }
    }

    await withTransaction(this.db, async (trx) => {
      for (const profile of userProfilesById.values()) {
        await upsertUserProfile(trx, profile);
      }
      if (postsRows.length > 0) {
        await upsertPosts(trx, postsRows);
      }
      if (postsMetaRows.length > 0) {
        await upsertPostsMeta(trx, postsMetaRows);
      }
      if (usersMetaRows.size > 0) {
        await upsertUsersMeta(trx, Array.from(usersMetaRows.values()));
      }
    });

    const update: PostsSyncRunUpdateInput = {
      status: "success",
      completedAt: now,
      cursorExhausted,
      lastApiStatus: "200",
      lastApiError: null,
      syncedSince: params.since,
    };
    await updatePostsSyncRun(this.db, syncRunId, update);

    const result: PostsSyncResult = {
      syncRunId,
      targetUserIds: uniqueUserIds,
      postCount: seenPostIds.size,
      postIds: Array.from(seenPostIds).sort(compareBigInt),
      cursorExhausted,
      syncedSince: params.since,
    };

    this.logger.info(
      {
        ingestKind: POSTS_INGEST_KIND,
        syncRunId: syncRunId.toString(),
        run_id: syncRunId.toString(),
        postCount: result.postCount,
        cursorExhausted: result.cursorExhausted,
      },
      "Completed posts sync",
    );

    return result;
  }

  private async ensureTargetUsersIngested(userIds: UserId[]): Promise<void> {
    try {
      await this.usersByIdsIngest.ingestUsersByIds({ userIds });
    } catch (error) {
      if (error instanceof UsersByIdsIngestRateLimitError) {
        throw new PostsSyncRateLimitError(error.message, {
          retryAfterSeconds: error.retryAfterSeconds,
          original: error,
        });
      }
      if (error instanceof UsersByIdsIngestError) {
        throw new PostsSyncError(error.message, { status: "users-by-ids-ingest", original: error });
      }
      throw error;
    }
  }

  private async loadTargetHandles(userIds: UserId[]): Promise<Map<UserId, string>> {
    const handles = await listUserHandlesByIds(this.db, userIds);
    const targetHandles = new Map<UserId, string>();
    for (const userId of userIds) {
      const handle = handles.get(userId);
      if (handle == null || handle.trim().length === 0) {
        throw new PostsSyncError(`Missing handle for user id '${userId.toString()}'`, {
          status: "user-info",
        });
      }
      targetHandles.set(userId, handle);
    }
    return targetHandles;
  }

  private buildQueries(userIds: UserId[], handles: Map<UserId, string>): string[] {
    if (userIds.length === 0) return [];

    const queries: string[] = [];
    let currentTokens: string[] = [];

    const buildQuery = (tokens: string[]): string => `(${tokens.join(" OR ")})`;

    for (const userId of userIds) {
      const handle = handles.get(userId);
      if (!handle) {
        throw new PostsSyncError(`Missing handle for user id '${userId.toString()}'`, {
          status: "user-info",
        });
      }
      const token = `from:${handle}`;
      const candidate = buildQuery([...currentTokens, token]);
      if (candidate.length > this.maxQueryLength) {
        if (currentTokens.length === 0) {
          throw new PostsSyncError(
            `Single-handle query exceeds max length (${this.maxQueryLength})`,
            { status: "query-build" },
          );
        }
        queries.push(buildQuery(currentTokens));
        currentTokens = [token];
        continue;
      }
      currentTokens = [...currentTokens, token];
    }

    if (currentTokens.length > 0) {
      const query = buildQuery(currentTokens);
      if (query.length > this.maxQueryLength) {
        throw new PostsSyncError(`Query exceeds max length (${this.maxQueryLength})`, {
          status: "query-build",
        });
      }
      queries.push(query);
    }

    return queries;
  }

  private processPage(
    posts: Iterable<TweetData>,
    syncRunId: IngestEventId,
  ): {
    postRows: PostInput[];
    metaRows: PostsMetaInput[];
    usersMeta: Map<UserId, UsersMetaInput>;
    userProfiles: UserProfileInput[];
    postIds: Set<PostId>;
  } {
    const now = new Date();
    const postRows: PostInput[] = [];
    const metaRows: PostsMetaInput[] = [];
    const usersMeta = new Map<UserId, UsersMetaInput>();
    const userProfiles: UserProfileInput[] = [];
    const postIds = new Set<PostId>();

    for (const post of posts) {
      postIds.add(post.postId);
      postRows.push({
        id: post.postId,
        authorId: post.authorUserId,
        postedAt: post.createdAt,
        text: post.text,
        lang: post.lang,
        rawJson: post.raw,
      });
      metaRows.push({
        postId: post.postId,
        ingestEventId: syncRunId,
        updatedAt: now,
      });
      usersMeta.set(post.authorUserId, {
        userId: post.authorUserId,
        ingestEventId: syncRunId,
        ingestKind: POSTS_INGEST_KIND,
        updatedAt: now,
      });
      if (post.authorProfile != null) {
        const { profile } = userProfileInputFromXUser({
          user: post.authorProfile,
          ingestEventId: syncRunId,
          ingestKind: POSTS_INGEST_KIND,
          updatedAt: now,
        });
        if (profile != null) {
          userProfiles.push(profile);
        }
      }
    }

    return { postRows, metaRows, usersMeta, userProfiles, postIds };
  }

  private async recordFailure(
    syncRunId: IngestEventId,
    error: unknown,
    syncedSince: Date | null,
  ): Promise<void> {
    const status = error instanceof PostsSyncError ? error.status : "exception";
    const message = error instanceof Error ? error.message : String(error);
    const completionTime = new Date();
    const last = sanitizeHttpExchange(this.client.lastExchange(), this.httpSnapshotMaxBytes);

    const update: PostsSyncRunUpdateInput = {
      status: "error",
      completedAt: completionTime,
      cursorExhausted: false,
      lastApiStatus: status,
      lastApiError: message,
      syncedSince,
    };
    if (last.request || last.response) {
      update.lastHttpRequest = last.request ?? null;
      update.lastHttpResponse = last.response ?? null;
    }

    await updatePostsSyncRun(this.db, syncRunId, update);
  }

  private unwrapError(error: unknown): Error {
    if (error instanceof PostsSyncError && error.original instanceof Error) {
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

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function applyTimeBounds(
  baseQuery: string,
  params: { since: Date | null; until: Date | null },
): string {
  const components: string[] = [baseQuery];
  if (params.since) {
    components.push(`since:${formatTimestamp(params.since)}`);
  }
  if (params.until) {
    components.push(`until:${formatTimestamp(params.until)}`);
  }
  return components.join(" ");
}

function formatTimestamp(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}_UTC`;
}

function oldestTimestamp(posts: Iterable<TweetData>): Date | null {
  let oldest: Date | null = null;
  for (const post of posts) {
    const created = post.createdAt;
    if (!oldest || created < oldest) {
      oldest = created;
    }
  }
  return oldest;
}

function subtractOneSecond(value: Date | null): Date | null {
  if (!value) return null;
  return new Date(value.getTime() - 1000);
}
