import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  const result = await sql<{ count: bigint }>`
    select count(*)::bigint as count
    from users
    where last_updated_at is null
  `.execute(db);

  const count = result.rows[0]?.count ?? 0n;
  if (count !== 0n) {
    throw new Error(
      `Refusing to enforce users.last_updated_at NOT NULL: ${count.toString()} row(s) are NULL`,
    );
  }

  await sql`
    alter table users
      alter column last_updated_at set not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table users
      alter column last_updated_at drop not null
  `.execute(db);
}
