import { sql } from "kysely";
import type { DbOrTx } from "../db.js";
import type { IngestKind } from "../database.js";
import { ensureUsers } from "./users.js";

export interface FollowEdgeInput {
  targetId: bigint;
  followerId: bigint;
}

export interface FollowsMetaInput {
  targetId: bigint;
  followerId: bigint;
  ingestEventId: bigint;
  ingestKind: IngestKind;
  updatedAt: Date;
}

export async function upsertFollows(db: DbOrTx, rows: FollowEdgeInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const userIds = new Set<bigint>();
  for (const row of rows) {
    userIds.add(row.targetId);
    userIds.add(row.followerId);
  }
  await ensureUsers(db, Array.from(userIds));

  const values = rows.map((row) => ({
    target_id: row.targetId,
    follower_id: row.followerId,
    is_deleted: false,
  }));

  const result = await db
    .insertInto("follows")
    .values(values)
    .onConflict((oc) => oc.columns(["target_id", "follower_id"]).doUpdateSet({ is_deleted: false }))
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function upsertFollowsMeta(db: DbOrTx, rows: FollowsMetaInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map((row) => ({
    target_id: row.targetId,
    follower_id: row.followerId,
    ingest_event_id: row.ingestEventId,
    ingest_kind: row.ingestKind,
    updated_at: row.updatedAt,
  }));

  const result = await db
    .insertInto("follows_meta")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["target_id", "follower_id", "ingest_event_id"]).doUpdateSet({
        ingest_kind: sql`excluded.ingest_kind`,
        updated_at: sql`excluded.updated_at`,
      }),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function getActiveFollowerIds(
  db: DbOrTx,
  params: { targetUserId: bigint },
): Promise<Set<bigint>> {
  const rows = await db
    .selectFrom("follows")
    .select(["follower_id"])
    .where("target_id", "=", params.targetUserId)
    .where("is_deleted", "=", false)
    .execute();

  return new Set(rows.map((row) => row.follower_id));
}

export async function getActiveFollowedIds(
  db: DbOrTx,
  params: { followerUserId: bigint },
): Promise<Set<bigint>> {
  const rows = await db
    .selectFrom("follows")
    .select(["target_id"])
    .where("follower_id", "=", params.followerUserId)
    .where("is_deleted", "=", false)
    .execute();

  return new Set(rows.map((row) => row.target_id));
}

export async function markFollowersSoftDeleted(
  db: DbOrTx,
  params: { targetUserId: bigint; activeFollowerIds: Iterable<bigint> },
): Promise<number> {
  const activeSet = new Set(params.activeFollowerIds);
  const existing = await getActiveFollowerIds(db, { targetUserId: params.targetUserId });
  const removals = Array.from(existing).filter((id) => !activeSet.has(id));

  if (removals.length === 0) return 0;

  const result = await db
    .updateTable("follows")
    .set({ is_deleted: true })
    .where("target_id", "=", params.targetUserId)
    .where("follower_id", "in", removals)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function markFollowingsSoftDeleted(
  db: DbOrTx,
  params: { followerUserId: bigint; activeFollowedIds: Iterable<bigint> },
): Promise<number> {
  const activeSet = new Set(params.activeFollowedIds);
  const existing = await getActiveFollowedIds(db, { followerUserId: params.followerUserId });
  const removals = Array.from(existing).filter((id) => !activeSet.has(id));

  if (removals.length === 0) return 0;

  const result = await db
    .updateTable("follows")
    .set({ is_deleted: true })
    .where("follower_id", "=", params.followerUserId)
    .where("target_id", "in", removals)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}
