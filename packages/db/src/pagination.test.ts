import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  destroyDb,
  migrateToLatest,
  upsertUserProfile,
  type Db,
  type IngestKind,
  type UserProfileInput,
} from "./index.js";
import { paginateQuery } from "./pagination.js";
import { IngestEventId, UserId } from "@bdx/ids";

const userId = UserId(1n);

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
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

describe("paginateQuery", () => {
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
    const ingestEventId = await createIngestEvent(db, "twitterio_api_users_by_ids");
    await upsertUserProfile(
      db,
      buildUserProfileInput({
        id: userId,
        handle: "user1",
        ingestEventId,
        ingestKind: "twitterio_api_users_by_ids",
      }),
    );
    await db
      .insertInto("posts")
      .values([
        {
          id: 101n,
          author_id: userId,
          posted_at: new Date("2024-01-01T00:00:00.000Z"),
          text: "a",
        },
        {
          id: 102n,
          author_id: userId,
          posted_at: new Date("2024-01-01T00:00:00.000Z"),
          text: "b",
        },
        {
          id: 103n,
          author_id: userId,
          posted_at: new Date("2024-01-02T00:00:00.000Z"),
          text: "c",
        },
        {
          id: 104n,
          author_id: userId,
          posted_at: new Date("2024-01-03T00:00:00.000Z"),
          text: "d",
        },
        {
          id: 105n,
          author_id: userId,
          posted_at: new Date("2024-01-03T00:00:00.000Z"),
          text: "e",
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  it("paginates with stable sorts and cursors", async () => {
    const sorts = [
      { col: "posts.posted_at", output: "posted_at", dir: "desc" },
      { col: "posts.id", output: "id", dir: "desc" },
    ] as const;
    const baseQuery = db
      .selectFrom("posts")
      .select(["posts.id", "posts.posted_at"])
      .where("posts.author_id", "=", userId);

    const first = await paginateQuery({ query: baseQuery, sorts, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([105n, 104n]);
    expect(first.hasNextPage).toBe(true);
    expect(first.hasPrevPage).toBe(false);
    expect(first.nextPage).toBeDefined();

    const nextPage = first.nextPage;
    if (!nextPage) {
      throw new Error("missing nextPage cursor");
    }

    const second = await paginateQuery({
      query: baseQuery,
      sorts,
      limit: 2,
      cursor: { nextPage },
    });
    expect(second.items.map((item) => item.id)).toEqual([103n, 102n]);
    expect(second.hasNextPage).toBe(true);
    expect(second.hasPrevPage).toBe(true);
    expect(second.nextPage).toBeDefined();
    expect(second.prevPage).toBeDefined();

    const thirdPage = second.nextPage;
    if (!thirdPage) {
      throw new Error("missing nextPage cursor");
    }

    const third = await paginateQuery({
      query: baseQuery,
      sorts,
      limit: 2,
      cursor: { nextPage: thirdPage },
    });
    expect(third.items.map((item) => item.id)).toEqual([101n]);
    expect(third.hasNextPage).toBe(false);
    expect(third.hasPrevPage).toBe(true);

    const prevPage = second.prevPage;
    if (!prevPage) {
      throw new Error("missing prevPage cursor");
    }
    const back = await paginateQuery({
      query: baseQuery,
      sorts,
      limit: 2,
      cursor: { prevPage },
    });
    expect(back.items.map((item) => item.id)).toEqual([105n, 104n]);
  });
});
