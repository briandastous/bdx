import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export type Database = Record<string, unknown>;

export type Db = Kysely<Database>;

export function createDb(databaseUrl: string): Db {
  const sql = postgres(databaseUrl, { max: 10 });
  return new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  });
}

export async function destroyDb(db: Db): Promise<void> {
  await db.destroy();
}
