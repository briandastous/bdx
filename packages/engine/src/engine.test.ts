import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  addPostsSyncRunTargetUsers,
  acquireAdvisoryLock,
  createDb,
  createAssetMaterialization,
  createFollowersSyncRun,
  createPostsSyncRun,
  destroyDb,
  enableAssetInstanceRoot,
  ensureUsers,
  getLatestSuccessfulMaterialization,
  getOrCreateAssetInstance,
  getOrCreateAssetParams,
  insertSegmentEvents,
  migrateToLatest,
  releaseAdvisoryLock,
  replaceSpecifiedUsersInputs,
  updatePostsSyncRun,
  updateAssetMaterialization,
  updateFollowersSyncRun,
  upsertPosts,
  type Db,
} from "@bdx/db";
import { AssetInstanceId, PostId, UserId } from "@bdx/ids";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient } from "@bdx/twitterapi-io";
import { AssetEngine } from "./engine.js";
import type { AssetParams } from "./assets/params.js";
import { PARAMS_HASH_VERSION, paramsHashV1 } from "./assets/params.js";
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

describe("AssetEngine materialization", () => {
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

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  it("materializes specified users segments and records events", async () => {
    const user101 = UserId(101n);
    const user102 = UserId(102n);
    const user103 = UserId(103n);
    await ensureUsers(db, [user101, user102, user103]);

    const params: AssetParams = {
      assetSlug: "segment_specified_users",
      stableKey: "test",
      fanoutSourceParamsHash: null,
    };
    const paramsHash = paramsHashV1(params);
    const paramsRecord = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
      stableKey: params.stableKey,
    });
    const instance = await getOrCreateAssetInstance(db, {
      paramsId: paramsRecord.id,
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
    });

    await replaceSpecifiedUsersInputs(db, {
      instanceId: instance.id,
      userExternalIds: [user101, user102],
    });
    await enableAssetInstanceRoot(db, instance.id);

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.tick(new AbortController().signal);

    const firstMaterialization = await getLatestSuccessfulMaterialization(db, instance.id);
    if (!firstMaterialization) {
      throw new Error("Expected first materialization to exist");
    }
    expect(firstMaterialization.status).toBe("success");
    expect(firstMaterialization.outputRevision).toBe(1n);

    const firstEvents = await db
      .selectFrom("segment_events")
      .select(["user_id", "event_type", "is_first_appearance"])
      .where("materialization_id", "=", firstMaterialization.id)
      .orderBy("user_id", "asc")
      .execute();
    expect(firstEvents).toEqual([
      { user_id: user101, event_type: "enter", is_first_appearance: true },
      { user_id: user102, event_type: "enter", is_first_appearance: true },
    ]);
    const firstSnapshot = await db
      .selectFrom("segment_membership_snapshots")
      .select(["user_id"])
      .where("instance_id", "=", instance.id)
      .orderBy("user_id", "asc")
      .execute();
    expect(firstSnapshot.map((row) => row.user_id)).toEqual([user101, user102]);
    const firstPointer = await db
      .selectFrom("asset_instances")
      .select(["current_membership_materialization_id"])
      .where("id", "=", instance.id)
      .executeTakeFirst();
    expect(firstPointer?.current_membership_materialization_id).toBe(firstMaterialization.id);

    await replaceSpecifiedUsersInputs(db, {
      instanceId: instance.id,
      userExternalIds: [user102, user103],
    });

    await engine.tick(new AbortController().signal);

    const secondMaterialization = await getLatestSuccessfulMaterialization(db, instance.id);
    if (!secondMaterialization) {
      throw new Error("Expected second materialization to exist");
    }
    expect(secondMaterialization.id).not.toEqual(firstMaterialization.id);
    expect(secondMaterialization.outputRevision).toBe(2n);

    const secondEvents = await db
      .selectFrom("segment_events")
      .select(["user_id", "event_type", "is_first_appearance"])
      .where("materialization_id", "=", secondMaterialization.id)
      .orderBy("user_id", "asc")
      .execute();
    expect(secondEvents).toEqual([
      { user_id: user101, event_type: "exit", is_first_appearance: null },
      { user_id: user103, event_type: "enter", is_first_appearance: true },
    ]);
    const secondSnapshot = await db
      .selectFrom("segment_membership_snapshots")
      .select(["user_id"])
      .where("instance_id", "=", instance.id)
      .orderBy("user_id", "asc")
      .execute();
    expect(secondSnapshot.map((row) => row.user_id)).toEqual([user102, user103]);
    const secondPointer = await db
      .selectFrom("asset_instances")
      .select(["current_membership_materialization_id"])
      .where("id", "=", instance.id)
      .executeTakeFirst();
    expect(secondPointer?.current_membership_materialization_id).toBe(secondMaterialization.id);
  });

  it("emits structured logs with materialization IDs", async () => {
    const user201 = UserId(201n);
    const user202 = UserId(202n);
    await ensureUsers(db, [user201, user202]);

    const params: AssetParams = {
      assetSlug: "segment_specified_users",
      stableKey: "logging-test",
      fanoutSourceParamsHash: null,
    };
    const paramsHash = paramsHashV1(params);
    const paramsRecord = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
      stableKey: params.stableKey,
    });
    const instance = await getOrCreateAssetInstance(db, {
      paramsId: paramsRecord.id,
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
    });

    await replaceSpecifiedUsersInputs(db, {
      instanceId: instance.id,
      userExternalIds: [user201, user202],
    });
    await enableAssetInstanceRoot(db, instance.id);

    const output = captureStdout();
    const logger = createLogger({ env: "test", level: "info", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "https://example.test",
      minIntervalMs: 0,
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.materializeInstanceById(instance.id);
    await new Promise((resolve) => setImmediate(resolve));

    output.restore();
    const logs = parseLogEntries(output.read());
    const completed = logs.find((entry) => entry["msg"] === "Materialization completed");
    if (!completed) {
      throw new Error("Expected structured log entry for materialization completion");
    }
    expect(completed["service"]).toBe("engine-test");
    expect(completed["env"]).toBe("test");
    expect(completed["asset_instance_id"]).toBe(instance.id.toString());
    expect(typeof completed["materialization_id"]).toBe("string");
  });

  it("repairs checkpoints when membership pointers are missing", async () => {
    const user201 = UserId(201n);
    await ensureUsers(db, [user201]);

    const params: AssetParams = {
      assetSlug: "segment_specified_users",
      stableKey: "checkpoint",
      fanoutSourceParamsHash: null,
    };
    const paramsHash = paramsHashV1(params);
    const paramsRecord = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
      stableKey: params.stableKey,
    });
    const instance = await getOrCreateAssetInstance(db, {
      paramsId: paramsRecord.id,
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
    });

    const materialization = await createAssetMaterialization(db, {
      assetInstanceId: instance.id,
      assetSlug: "segment_specified_users",
      inputsHashVersion: 1,
      inputsHash: "checkpoint-inputs",
      dependencyRevisionsHashVersion: 1,
      dependencyRevisionsHash: "checkpoint-deps",
      triggerReason: "checkpoint",
    });
    await insertSegmentEvents(db, materialization.id, [
      { userId: user201, eventType: "enter", isFirstAppearance: true },
    ]);
    await updateAssetMaterialization(db, materialization.id, {
      status: "success",
      completedAt: new Date("2024-01-01T00:00:00Z"),
      outputRevision: 1n,
      errorPayload: null,
    });

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.materializeInstanceById(instance.id, { triggerReason: "checkpoint" });

    const event = await db
      .selectFrom("scheduler_planner_events")
      .select(["decision", "target_id"])
      .where("decision", "=", "checkpoint_repair")
      .where("target_id", "=", instance.id.toString())
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();

    expect(event.decision).toBe("checkpoint_repair");
  });

  it("materializes post corpora from segment membership", async () => {
    const member901 = UserId(901n);
    const member902 = UserId(902n);
    const members = [member901, member902];
    await ensureUsers(db, members);

    const post9001 = PostId(9001n);
    const post9002 = PostId(9002n);
    await upsertPosts(db, [
      {
        id: post9001,
        authorId: member901,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "First post",
        lang: null,
        rawJson: null,
      },
      {
        id: post9002,
        authorId: member902,
        postedAt: new Date("2024-01-02T00:00:00Z"),
        text: "Second post",
        lang: null,
        rawJson: null,
      },
    ]);

    const postsRun = await createPostsSyncRun(db, {
      ingestKind: "twitterio_api_users_posts",
    });
    await addPostsSyncRunTargetUsers(db, postsRun.id, members);
    await updatePostsSyncRun(db, postsRun.id, {
      status: "success",
      completedAt: new Date(),
      cursorExhausted: true,
      syncedSince: new Date("2024-01-01T00:00:00Z"),
    });

    const segmentParams: AssetParams = {
      assetSlug: "segment_specified_users",
      stableKey: "post-corpus-members",
      fanoutSourceParamsHash: null,
    };
    const segmentParamsHash = paramsHashV1(segmentParams);
    const segmentParamsRecord = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash: segmentParamsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
      stableKey: segmentParams.stableKey,
    });
    const segmentInstance = await getOrCreateAssetInstance(db, {
      paramsId: segmentParamsRecord.id,
      assetSlug: "segment_specified_users",
      paramsHash: segmentParamsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
    });

    await replaceSpecifiedUsersInputs(db, {
      instanceId: segmentInstance.id,
      userExternalIds: members,
    });
    await enableAssetInstanceRoot(db, segmentInstance.id);

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.tick(new AbortController().signal);

    const segmentMaterialization = await getLatestSuccessfulMaterialization(db, segmentInstance.id);
    expect(segmentMaterialization?.status).toBe("success");

    const postCorpusParams: AssetParams = {
      assetSlug: "post_corpus_for_segment",
      sourceSegmentParams: segmentParams,
      fanoutSourceParamsHash: null,
    };

    const postCorpusOutcome = await engine.materializeParams(postCorpusParams);
    expect(postCorpusOutcome.status).toBe("success");
    expect(postCorpusOutcome.materializationId).not.toBeNull();
    if (!postCorpusOutcome.materializationId) {
      throw new Error("Expected post corpus materialization id");
    }

    const snapshot = await db
      .selectFrom("post_corpus_membership_snapshots")
      .select(["post_id"])
      .where("instance_id", "=", postCorpusOutcome.instanceId)
      .orderBy("post_id", "asc")
      .execute();
    expect(snapshot.map((row) => row.post_id)).toEqual([post9001, post9002]);

    const events = await db
      .selectFrom("post_corpus_events")
      .select(["post_id", "event_type", "is_first_appearance"])
      .where("materialization_id", "=", postCorpusOutcome.materializationId)
      .orderBy("post_id", "asc")
      .execute();
    expect(events).toEqual([
      { post_id: post9001, event_type: "enter", is_first_appearance: true },
      { post_id: post9002, event_type: "enter", is_first_appearance: true },
    ]);
  });

  it("records planner decisions when instances are missing", async () => {
    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    const missingInstanceId = AssetInstanceId(999999n);
    const outcome = await engine.materializeInstanceById(missingInstanceId, {
      triggerReason: "test",
    });

    expect(outcome.instanceId).toBe(missingInstanceId);
    expect(outcome.materializationId).toBeNull();
    expect(outcome.status).toBe("error");

    const event = await db
      .selectFrom("scheduler_planner_events")
      .select(["decision", "target_id"])
      .where("decision", "=", "instance_missing")
      .where("target_id", "=", missingInstanceId.toString())
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();

    expect(event.decision).toBe("instance_missing");
    expect(event.target_id).toBe(missingInstanceId.toString());
  });

  it("records lock timeout decisions when materialization locks are held", async () => {
    const params: AssetParams = {
      assetSlug: "segment_specified_users",
      stableKey: "lock-test",
      fanoutSourceParamsHash: null,
    };
    const paramsHash = paramsHashV1(params);
    const paramsRecord = await getOrCreateAssetParams(db, {
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
      stableKey: params.stableKey,
    });
    const instance = await getOrCreateAssetInstance(db, {
      paramsId: paramsRecord.id,
      assetSlug: "segment_specified_users",
      paramsHash,
      paramsHashVersion: PARAMS_HASH_VERSION,
    });

    const lockDb = createDb(container.getConnectionUri());
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = () => {
        resolve();
      };
    });
    let lockReady: (() => void) | undefined;
    const lockReadyPromise = new Promise<void>((resolve) => {
      lockReady = () => {
        resolve();
      };
    });

    const lockTask = lockDb.transaction().execute(async (trx) => {
      const acquired = await acquireAdvisoryLock(trx, instance.id, { timeoutMs: 1000 });
      expect(acquired).toBe(true);
      lockReady?.();
      await holdLock;
      await releaseAdvisoryLock(trx, instance.id);
    });

    await lockReadyPromise;

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
      lockTimeoutMs: 50,
    });

    const outcome = await engine.materializeInstanceById(instance.id, {
      triggerReason: "lock-test",
    });
    expect(outcome.status).toBe("error");
    expect(outcome.materializationId).toBeNull();

    const event = await db
      .selectFrom("scheduler_planner_events")
      .select(["decision", "target_id"])
      .where("decision", "=", "lock_timeout")
      .where("target_id", "=", instance.id.toString())
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
    expect(event.decision).toBe("lock_timeout");

    releaseLock?.();
    await lockTask;
    await destroyDb(lockDb);
  });

  it("uses incremental follower syncs after a full refresh exists", async () => {
    const targetUserId = UserId(42n);
    await ensureUsers(db, [targetUserId]);

    const fullRun = await createFollowersSyncRun(db, {
      targetUserId,
      ingestKind: "twitterio_api_user_followers",
      syncMode: "full_refresh",
    });
    await updateFollowersSyncRun(db, fullRun.id, {
      status: "success",
      completedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      cursorExhausted: true,
      lastApiStatus: "200",
      lastApiError: null,
    });

    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "https://example.test",
      minIntervalMs: 0,
      fetch: (input) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        if (url.pathname === "/twitter/user/batch_info_by_ids") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                users: [{ id: targetUserId.toString(), userName: "target", name: "Target" }],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.pathname === "/twitter/user/followers") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                followers: [{ id: "100", userName: "follower", name: "Follower" }],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.materializeParams({
      assetSlug: "segment_followers",
      subjectExternalId: targetUserId,
      fanoutSourceParamsHash: null,
    });

    const latestRun = await db
      .selectFrom("followers_sync_runs")
      .select(["sync_mode"])
      .where("target_user_id", "=", targetUserId)
      .orderBy("ingest_event_id", "desc")
      .limit(1)
      .executeTakeFirstOrThrow();

    expect(latestRun.sync_mode).toBe("incremental");
  });

  it("materializes dependency closures for mutuals segments", async () => {
    const subjectUserId = UserId(77n);
    await ensureUsers(db, [subjectUserId]);

    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "https://example.test",
      minIntervalMs: 0,
      fetch: (input) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        if (url.pathname === "/twitter/user/batch_info_by_ids") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                users: [{ id: subjectUserId.toString(), userName: "subject", name: "Subject" }],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.pathname === "/twitter/user/followers") {
          return Promise.resolve(
            new Response(JSON.stringify({ followers: [], next_cursor: null }), { status: 200 }),
          );
        }
        if (url.pathname === "/twitter/user/followings") {
          return Promise.resolve(
            new Response(JSON.stringify({ followings: [], next_cursor: null }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    await engine.materializeParams({
      assetSlug: "segment_mutuals",
      subjectExternalId: subjectUserId,
      fanoutSourceParamsHash: null,
    });

    const mutuals = await db
      .selectFrom("asset_materializations")
      .select(["id"])
      .where("asset_slug", "=", "segment_mutuals")
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();

    const deps = await db
      .selectFrom("asset_materialization_dependencies")
      .select(["dependency_materialization_id"])
      .where("materialization_id", "=", mutuals.id)
      .orderBy("dependency_materialization_id", "asc")
      .execute();

    expect(deps.length).toBe(2);
  });

  it("records ingest lock timeouts when follower syncs are locked", async () => {
    const targetUserId = UserId(505n);
    await ensureUsers(db, [targetUserId]);

    const lockDb = createDb(container.getConnectionUri());
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = () => {
        resolve();
      };
    });
    let lockReady: (() => void) | undefined;
    const lockReadyPromise = new Promise<void>((resolve) => {
      lockReady = () => {
        resolve();
      };
    });

    const lockTask = lockDb.connection().execute(async (conn) => {
      const acquired = await acquireAdvisoryLock(
        conn,
        `ingest:followers:${targetUserId.toString()}`,
        {
          timeoutMs: 1000,
        },
      );
      expect(acquired).toBe(true);
      lockReady?.();
      await holdLock;
      await releaseAdvisoryLock(conn, `ingest:followers:${targetUserId.toString()}`);
    });

    await lockReadyPromise;

    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "https://example.test",
      minIntervalMs: 0,
      fetch: (input) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        if (url.pathname === "/twitter/user/batch_info_by_ids") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                users: [{ id: targetUserId.toString(), userName: "target", name: "Target" }],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.pathname === "/twitter/user/followers") {
          return Promise.resolve(
            new Response(JSON.stringify({ followers: [], next_cursor: null }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
      lockTimeoutMs: 50,
    });

    const outcome = await engine.materializeParams({
      assetSlug: "segment_followers",
      subjectExternalId: targetUserId,
      fanoutSourceParamsHash: null,
    });

    expect(outcome.status).toBe("error");

    const event = await db
      .selectFrom("scheduler_planner_events")
      .select(["decision", "target_id"])
      .where("decision", "=", "ingest_lock_timeout")
      .where("target_id", "=", targetUserId.toString())
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();

    expect(event.decision).toBe("ingest_lock_timeout");

    releaseLock?.();
    await lockTask;
    await destroyDb(lockDb);
  });

  it("records validation warnings for empty specified-user inputs", async () => {
    const logger = createLogger({ env: "test", level: "silent", service: "engine-test" });
    const twitterClient = new TwitterApiClient({
      token: "test-token",
      baseUrl: "http://localhost",
    });
    const engine = new AssetEngine({
      db,
      logger,
      twitterClient,
      postsMaxQueryLength: 512,
    });

    const outcome = await engine.materializeParams({
      assetSlug: "segment_specified_users",
      stableKey: "empty-inputs",
      fanoutSourceParamsHash: null,
    });

    const event = await db
      .selectFrom("scheduler_planner_events")
      .select(["decision", "target_id"])
      .where("decision", "=", "validation_warning")
      .where("target_id", "=", outcome.instanceId.toString())
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();

    expect(event.decision).toBe("validation_warning");
  });
});
