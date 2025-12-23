import { Buffer } from "node:buffer";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, destroyDb, migrateToLatest, upsertFollows, type Db } from "@bdx/db";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient, type JsonValue } from "@bdx/twitterapi-io";
import { PostId, UserId } from "@bdx/ids";
import { FollowersSyncService } from "./followers.js";
import { FollowingsSyncService } from "./followings.js";
import { PostsSyncService } from "./posts.js";

type FixtureResponse = {
  path: string;
  body: JsonValue;
  status?: number;
};

function createFixtureFetch(responses: FixtureResponse[]): typeof fetch {
  const queue = [...responses];
  return (input) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(requestUrl);
    const next = queue.shift();
    if (!next) {
      throw new Error(`No fixture response remaining for ${url.pathname}`);
    }
    if (next.path !== url.pathname) {
      throw new Error(`Expected fixture for ${next.path}, got ${url.pathname}`);
    }
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function createClientWithFixtures(responses: FixtureResponse[]): TwitterApiClient {
  return new TwitterApiClient({
    token: "test-token",
    baseUrl: "https://example.test",
    minIntervalMs: 0,
    fetch: createFixtureFetch(responses),
  });
}

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("follows_meta").execute();
  await db.deleteFrom("follows").execute();
  await db.deleteFrom("posts_meta").execute();
  await db.deleteFrom("posts").execute();
  await db.deleteFrom("posts_sync_run_target_users").execute();
  await db.deleteFrom("posts_sync_runs").execute();
  await db.deleteFrom("followers_sync_runs").execute();
  await db.deleteFrom("followings_sync_runs").execute();
  await db.deleteFrom("ingest_events").execute();
  await db.deleteFrom("users_meta").execute();
  await db.deleteFrom("user_handle_history").execute();
  await db.deleteFrom("users").execute();
}

function assertJsonObject(value: JsonValue | null): asserts value is Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object");
  }
}

type LogEntry = Record<string, unknown>;

function isLogEntry(value: unknown): value is LogEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLogEntries(buffer: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = buffer.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isLogEntry(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return entries;
}

function captureStdout() {
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(
      (chunk: string | Uint8Array, _encoding?: unknown, cb?: (err?: Error) => void) => {
        if (typeof chunk === "string") {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk).toString("utf8"));
        }
        if (typeof cb === "function") cb();
        return true;
      },
    );

  return {
    read: () => chunks.join(""),
    restore: () => {
      write.mockRestore();
    },
  };
}

describe("ingest services", () => {
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

  it("soft deletes missing followers on full refresh", async () => {
    const targetUserId = UserId(1n);
    const followerId = UserId(10n);
    const missingFollowerId = UserId(20n);
    await upsertFollows(db, [
      { targetId: targetUserId, followerId },
      { targetId: targetUserId, followerId: missingFollowerId },
    ]);

    const client = createClientWithFixtures([
      {
        path: "/twitter/user/batch_info_by_ids",
        body: { users: [{ id: "1", userName: "target", name: "Target" }] },
      },
      {
        path: "/twitter/user/followers",
        body: {
          followers: [{ id: "10", userName: "follower", name: "Follower" }],
          next_cursor: null,
        },
      },
    ]);

    const logger = createLogger({ env: "test", level: "silent", service: "ingest-test" });
    const service = new FollowersSyncService({ db, logger, client });
    const result = await service.syncFollowersFull({ targetUserId });

    const rows = await db
      .selectFrom("follows")
      .select(["follower_id", "is_deleted"])
      .where("target_id", "=", targetUserId)
      .orderBy("follower_id", "asc")
      .execute();

    expect(rows).toEqual([
      { follower_id: followerId, is_deleted: false },
      { follower_id: missingFollowerId, is_deleted: true },
    ]);

    const run = await db
      .selectFrom("followers_sync_runs")
      .select([
        "status",
        "cursor_exhausted",
        "last_api_status",
        "last_http_request",
        "last_http_response",
      ])
      .where("ingest_event_id", "=", result.syncRunId)
      .executeTakeFirstOrThrow();

    expect(run.status).toBe("success");
    expect(run.cursor_exhausted).toBe(true);
    expect(run.last_api_status).toBe("200");
    expect(run.last_http_request).toBeNull();
    expect(run.last_http_response).toBeNull();

    const followMeta = await db
      .selectFrom("follows_meta")
      .select(["target_id", "follower_id", "ingest_event_id"])
      .orderBy("target_id", "asc")
      .orderBy("follower_id", "asc")
      .execute();
    expect(followMeta).toEqual([
      { target_id: targetUserId, follower_id: followerId, ingest_event_id: result.syncRunId },
    ]);

    const userMeta = await db
      .selectFrom("users_meta")
      .select(["user_id", "ingest_event_id"])
      .orderBy("user_id", "asc")
      .execute();
    expect(userMeta).toEqual([
      { user_id: targetUserId, ingest_event_id: result.syncRunId },
      { user_id: followerId, ingest_event_id: result.syncRunId },
    ]);
  });

  it("records truncated http response bodies on failures", async () => {
    const targetUserId = UserId(1n);
    const largePayload = { error: "x".repeat(5000) };
    const client = createClientWithFixtures([
      {
        path: "/twitter/user/batch_info_by_ids",
        body: { users: [{ id: "1", userName: "target", name: "Target" }] },
      },
      {
        path: "/twitter/user/followers",
        body: largePayload,
        status: 500,
      },
    ]);

    const logger = createLogger({ env: "test", level: "silent", service: "ingest-test" });
    const service = new FollowersSyncService({
      db,
      logger,
      client,
      httpSnapshotMaxBytes: 64,
    });

    await expect(service.syncFollowersFull({ targetUserId })).rejects.toThrow();

    const run = await db
      .selectFrom("followers_sync_runs")
      .select(["status", "last_http_request", "last_http_response"])
      .orderBy("ingest_event_id", "desc")
      .executeTakeFirstOrThrow();

    expect(run.status).toBe("error");
    expect(run.last_http_request).not.toBeNull();
    expect(run.last_http_response).not.toBeNull();

    assertJsonObject(run.last_http_response);
    const body = run.last_http_response["body"];
    expect(typeof body).toBe("string");
    if (typeof body === "string") {
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("does not soft delete missing followings on incremental sync", async () => {
    const sourceUserId = UserId(1n);
    const followedId = UserId(10n);
    const missingFollowedId = UserId(20n);
    await upsertFollows(db, [
      { targetId: followedId, followerId: sourceUserId },
      { targetId: missingFollowedId, followerId: sourceUserId },
    ]);

    const client = createClientWithFixtures([
      {
        path: "/twitter/user/batch_info_by_ids",
        body: { users: [{ id: "1", userName: "source", name: "Source" }] },
      },
      {
        path: "/twitter/user/followings",
        body: {
          followings: [{ id: "10", userName: "followed", name: "Followed" }],
          next_cursor: null,
        },
      },
    ]);

    const logger = createLogger({ env: "test", level: "silent", service: "ingest-test" });
    const service = new FollowingsSyncService({ db, logger, client });
    const result = await service.syncFollowingsIncremental({ sourceUserId });

    const rows = await db
      .selectFrom("follows")
      .select(["target_id", "is_deleted"])
      .where("follower_id", "=", sourceUserId)
      .orderBy("target_id", "asc")
      .execute();

    expect(rows).toEqual([
      { target_id: followedId, is_deleted: false },
      { target_id: missingFollowedId, is_deleted: false },
    ]);

    const run = await db
      .selectFrom("followings_sync_runs")
      .select(["status", "cursor_exhausted", "last_api_status"])
      .where("ingest_event_id", "=", result.syncRunId)
      .executeTakeFirstOrThrow();

    expect(run.status).toBe("success");
    expect(run.cursor_exhausted).toBe(true);
    expect(run.last_api_status).toBe("200");

    const followMeta = await db
      .selectFrom("follows_meta")
      .select(["target_id", "follower_id", "ingest_event_id"])
      .orderBy("target_id", "asc")
      .orderBy("follower_id", "asc")
      .execute();
    expect(followMeta).toEqual([
      { target_id: followedId, follower_id: sourceUserId, ingest_event_id: result.syncRunId },
    ]);

    const userMeta = await db
      .selectFrom("users_meta")
      .select(["user_id", "ingest_event_id"])
      .orderBy("user_id", "asc")
      .execute();
    expect(userMeta).toEqual([
      { user_id: sourceUserId, ingest_event_id: result.syncRunId },
      { user_id: followedId, ingest_event_id: result.syncRunId },
    ]);
  });

  it("emits structured logs for ingest runs", async () => {
    const targetUserId = UserId(1n);
    const client = createClientWithFixtures([
      {
        path: "/twitter/user/batch_info_by_ids",
        body: { users: [{ id: "1", userName: "target", name: "Target" }] },
      },
      {
        path: "/twitter/user/followers",
        body: {
          followers: [{ id: "10", userName: "follower", name: "Follower" }],
          next_cursor: null,
        },
      },
    ]);

    const output = captureStdout();
    const logger = createLogger({ env: "test", level: "info", service: "ingest-test" });
    const service = new FollowersSyncService({ db, logger, client });
    await service.syncFollowersFull({ targetUserId });

    await new Promise((resolve) => setImmediate(resolve));
    output.restore();
    const logs = parseLogEntries(output.read());
    const start = logs.find((entry) => entry["msg"] === "Starting graph sync");
    if (!start) {
      throw new Error("Expected structured log entry for ingest start");
    }
    expect(start["service"]).toBe("ingest-test");
    expect(start["env"]).toBe("test");
    expect(typeof start["run_id"]).toBe("string");
    expect(typeof start["ingestKind"]).toBe("string");
  });

  it("writes posts and run metadata using mocked twitter responses", async () => {
    const authorUserId = UserId(1n);
    const postId = PostId(500n);
    const client = createClientWithFixtures([
      {
        path: "/twitter/user/batch_info_by_ids",
        body: { users: [{ id: "1", userName: "author", name: "Author" }] },
      },
      {
        path: "/twitter/tweet/advanced_search",
        body: {
          tweets: [
            {
              id: "500",
              text: "Hello world",
              createdAt: "2024-01-01T00:00:00Z",
              author: { id: "1" },
            },
          ],
          next_cursor: null,
        },
      },
    ]);

    const logger = createLogger({ env: "test", level: "silent", service: "ingest-test" });
    const service = new PostsSyncService({
      db,
      logger,
      client,
      maxQueryLength: 1024,
    });

    const result = await service.syncPostsFull({ userIds: [authorUserId] });

    const posts = await db
      .selectFrom("posts")
      .select(["id", "author_id"])
      .orderBy("id", "asc")
      .execute();

    expect(posts).toEqual([{ id: postId, author_id: authorUserId }]);
    expect(result.postIds).toEqual([postId]);

    const run = await db
      .selectFrom("posts_sync_runs")
      .select([
        "status",
        "cursor_exhausted",
        "last_api_status",
        "last_http_request",
        "last_http_response",
      ])
      .where("ingest_event_id", "=", result.syncRunId)
      .executeTakeFirstOrThrow();

    expect(run.status).toBe("success");
    expect(run.cursor_exhausted).toBe(true);
    expect(run.last_api_status).toBe("200");
    expect(run.last_http_request).toBeNull();
    expect(run.last_http_response).toBeNull();

    const postMeta = await db
      .selectFrom("posts_meta")
      .select(["post_id", "ingest_event_id"])
      .orderBy("post_id", "asc")
      .execute();
    expect(postMeta).toEqual([{ post_id: postId, ingest_event_id: result.syncRunId }]);

    const userMeta = await db
      .selectFrom("users_meta")
      .select(["user_id", "ingest_event_id"])
      .orderBy("user_id", "asc")
      .execute();
    expect(userMeta).toEqual([{ user_id: authorUserId, ingest_event_id: result.syncRunId }]);
  });
});
