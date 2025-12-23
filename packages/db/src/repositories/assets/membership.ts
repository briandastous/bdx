import { sql } from "kysely";
import type { DbOrTx } from "../../db.js";
import type { AssetEventType } from "../../database.js";
import { updateCurrentMembershipMaterialization } from "./instances.js";
import type { AssetInstanceId, AssetMaterializationId, PostId, UserId } from "@bdx/ids";
import {
  AssetMaterializationId as AssetMaterializationIdBrand,
  PostId as PostIdBrand,
  UserId as UserIdBrand,
} from "@bdx/ids";

export interface SegmentEventInput {
  userId: UserId;
  eventType: AssetEventType;
  isFirstAppearance: boolean | null;
}

export interface PostCorpusEventInput {
  postId: PostId;
  eventType: AssetEventType;
  isFirstAppearance: boolean | null;
}

export async function insertSegmentEvents(
  db: DbOrTx,
  materializationId: AssetMaterializationId,
  events: SegmentEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;

  const values = events.map((event) => ({
    materialization_id: materializationId,
    user_id: event.userId,
    event_type: event.eventType,
    is_first_appearance: event.isFirstAppearance,
  }));

  const result = await db.insertInto("segment_events").values(values).executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function insertPostCorpusEvents(
  db: DbOrTx,
  materializationId: AssetMaterializationId,
  events: PostCorpusEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;

  const values = events.map((event) => ({
    materialization_id: materializationId,
    post_id: event.postId,
    event_type: event.eventType,
    is_first_appearance: event.isFirstAppearance,
  }));

  const result = await db.insertInto("post_corpus_events").values(values).executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function listSegmentMembershipSnapshot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<UserId[]> {
  const rows = await db
    .selectFrom("segment_membership_snapshots")
    .select(["user_id"])
    .where("instance_id", "=", instanceId)
    .orderBy("user_id", "asc")
    .execute();

  return rows.map((row) => UserIdBrand(row.user_id));
}

export async function listPostCorpusMembershipSnapshot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<PostId[]> {
  const rows = await db
    .selectFrom("post_corpus_membership_snapshots")
    .select(["post_id"])
    .where("instance_id", "=", instanceId)
    .orderBy("post_id", "asc")
    .execute();

  return rows.map((row) => PostIdBrand(row.post_id));
}

export async function replaceSegmentMembershipSnapshot(
  db: DbOrTx,
  params: {
    instanceId: AssetInstanceId;
    materializationId: AssetMaterializationId;
    userIds: Iterable<UserId>;
  },
): Promise<number> {
  const ids = Array.from(new Set(params.userIds)).sort((a, b) => (a < b ? -1 : 1));

  await db
    .deleteFrom("segment_membership_snapshots")
    .where("instance_id", "=", params.instanceId)
    .execute();

  if (ids.length > 0) {
    const values = ids.map((userId) => ({
      instance_id: params.instanceId,
      user_id: userId,
      materialization_id: params.materializationId,
    }));
    await db.insertInto("segment_membership_snapshots").values(values).execute();
  }

  await updateCurrentMembershipMaterialization(db, {
    instanceId: params.instanceId,
    materializationId: params.materializationId,
  });

  return ids.length;
}

export async function replacePostCorpusMembershipSnapshot(
  db: DbOrTx,
  params: {
    instanceId: AssetInstanceId;
    materializationId: AssetMaterializationId;
    postIds: Iterable<PostId>;
  },
): Promise<number> {
  const ids = Array.from(new Set(params.postIds)).sort((a, b) => (a < b ? -1 : 1));

  await db
    .deleteFrom("post_corpus_membership_snapshots")
    .where("instance_id", "=", params.instanceId)
    .execute();

  if (ids.length > 0) {
    const values = ids.map((postId) => ({
      instance_id: params.instanceId,
      post_id: postId,
      materialization_id: params.materializationId,
    }));
    await db.insertInto("post_corpus_membership_snapshots").values(values).execute();
  }

  await updateCurrentMembershipMaterialization(db, {
    instanceId: params.instanceId,
    materializationId: params.materializationId,
  });

  return ids.length;
}

export async function listSegmentEnteredUserIds(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<Set<UserId>> {
  const rows = await db
    .selectFrom("segment_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.user_id"])
    .where("mat.asset_instance_id", "=", instanceId)
    .where("events.event_type", "=", "enter")
    .execute();

  return new Set(rows.map((row) => UserIdBrand(row.user_id)));
}

export async function listPostCorpusEnteredPostIds(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<Set<PostId>> {
  const rows = await db
    .selectFrom("post_corpus_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.post_id"])
    .where("mat.asset_instance_id", "=", instanceId)
    .where("events.event_type", "=", "enter")
    .execute();

  return new Set(rows.map((row) => PostIdBrand(row.post_id)));
}

type MaterializationOrdering = {
  id: AssetMaterializationId;
  completedAt: Date;
};

async function getMaterializationOrdering(
  db: DbOrTx,
  materializationId: AssetMaterializationId,
): Promise<MaterializationOrdering> {
  const row = await db
    .selectFrom("asset_materializations")
    .select(["id", "completed_at"])
    .where("id", "=", materializationId)
    .executeTakeFirstOrThrow();

  if (!row.completed_at) {
    throw new Error(`Materialization ${materializationId.toString()} is missing completed_at`);
  }

  return {
    id: AssetMaterializationIdBrand(row.id),
    completedAt: row.completed_at,
  };
}

async function getCurrentMembershipMaterializationId(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<AssetMaterializationId> {
  const row = await db
    .selectFrom("asset_instances")
    .select(["current_membership_materialization_id"])
    .where("id", "=", instanceId)
    .executeTakeFirst();

  const current = row?.current_membership_materialization_id ?? null;
  if (!current) {
    throw new Error(
      `Missing current membership materialization for instance ${instanceId.toString()}`,
    );
  }
  return AssetMaterializationIdBrand(current);
}

export async function getSegmentMembershipAsOf(
  db: DbOrTx,
  params: { instanceId: AssetInstanceId; targetMaterializationId: AssetMaterializationId },
): Promise<UserId[]> {
  const checkpointId = await getCurrentMembershipMaterializationId(db, params.instanceId);
  if (params.targetMaterializationId === checkpointId) {
    return listSegmentMembershipSnapshot(db, params.instanceId);
  }

  const target = await getMaterializationOrdering(db, params.targetMaterializationId);
  const checkpoint = await getMaterializationOrdering(db, checkpointId);

  if (target.completedAt > checkpoint.completedAt) {
    throw new Error(
      `Target materialization ${target.id.toString()} is newer than checkpoint ${checkpoint.id.toString()}`,
    );
  }

  const toggleRows = await db
    .selectFrom("segment_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.user_id"])
    .where("mat.asset_instance_id", "=", params.instanceId)
    .where("mat.status", "=", "success")
    .where(sql<boolean>`(mat.completed_at, mat.id) > (${target.completedAt}, ${target.id})`)
    .where(
      sql<boolean>`(mat.completed_at, mat.id) <= (${checkpoint.completedAt}, ${checkpoint.id})`,
    )
    .groupBy("events.user_id")
    .having(sql<boolean>`(count(*) % 2) = 1`)
    .execute();

  const current = new Set(await listSegmentMembershipSnapshot(db, params.instanceId));
  for (const row of toggleRows) {
    const userId = UserIdBrand(row.user_id);
    if (current.has(userId)) {
      current.delete(userId);
    } else {
      current.add(userId);
    }
  }

  return Array.from(current).sort((a, b) => (a < b ? -1 : 1));
}

export async function getPostCorpusMembershipAsOf(
  db: DbOrTx,
  params: { instanceId: AssetInstanceId; targetMaterializationId: AssetMaterializationId },
): Promise<PostId[]> {
  const checkpointId = await getCurrentMembershipMaterializationId(db, params.instanceId);
  if (params.targetMaterializationId === checkpointId) {
    return listPostCorpusMembershipSnapshot(db, params.instanceId);
  }

  const target = await getMaterializationOrdering(db, params.targetMaterializationId);
  const checkpoint = await getMaterializationOrdering(db, checkpointId);

  if (target.completedAt > checkpoint.completedAt) {
    throw new Error(
      `Target materialization ${target.id.toString()} is newer than checkpoint ${checkpoint.id.toString()}`,
    );
  }

  const toggleRows = await db
    .selectFrom("post_corpus_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.post_id"])
    .where("mat.asset_instance_id", "=", params.instanceId)
    .where("mat.status", "=", "success")
    .where(sql<boolean>`(mat.completed_at, mat.id) > (${target.completedAt}, ${target.id})`)
    .where(
      sql<boolean>`(mat.completed_at, mat.id) <= (${checkpoint.completedAt}, ${checkpoint.id})`,
    )
    .groupBy("events.post_id")
    .having(sql<boolean>`(count(*) % 2) = 1`)
    .execute();

  const current = new Set(await listPostCorpusMembershipSnapshot(db, params.instanceId));
  for (const row of toggleRows) {
    const postId = PostIdBrand(row.post_id);
    if (current.has(postId)) {
      current.delete(postId);
    } else {
      current.add(postId);
    }
  }

  return Array.from(current).sort((a, b) => (a < b ? -1 : 1));
}

export async function rebuildSegmentMembershipSnapshot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<{ materializationId: AssetMaterializationId | null; memberCount: number }> {
  const latest = await db
    .selectFrom("asset_materializations")
    .select(["id", "completed_at"])
    .where("asset_instance_id", "=", instanceId)
    .where("status", "=", "success")
    .orderBy("completed_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!latest?.completed_at) {
    await updateCurrentMembershipMaterialization(db, { instanceId, materializationId: null });
    return { materializationId: null, memberCount: 0 };
  }

  const events = await db
    .selectFrom("segment_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.user_id", "events.event_type", "mat.completed_at", "mat.id"])
    .where("mat.asset_instance_id", "=", instanceId)
    .where("mat.status", "=", "success")
    .orderBy("mat.completed_at", "asc")
    .orderBy("mat.id", "asc")
    .execute();

  const membership = new Set<UserId>();
  for (const event of events) {
    if (event.event_type === "enter") {
      membership.add(UserIdBrand(event.user_id));
    } else {
      membership.delete(UserIdBrand(event.user_id));
    }
  }

  await replaceSegmentMembershipSnapshot(db, {
    instanceId,
    materializationId: AssetMaterializationIdBrand(latest.id),
    userIds: membership,
  });

  return {
    materializationId: AssetMaterializationIdBrand(latest.id),
    memberCount: membership.size,
  };
}

export async function rebuildPostCorpusMembershipSnapshot(
  db: DbOrTx,
  instanceId: AssetInstanceId,
): Promise<{ materializationId: AssetMaterializationId | null; memberCount: number }> {
  const latest = await db
    .selectFrom("asset_materializations")
    .select(["id", "completed_at"])
    .where("asset_instance_id", "=", instanceId)
    .where("status", "=", "success")
    .orderBy("completed_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!latest?.completed_at) {
    await updateCurrentMembershipMaterialization(db, { instanceId, materializationId: null });
    return { materializationId: null, memberCount: 0 };
  }

  const events = await db
    .selectFrom("post_corpus_events as events")
    .innerJoin("asset_materializations as mat", "mat.id", "events.materialization_id")
    .select(["events.post_id", "events.event_type", "mat.completed_at", "mat.id"])
    .where("mat.asset_instance_id", "=", instanceId)
    .where("mat.status", "=", "success")
    .orderBy("mat.completed_at", "asc")
    .orderBy("mat.id", "asc")
    .execute();

  const membership = new Set<PostId>();
  for (const event of events) {
    if (event.event_type === "enter") {
      membership.add(PostIdBrand(event.post_id));
    } else {
      membership.delete(PostIdBrand(event.post_id));
    }
  }

  await replacePostCorpusMembershipSnapshot(db, {
    instanceId,
    materializationId: AssetMaterializationIdBrand(latest.id),
    postIds: membership,
  });

  return {
    materializationId: AssetMaterializationIdBrand(latest.id),
    memberCount: membership.size,
  };
}
