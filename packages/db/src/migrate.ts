import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator, sql } from "kysely";
import type { MigrationResult } from "kysely";
import { promises as fs } from "node:fs";
import type { Db } from "./db.js";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number") return String(error);
  if (typeof error === "boolean") return String(error);
  if (typeof error === "bigint") return String(error);
  if (error === null) return "null";
  if (error === undefined) return "undefined";

  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

export async function migrateToLatest(db: Db): Promise<MigrationResult[]> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsFolder,
    }),
  });

  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    throw error instanceof Error
      ? error
      : new Error(`Migration failed: ${formatUnknownError(error)}`, { cause: error });
  }
  return results ?? [];
}

export async function migrateToLatestWithLock(db: Db): Promise<MigrationResult[]> {
  await sql`select pg_advisory_lock(hashtext('bdx:migrations')::bigint)`.execute(db);
  try {
    return await migrateToLatest(db);
  } finally {
    await sql`select pg_advisory_unlock(hashtext('bdx:migrations')::bigint)`.execute(db);
  }
}
