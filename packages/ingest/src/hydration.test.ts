import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  destroyDb,
  migrateToLatest,
  upsertPosts,
  upsertUserProfile,
  type Db,
  type IngestKind,
  type PostInput,
  type UserProfileInput,
} from "@bdx/db";
import { IngestEventId, PostId, UserId } from "@bdx/ids";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient } from "@bdx/twitterapi-io";
import { PostsByIdsIngestService, UsersByIdsIngestService } from "./hydration.js";

async function createIngestEvent(db: Db, ingestKind: IngestKind): Promise<IngestEventId> {
  const row = await db
    .insertInto("ingest_events")
    .values({ ingest_kind: ingestKind })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return IngestEventId(row.id);
}

function buildUserProfileInput(params: {
  id: UserId;
  handle: string;
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
}): UserProfileInput {
  return {
    id: params.id,
    handle: params.handle,
    displayName: null,
    profileUrl: null,
    profileImageUrl: null,
    coverImageUrl: null,
    bio: null,
    location: null,
    isBlueVerified: null,
    verifiedType: null,
    isTranslator: null,
    isAutomated: null,
    automatedBy: null,
    possiblySensitive: null,
    unavailable: null,
    unavailableMessage: null,
    unavailableReason: null,
    followersCount: null,
    followingCount: null,
    favouritesCount: null,
    mediaCount: null,
    statusesCount: null,
    userCreatedAt: null,
    bioEntities: null,
    affiliatesHighlightedLabel: null,
    pinnedTweetIds: null,
    withheldCountries: null,
    ingestEventId: params.ingestEventId,
    ingestKind: params.ingestKind,
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

async function seedUser(db: Db, userId: UserId): Promise<void> {
  const ingestEventId = await createIngestEvent(db, "twitterio_api_users_by_ids");
  await upsertUserProfile(
    db,
    buildUserProfileInput({
      id: userId,
      handle: `user${userId.toString()}`,
      ingestEventId,
      ingestKind: "twitterio_api_users_by_ids",
    }),
  );
}

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("posts_by_ids_ingest_run_requested_posts").execute();
  await db.deleteFrom("posts_by_ids_ingest_runs").execute();
  await db.deleteFrom("users_by_ids_ingest_run_requested_users").execute();
  await db.deleteFrom("users_by_ids_ingest_runs").execute();
  await db.deleteFrom("posts_meta").execute();
  await db.deleteFrom("posts").execute();
  await db.deleteFrom("users_meta").execute();
  await db.deleteFrom("user_handle_history").execute();
  await db.deleteFrom("users").execute();
  await db.deleteFrom("ingest_events").execute();
}

describe("by-ids ingest services", () => {
  let container: StartedPostgreSqlContainer;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18")
      .withDatabase("bdx_test")
      .withUsername("bdx")
      .withPassword("bdx")
      .start();
    db = createDb(container.getConnectionUri());
    await migrateToLatest(db);
  });

  beforeEach(async () => {
    await resetDb(db);
  });

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  describe("UsersByIdsIngestService", () => {
    it("skips ingest when all users already exist", async () => {
      const userId = UserId(1n);
      await seedUser(db, userId);

      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () => {
          throw new Error("Unexpected upstream call");
        },
      });
      const service = new UsersByIdsIngestService({ db, logger, client, batchSize: 100 });

      const beforeEvents = await db.selectFrom("ingest_events").select(["id"]).execute();
      const result = await service.ingestUsersByIds({ userIds: [userId] });
      const afterEvents = await db.selectFrom("ingest_events").select(["id"]).execute();

      expect(result.ingestEventId).toBeNull();
      expect(result.ingestedUserIds).toHaveLength(0);
      expect(result.skippedUserIds).toEqual([userId]);
      expect(afterEvents).toHaveLength(beforeEvents.length);

      const runs = await db
        .selectFrom("users_by_ids_ingest_runs")
        .select(["ingest_event_id"])
        .execute();
      expect(runs).toHaveLength(0);
    });

    it("splits requests based on batch size", async () => {
      const userIds = [UserId(1n), UserId(2n)];
      const calls: string[] = [];

      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: (input) => {
          const requestUrl =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          const url = new URL(requestUrl);
          if (url.pathname !== "/twitter/user/batch_info_by_ids") {
            throw new Error(`Unexpected path: ${url.pathname}`);
          }
          const param = url.searchParams.get("userIds") ?? "";
          calls.push(param);
          const users = param
            .split(",")
            .filter((entry) => entry.length > 0)
            .map((id) => ({ id, userName: `user${id}`, name: `User ${id}` }));
          return Promise.resolve(new Response(JSON.stringify({ users }), { status: 200 }));
        },
      });

      const service = new UsersByIdsIngestService({ db, logger, client, batchSize: 1 });
      await service.ingestUsersByIds({ userIds });

      expect(calls).toEqual(["1", "2"]);

      const users = await db.selectFrom("users").select(["id"]).orderBy("id", "asc").execute();
      expect(users).toEqual([{ id: 1n }, { id: 2n }]);
    });

    it("fails when a requested user is missing from the response", async () => {
      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ users: [{ id: "1", userName: "one", name: "One" }] }), {
              status: 200,
            }),
          ),
      });
      const service = new UsersByIdsIngestService({ db, logger, client, batchSize: 100 });

      await expect(
        service.ingestUsersByIds({ userIds: [UserId(1n), UserId(2n)] }),
      ).rejects.toThrow();

      const users = await db.selectFrom("users").select(["id"]).execute();
      expect(users).toHaveLength(0);

      const run = await db
        .selectFrom("users_by_ids_ingest_runs")
        .select(["status", "last_http_response"])
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("error");
      expect(run.last_http_response).not.toBeNull();
    });

    it("records upstream failure metadata", async () => {
      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () =>
          Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
      });
      const service = new UsersByIdsIngestService({ db, logger, client, batchSize: 100 });

      await expect(service.ingestUsersByIds({ userIds: [UserId(1n)] })).rejects.toThrow();

      const run = await db
        .selectFrom("users_by_ids_ingest_runs")
        .select(["status", "last_api_status", "last_http_response"])
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("error");
      expect(run.last_api_status).not.toBeNull();
      expect(run.last_http_response).not.toBeNull();
    });
  });

  describe("PostsByIdsIngestService", () => {
    it("skips ingest when all posts already exist", async () => {
      const authorId = UserId(99n);
      const postId = PostId(123n);
      await seedUser(db, authorId);
      const post: PostInput = {
        id: postId,
        authorId,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "existing",
        lang: null,
        rawJson: null,
      };
      await upsertPosts(db, [post]);

      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () => {
          throw new Error("Unexpected upstream call");
        },
      });
      const service = new PostsByIdsIngestService({ db, logger, client, batchSize: 100 });

      const beforeEvents = await db.selectFrom("ingest_events").select(["id"]).execute();
      const result = await service.ingestPostsByIds({ postIds: [postId] });
      const afterEvents = await db.selectFrom("ingest_events").select(["id"]).execute();

      expect(result.ingestEventId).toBeNull();
      expect(result.ingestedPostIds).toHaveLength(0);
      expect(result.skippedPostIds).toEqual([postId]);
      expect(afterEvents).toHaveLength(beforeEvents.length);

      const runs = await db
        .selectFrom("posts_by_ids_ingest_runs")
        .select(["ingest_event_id"])
        .execute();
      expect(runs).toHaveLength(0);
    });

    it("splits post requests based on batch size", async () => {
      const calls: string[] = [];
      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: (input) => {
          const requestUrl =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          const url = new URL(requestUrl);
          if (url.pathname !== "/twitter/tweets") {
            throw new Error(`Unexpected path: ${url.pathname}`);
          }
          const param = url.searchParams.get("tweet_ids") ?? "";
          calls.push(param);
          const posts = param
            .split(",")
            .filter((entry) => entry.length > 0)
            .map((id, index) => ({
              id,
              text: `post ${id}`,
              createdAt: "2024-01-01T00:00:00Z",
              author: {
                id: String(100 + index),
                userName: `author${100 + index}`,
                name: `Author ${100 + index}`,
              },
            }));
          return Promise.resolve(new Response(JSON.stringify({ tweets: posts }), { status: 200 }));
        },
      });
      const service = new PostsByIdsIngestService({ db, logger, client, batchSize: 1 });

      await service.ingestPostsByIds({ postIds: [PostId(1n), PostId(2n)] });

      expect(calls).toEqual(["1", "2"]);

      const posts = await db.selectFrom("posts").select(["id"]).orderBy("id", "asc").execute();
      expect(posts).toEqual([{ id: 1n }, { id: 2n }]);
    });

    it("fails when a requested post is missing from the response", async () => {
      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                tweets: [
                  {
                    id: "1",
                    text: "post 1",
                    createdAt: "2024-01-01T00:00:00Z",
                    author: { id: "10", userName: "author10", name: "Author 10" },
                  },
                ],
              }),
              { status: 200 },
            ),
          ),
      });
      const service = new PostsByIdsIngestService({ db, logger, client, batchSize: 100 });

      await expect(
        service.ingestPostsByIds({ postIds: [PostId(1n), PostId(2n)] }),
      ).rejects.toThrow();

      const posts = await db.selectFrom("posts").select(["id"]).execute();
      expect(posts).toHaveLength(0);

      const run = await db
        .selectFrom("posts_by_ids_ingest_runs")
        .select(["status", "last_http_response"])
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("error");
      expect(run.last_http_response).not.toBeNull();
    });

    it("records upstream failure metadata", async () => {
      const logger = createLogger({ env: "test", level: "silent", service: "hydration-test" });
      const client = new TwitterApiClient({
        token: "test-token",
        baseUrl: "http://localhost",
        minIntervalMs: 0,
        fetch: () =>
          Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
      });
      const service = new PostsByIdsIngestService({ db, logger, client, batchSize: 100 });

      await expect(service.ingestPostsByIds({ postIds: [PostId(1n)] })).rejects.toThrow();

      const run = await db
        .selectFrom("posts_by_ids_ingest_runs")
        .select(["status", "last_api_status", "last_http_response"])
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("error");
      expect(run.last_api_status).not.toBeNull();
      expect(run.last_http_response).not.toBeNull();
    });
  });
});
