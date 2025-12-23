import { setTimeout as delay } from "node:timers/promises";
import { sql } from "kysely";
import type { DbOrTx } from "./db.js";

export interface AdvisoryLockOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

function lockKeyExpression(key: string | bigint) {
  if (typeof key === "bigint") {
    return sql`${key}::bigint`;
  }
  return sql`hashtext(${key})::bigint`;
}

export async function tryAdvisoryLock(db: DbOrTx, key: string | bigint): Promise<boolean> {
  const result = await sql<{ acquired: boolean }>`
    select pg_try_advisory_lock(${lockKeyExpression(key)}) as acquired
  `.execute(db);
  return result.rows[0]?.acquired ?? false;
}

export async function releaseAdvisoryLock(db: DbOrTx, key: string | bigint): Promise<boolean> {
  const result = await sql<{ released: boolean }>`
    select pg_advisory_unlock(${lockKeyExpression(key)}) as released
  `.execute(db);
  return result.rows[0]?.released ?? false;
}

export async function acquireAdvisoryLock(
  db: DbOrTx,
  key: string | bigint,
  options: AdvisoryLockOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const start = Date.now();

  while (true) {
    if (await tryAdvisoryLock(db, key)) return true;
    if (timeoutMs <= 0) return false;

    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) return false;
    const remaining = timeoutMs - elapsed;
    await delay(Math.min(pollIntervalMs, remaining), undefined, { signal: options.signal });
  }
}
