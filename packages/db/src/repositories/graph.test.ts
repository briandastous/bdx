import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type StartedPostgreSqlContainer,
  PostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Db, IngestKind, UserProfileInput } from "../index.js";
import {
  createDb,
  destroyDb,
  migrateToLatest,
  markFollowersSoftDeleted,
  upsertFollows,
  upsertPosts,
  upsertUserProfile,
} from "../index.js";

async function createIngestEvent(db: Db, ingestKind: IngestKind): Promise<bigint> {
  const row = await db
    .insertInto("ingest_events")
    .values({ ingest_kind: ingestKind })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return row.id;
}

function buildUserProfile(input: {
  id: bigint;
  handle: string;
  ingestEventId: bigint;
}): UserProfileInput {
  return {
    id: input.id,
    handle: input.handle,
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
    ingestEventId: input.ingestEventId,
    ingestKind: "twitterio_api_user_followers",
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

async function resetDb(db: Db): Promise<void> {
  await db.deleteFrom("follows_meta").execute();
  await db.deleteFrom("follows").execute();
  await db.deleteFrom("posts_meta").execute();
  await db.deleteFrom("posts").execute();
  await db.deleteFrom("followers_sync_runs").execute();
  await db.deleteFrom("followings_sync_runs").execute();
  await db.deleteFrom("posts_sync_run_target_users").execute();
  await db.deleteFrom("posts_sync_runs").execute();
  await db.deleteFrom("ingest_events").execute();
  await db.deleteFrom("users_meta").execute();
  await db.deleteFrom("user_handle_history").execute();
  await db.deleteFrom("users").execute();
}

describe("core repositories", () => {
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

  it("revives soft-deleted follow edges on upsert", async () => {
    await upsertFollows(db, [{ targetId: 1n, followerId: 2n }]);
    await markFollowersSoftDeleted(db, { targetUserId: 1n, activeFollowerIds: [] });

    let row = await db
      .selectFrom("follows")
      .select(["is_deleted"])
      .where("target_id", "=", 1n)
      .where("follower_id", "=", 2n)
      .executeTakeFirstOrThrow();
    expect(row.is_deleted).toBe(true);

    await upsertFollows(db, [{ targetId: 1n, followerId: 2n }]);

    row = await db
      .selectFrom("follows")
      .select(["is_deleted"])
      .where("target_id", "=", 1n)
      .where("follower_id", "=", 2n)
      .executeTakeFirstOrThrow();
    expect(row.is_deleted).toBe(false);
  });

  it("revives soft-deleted posts on upsert", async () => {
    await upsertPosts(db, [
      {
        id: 10n,
        authorId: 1n,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "hello",
        lang: "en",
        rawJson: null,
      },
    ]);

    await db.updateTable("posts").set({ is_deleted: true }).where("id", "=", 10n).execute();

    await upsertPosts(db, [
      {
        id: 10n,
        authorId: 1n,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "hello again",
        lang: "en",
        rawJson: null,
      },
    ]);

    const row = await db
      .selectFrom("posts")
      .select(["text", "is_deleted"])
      .where("id", "=", 10n)
      .executeTakeFirstOrThrow();
    expect(row.text).toBe("hello again");
    expect(row.is_deleted).toBe(false);
  });

  it("clears conflicting handles and records handle history", async () => {
    const ingestEventId1 = await createIngestEvent(db, "twitterio_api_user_followers");
    await upsertUserProfile(db, buildUserProfile({ id: 1n, handle: "alpha", ingestEventId: ingestEventId1 }));
    await upsertUserProfile(db, buildUserProfile({ id: 2n, handle: "beta", ingestEventId: ingestEventId1 }));

    const ingestEventId2 = await createIngestEvent(db, "twitterio_api_user_followers");
    await upsertUserProfile(db, buildUserProfile({ id: 2n, handle: "alpha", ingestEventId: ingestEventId2 }));

    const users = await db
      .selectFrom("users")
      .select(["id", "handle"])
      .orderBy("id", "asc")
      .execute();

    expect(users).toEqual([
      { id: 1n, handle: null },
      { id: 2n, handle: "alpha" },
    ]);

    const history = await db
      .selectFrom("user_handle_history")
      .select(["user_id", "previous_handle", "new_handle"])
      .orderBy("id", "asc")
      .execute();

    expect(history).toEqual([
      { user_id: 1n, previous_handle: "alpha", new_handle: "" },
      { user_id: 2n, previous_handle: "beta", new_handle: "alpha" },
    ]);
  });
});
