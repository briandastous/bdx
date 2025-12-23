import type { Transaction } from "kysely";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./database.js";

export type Db = Kysely<Database>;
export type DbOrTx = Db | Transaction<Database>;

export interface DbConfig {
  maxConnections: number;
  idleTimeoutMs: number;
  connectTimeoutMs: number;
  maxLifetimeMs: number;
  statementTimeoutMs: number;
}

const defaultDbConfig: DbConfig = {
  maxConnections: 10,
  idleTimeoutMs: 60_000,
  connectTimeoutMs: 10_000,
  maxLifetimeMs: 3_600_000,
  statementTimeoutMs: 30_000,
};

function toSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

export function createDb(databaseUrl: string, config: Partial<DbConfig> = {}): Db {
  const resolved = { ...defaultDbConfig, ...config };
  const sql = postgres(databaseUrl, {
    max: resolved.maxConnections,
    idle_timeout: toSeconds(resolved.idleTimeoutMs),
    connect_timeout: toSeconds(resolved.connectTimeoutMs),
    max_lifetime: toSeconds(resolved.maxLifetimeMs),
    connection: {
      statement_timeout: resolved.statementTimeoutMs,
    },
    types: {
      bigint: postgres.BigInt,
    },
  });
  return new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  });
}

export async function destroyDb(db: Db): Promise<void> {
  await db.destroy();
}
