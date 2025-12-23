import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type StartedPostgreSqlContainer,
  PostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDb, destroyDb, migrateToLatest, type Db } from "./index.js";
import { paginateQuery } from "./pagination.js";

const userId = 1n;

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
    await db.insertInto("users").values({ id: userId }).execute();
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
