import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "kysely";
import { createDb, destroyDb, migrateToLatest, type Db } from "./index.js";

type ColumnRow = {
  is_nullable: "YES" | "NO";
};

describe("migrations", () => {
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

  it("enforces users.last_updated_at as NOT NULL", async () => {
    const result = await sql<ColumnRow>`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name = 'last_updated_at'
    `.execute(db);

    const row = result.rows[0];
    if (row == null) {
      throw new Error("Expected users.last_updated_at column metadata");
    }
    expect(row.is_nullable).toBe("NO");
  });

  it("rejects placeholder users without last_updated_at", async () => {
    await expect(
      sql`
        insert into users (id, last_updated_at)
        values (1, null)
      `.execute(db),
    ).rejects.toThrow();
  });
});
