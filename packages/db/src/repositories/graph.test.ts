import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
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
import { IngestEventId, PostId, UserId } from "@bdx/ids";

async function createIngestEvent(db: Db, ingestKind: IngestKind): Promise<IngestEventId> {
  const row = await db
    .insertInto("ingest_events")
    .values({ ingest_kind: ingestKind })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return IngestEventId(row.id);
}

function buildUserProfile(input: {
  id: UserId;
  handle: string;
  ingestEventId: IngestEventId;
  ingestKind?: IngestKind;
}): UserProfileInput {
  const ingestKind = input.ingestKind ?? "twitterio_api_user_followers";
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
    ingestKind,
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

async function seedUsers(db: Db, userIds: UserId[]): Promise<void> {
  if (userIds.length === 0) return;
  const ingestEventId = await createIngestEvent(db, "twitterio_api_users_by_ids");
  for (const userId of userIds) {
    await upsertUserProfile(
      db,
      buildUserProfile({
        id: userId,
        handle: `user${userId.toString()}`,
        ingestEventId,
        ingestKind: "twitterio_api_users_by_ids",
      }),
    );
  }
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

  it("fails to upsert follows when users are missing", async () => {
    const targetId = UserId(1n);
    const followerId = UserId(2n);
    await expect(upsertFollows(db, [{ targetId, followerId }])).rejects.toThrow();
  });

  it("fails to upsert posts when the author is missing", async () => {
    const authorId = UserId(1n);
    const postId = PostId(10n);
    await expect(
      upsertPosts(db, [
        {
          id: postId,
          authorId,
          postedAt: new Date("2024-01-01T00:00:00Z"),
          text: "hello",
          lang: "en",
          rawJson: null,
        },
      ]),
    ).rejects.toThrow();
  });

  it("revives soft-deleted follow edges on upsert", async () => {
    const targetId = UserId(1n);
    const followerId = UserId(2n);
    await seedUsers(db, [targetId, followerId]);
    await upsertFollows(db, [{ targetId, followerId }]);
    await markFollowersSoftDeleted(db, { targetUserId: targetId, activeFollowerIds: [] });

    let row = await db
      .selectFrom("follows")
      .select(["is_deleted"])
      .where("target_id", "=", targetId)
      .where("follower_id", "=", followerId)
      .executeTakeFirstOrThrow();
    expect(row.is_deleted).toBe(true);

    await upsertFollows(db, [{ targetId, followerId }]);

    row = await db
      .selectFrom("follows")
      .select(["is_deleted"])
      .where("target_id", "=", targetId)
      .where("follower_id", "=", followerId)
      .executeTakeFirstOrThrow();
    expect(row.is_deleted).toBe(false);
  });

  it("revives soft-deleted posts on upsert", async () => {
    const postId = PostId(10n);
    const authorId = UserId(1n);
    await seedUsers(db, [authorId]);
    await upsertPosts(db, [
      {
        id: postId,
        authorId,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "hello",
        lang: "en",
        rawJson: null,
      },
    ]);

    await db.updateTable("posts").set({ is_deleted: true }).where("id", "=", postId).execute();

    await upsertPosts(db, [
      {
        id: postId,
        authorId,
        postedAt: new Date("2024-01-01T00:00:00Z"),
        text: "hello again",
        lang: "en",
        rawJson: null,
      },
    ]);

    const row = await db
      .selectFrom("posts")
      .select(["text", "is_deleted"])
      .where("id", "=", postId)
      .executeTakeFirstOrThrow();
    expect(row.text).toBe("hello again");
    expect(row.is_deleted).toBe(false);
  });

  it("clears conflicting handles and records handle history", async () => {
    const ingestEventId1 = await createIngestEvent(db, "twitterio_api_user_followers");
    const user1 = UserId(1n);
    const user2 = UserId(2n);
    await upsertUserProfile(
      db,
      buildUserProfile({ id: user1, handle: "alpha", ingestEventId: ingestEventId1 }),
    );
    await upsertUserProfile(
      db,
      buildUserProfile({ id: user2, handle: "beta", ingestEventId: ingestEventId1 }),
    );

    const ingestEventId2 = await createIngestEvent(db, "twitterio_api_user_followers");
    await upsertUserProfile(
      db,
      buildUserProfile({ id: user2, handle: "alpha", ingestEventId: ingestEventId2 }),
    );

    const users = await db
      .selectFrom("users")
      .select(["id", "handle"])
      .orderBy("id", "asc")
      .execute();

    expect(users).toEqual([
      { id: user1, handle: null },
      { id: user2, handle: "alpha" },
    ]);

    const history = await db
      .selectFrom("user_handle_history")
      .select(["user_id", "previous_handle", "new_handle"])
      .orderBy("id", "asc")
      .execute();

    expect(history).toEqual([
      { user_id: user1, previous_handle: "alpha", new_handle: "" },
      { user_id: user2, previous_handle: "beta", new_handle: "alpha" },
    ]);
  });
});
