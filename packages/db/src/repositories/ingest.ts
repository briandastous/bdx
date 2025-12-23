import type { DbOrTx } from "../db.js";
import type { FollowsSyncMode, IngestKind, JsonValue, SyncRunStatus } from "../database.js";
import { withTransaction } from "../transactions.js";
import { ensureUser } from "./users.js";
import type { AssetMaterializationId, IngestEventId, UserId } from "@bdx/ids";
import { IngestEventId as IngestEventIdBrand, UserId as UserIdBrand } from "@bdx/ids";

export interface IngestEventRecord {
  id: IngestEventId;
  ingestKind: IngestKind;
  createdAt: Date;
}

export interface FollowersSyncRunInput {
  targetUserId: UserId;
  ingestKind: IngestKind;
  syncMode: FollowsSyncMode;
  status?: SyncRunStatus;
}

export interface FollowingsSyncRunInput {
  sourceUserId: UserId;
  ingestKind: IngestKind;
  syncMode: FollowsSyncMode;
  status?: SyncRunStatus;
}

export interface PostsSyncRunInput {
  ingestKind: IngestKind;
  status?: SyncRunStatus;
}

export interface SyncRunUpdateInput {
  status?: SyncRunStatus;
  completedAt?: Date | null;
  cursorExhausted?: boolean;
  lastApiStatus?: string | null;
  lastApiError?: string | null;
  lastHttpRequest?: JsonValue | null;
  lastHttpResponse?: JsonValue | null;
}

export interface PostsSyncRunUpdateInput extends SyncRunUpdateInput {
  syncedSince?: Date | null;
}

export interface WebhookFollowEventInput {
  targetUserId: UserId;
  followerUserId: UserId | null;
  followerHandle: string | null;
  rawPayload: JsonValue | null;
}

export interface FollowersSyncRunRecord {
  ingestEventId: IngestEventId;
  targetUserId: UserId;
  status: SyncRunStatus;
  syncMode: FollowsSyncMode;
  completedAt: Date | null;
  cursorExhausted: boolean;
}

export interface FollowingsSyncRunRecord {
  ingestEventId: IngestEventId;
  sourceUserId: UserId;
  status: SyncRunStatus;
  syncMode: FollowsSyncMode;
  completedAt: Date | null;
  cursorExhausted: boolean;
}

export interface PostsSyncRunRecord {
  ingestEventId: IngestEventId;
  status: SyncRunStatus;
  completedAt: Date | null;
  cursorExhausted: boolean;
  syncedSince: Date | null;
}

export interface FollowersSyncRunDetail {
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
  createdAt: Date;
  targetUserId: UserId;
  status: SyncRunStatus;
  syncMode: FollowsSyncMode;
  completedAt: Date | null;
  cursorExhausted: boolean;
  lastApiStatus: string | null;
  lastApiError: string | null;
  lastHttpRequest: JsonValue | null;
  lastHttpResponse: JsonValue | null;
}

export interface FollowingsSyncRunDetail {
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
  createdAt: Date;
  sourceUserId: UserId;
  status: SyncRunStatus;
  syncMode: FollowsSyncMode;
  completedAt: Date | null;
  cursorExhausted: boolean;
  lastApiStatus: string | null;
  lastApiError: string | null;
  lastHttpRequest: JsonValue | null;
  lastHttpResponse: JsonValue | null;
}

export interface PostsSyncRunDetail {
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
  createdAt: Date;
  status: SyncRunStatus;
  completedAt: Date | null;
  cursorExhausted: boolean;
  syncedSince: Date | null;
  lastApiStatus: string | null;
  lastApiError: string | null;
  lastHttpRequest: JsonValue | null;
  lastHttpResponse: JsonValue | null;
  targetUserIds: UserId[];
}

async function createIngestEvent(db: DbOrTx, ingestKind: IngestKind): Promise<IngestEventRecord> {
  const record = await db
    .insertInto("ingest_events")
    .values({ ingest_kind: ingestKind })
    .returning(["id", "ingest_kind", "created_at"])
    .executeTakeFirstOrThrow();

  return {
    id: IngestEventIdBrand(record.id),
    ingestKind: record.ingest_kind,
    createdAt: record.created_at,
  };
}

export async function createFollowersSyncRun(
  db: DbOrTx,
  input: FollowersSyncRunInput,
): Promise<IngestEventRecord> {
  return withTransaction(db, async (trx) => {
    await ensureUser(trx, { id: input.targetUserId });
    const event = await createIngestEvent(trx, input.ingestKind);

    await trx
      .insertInto("followers_sync_runs")
      .values({
        ingest_event_id: event.id,
        target_user_id: input.targetUserId,
        status: input.status ?? "in_progress",
        sync_mode: input.syncMode,
      })
      .execute();

    return event;
  });
}

export async function createFollowingsSyncRun(
  db: DbOrTx,
  input: FollowingsSyncRunInput,
): Promise<IngestEventRecord> {
  return withTransaction(db, async (trx) => {
    await ensureUser(trx, { id: input.sourceUserId });
    const event = await createIngestEvent(trx, input.ingestKind);

    await trx
      .insertInto("followings_sync_runs")
      .values({
        ingest_event_id: event.id,
        source_user_id: input.sourceUserId,
        status: input.status ?? "in_progress",
        sync_mode: input.syncMode,
      })
      .execute();

    return event;
  });
}

export async function createPostsSyncRun(
  db: DbOrTx,
  input: PostsSyncRunInput,
): Promise<IngestEventRecord> {
  return withTransaction(db, async (trx) => {
    const event = await createIngestEvent(trx, input.ingestKind);

    await trx
      .insertInto("posts_sync_runs")
      .values({
        ingest_event_id: event.id,
        status: input.status ?? "in_progress",
      })
      .execute();

    return event;
  });
}

type SyncRunUpdateRow = {
  status?: SyncRunStatus;
  completed_at?: Date | null;
  cursor_exhausted?: boolean;
  last_api_status?: string | null;
  last_api_error?: string | null;
  last_http_request?: JsonValue | null;
  last_http_response?: JsonValue | null;
  synced_since?: Date | null;
};

function buildSyncRunUpdate(input: SyncRunUpdateInput): SyncRunUpdateRow {
  const update: SyncRunUpdateRow = {};

  if (input.status !== undefined) update.status = input.status;
  if (input.completedAt !== undefined) update.completed_at = input.completedAt;
  if (input.cursorExhausted !== undefined) update.cursor_exhausted = input.cursorExhausted;
  if (input.lastApiStatus !== undefined) update.last_api_status = input.lastApiStatus;
  if (input.lastApiError !== undefined) update.last_api_error = input.lastApiError;
  if (input.lastHttpRequest !== undefined) update.last_http_request = input.lastHttpRequest;
  if (input.lastHttpResponse !== undefined) update.last_http_response = input.lastHttpResponse;

  return update;
}

export async function updateFollowersSyncRun(
  db: DbOrTx,
  ingestEventId: IngestEventId,
  input: SyncRunUpdateInput,
): Promise<number> {
  const update = buildSyncRunUpdate(input);
  if (Object.keys(update).length === 0) return 0;

  const result = await db
    .updateTable("followers_sync_runs")
    .set(update)
    .where("ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function updateFollowingsSyncRun(
  db: DbOrTx,
  ingestEventId: IngestEventId,
  input: SyncRunUpdateInput,
): Promise<number> {
  const update = buildSyncRunUpdate(input);
  if (Object.keys(update).length === 0) return 0;

  const result = await db
    .updateTable("followings_sync_runs")
    .set(update)
    .where("ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function updatePostsSyncRun(
  db: DbOrTx,
  ingestEventId: IngestEventId,
  input: PostsSyncRunUpdateInput,
): Promise<number> {
  const update = buildSyncRunUpdate(input);
  if (input.syncedSince !== undefined) update.synced_since = input.syncedSince;
  if (Object.keys(update).length === 0) return 0;

  const result = await db
    .updateTable("posts_sync_runs")
    .set(update)
    .where("ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows);
}

export async function getLatestFollowersSyncRun(
  db: DbOrTx,
  params: { targetUserId: UserId; status?: SyncRunStatus; syncMode?: FollowsSyncMode },
): Promise<FollowersSyncRunRecord | null> {
  let query = db
    .selectFrom("followers_sync_runs")
    .select([
      "ingest_event_id",
      "target_user_id",
      "status",
      "sync_mode",
      "completed_at",
      "cursor_exhausted",
    ])
    .where("target_user_id", "=", params.targetUserId);

  if (params.status) {
    query = query.where("status", "=", params.status);
  }
  if (params.syncMode) {
    query = query.where("sync_mode", "=", params.syncMode);
  }

  const record = await query.orderBy("ingest_event_id", "desc").limit(1).executeTakeFirst();
  if (!record) return null;

  return {
    ingestEventId: IngestEventIdBrand(record.ingest_event_id),
    targetUserId: UserIdBrand(record.target_user_id),
    status: record.status,
    syncMode: record.sync_mode,
    completedAt: record.completed_at,
    cursorExhausted: record.cursor_exhausted,
  };
}

export async function getLatestFollowingsSyncRun(
  db: DbOrTx,
  params: { sourceUserId: UserId; status?: SyncRunStatus; syncMode?: FollowsSyncMode },
): Promise<FollowingsSyncRunRecord | null> {
  let query = db
    .selectFrom("followings_sync_runs")
    .select([
      "ingest_event_id",
      "source_user_id",
      "status",
      "sync_mode",
      "completed_at",
      "cursor_exhausted",
    ])
    .where("source_user_id", "=", params.sourceUserId);

  if (params.status) {
    query = query.where("status", "=", params.status);
  }
  if (params.syncMode) {
    query = query.where("sync_mode", "=", params.syncMode);
  }

  const record = await query.orderBy("ingest_event_id", "desc").limit(1).executeTakeFirst();
  if (!record) return null;

  return {
    ingestEventId: IngestEventIdBrand(record.ingest_event_id),
    sourceUserId: UserIdBrand(record.source_user_id),
    status: record.status,
    syncMode: record.sync_mode,
    completedAt: record.completed_at,
    cursorExhausted: record.cursor_exhausted,
  };
}

export async function getLatestPostsSyncRun(
  db: DbOrTx,
  params: { targetUserId?: UserId; status?: SyncRunStatus },
): Promise<PostsSyncRunRecord | null> {
  let query = db
    .selectFrom("posts_sync_runs")
    .select([
      "posts_sync_runs.ingest_event_id",
      "posts_sync_runs.status",
      "posts_sync_runs.completed_at",
      "posts_sync_runs.cursor_exhausted",
      "posts_sync_runs.synced_since",
    ]);

  if (params.targetUserId !== undefined) {
    query = query
      .innerJoin(
        "posts_sync_run_target_users",
        "posts_sync_run_target_users.posts_sync_run_id",
        "posts_sync_runs.ingest_event_id",
      )
      .where("posts_sync_run_target_users.target_user_id", "=", params.targetUserId);
  }

  if (params.status) {
    query = query.where("posts_sync_runs.status", "=", params.status);
  }

  const record = await query
    .orderBy("posts_sync_runs.ingest_event_id", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!record) return null;

  return {
    ingestEventId: IngestEventIdBrand(record.ingest_event_id),
    status: record.status,
    completedAt: record.completed_at,
    cursorExhausted: record.cursor_exhausted,
    syncedSince: record.synced_since,
  };
}

export async function addPostsSyncRunTargetUsers(
  db: DbOrTx,
  ingestEventId: IngestEventId,
  targetUserIds: UserId[],
): Promise<number> {
  if (targetUserIds.length === 0) return 0;

  const values = targetUserIds.map((targetUserId) => ({
    posts_sync_run_id: ingestEventId,
    target_user_id: targetUserId,
  }));

  const result = await db
    .insertInto("posts_sync_run_target_users")
    .values(values)
    .onConflict((oc) => oc.columns(["posts_sync_run_id", "target_user_id"]).doNothing())
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function insertWebhookFollowEvent(
  db: DbOrTx,
  ingestKind: IngestKind,
  input: WebhookFollowEventInput,
): Promise<IngestEventRecord> {
  return withTransaction(db, async (trx) => {
    const event = await createIngestEvent(trx, ingestKind);
    await ensureUser(trx, { id: input.targetUserId });
    if (input.followerUserId !== null) {
      await ensureUser(trx, { id: input.followerUserId });
    }

    await trx
      .insertInto("webhook_follow_events")
      .values({
        ingest_event_id: event.id,
        target_user_id: input.targetUserId,
        follower_user_id: input.followerUserId,
        follower_handle: input.followerHandle,
        raw_payload: input.rawPayload,
      })
      .execute();

    return event;
  });
}

export async function linkPostsSyncRunToMaterializations(
  db: DbOrTx,
  ingestEventId: IngestEventId,
  materializationIds: AssetMaterializationId[],
): Promise<number> {
  if (materializationIds.length === 0) return 0;

  const values = materializationIds.map((materializationId) => ({
    posts_sync_run_id: ingestEventId,
    requested_by_materialization_id: materializationId,
  }));

  const result = await db
    .insertInto("posts_sync_run_requested_by_materializations")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["posts_sync_run_id", "requested_by_materialization_id"]).doNothing(),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function getFollowersSyncRunById(
  db: DbOrTx,
  ingestEventId: IngestEventId,
): Promise<FollowersSyncRunDetail | null> {
  const row = await db
    .selectFrom("followers_sync_runs")
    .innerJoin("ingest_events", "ingest_events.id", "followers_sync_runs.ingest_event_id")
    .select([
      "followers_sync_runs.ingest_event_id",
      "ingest_events.ingest_kind",
      "ingest_events.created_at",
      "followers_sync_runs.target_user_id",
      "followers_sync_runs.status",
      "followers_sync_runs.sync_mode",
      "followers_sync_runs.completed_at",
      "followers_sync_runs.cursor_exhausted",
      "followers_sync_runs.last_api_status",
      "followers_sync_runs.last_api_error",
      "followers_sync_runs.last_http_request",
      "followers_sync_runs.last_http_response",
    ])
    .where("followers_sync_runs.ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    ingestEventId: IngestEventIdBrand(row.ingest_event_id),
    ingestKind: row.ingest_kind,
    createdAt: row.created_at,
    targetUserId: UserIdBrand(row.target_user_id),
    status: row.status,
    syncMode: row.sync_mode,
    completedAt: row.completed_at,
    cursorExhausted: row.cursor_exhausted,
    lastApiStatus: row.last_api_status,
    lastApiError: row.last_api_error,
    lastHttpRequest: row.last_http_request,
    lastHttpResponse: row.last_http_response,
  };
}

export async function getFollowingsSyncRunById(
  db: DbOrTx,
  ingestEventId: IngestEventId,
): Promise<FollowingsSyncRunDetail | null> {
  const row = await db
    .selectFrom("followings_sync_runs")
    .innerJoin("ingest_events", "ingest_events.id", "followings_sync_runs.ingest_event_id")
    .select([
      "followings_sync_runs.ingest_event_id",
      "ingest_events.ingest_kind",
      "ingest_events.created_at",
      "followings_sync_runs.source_user_id",
      "followings_sync_runs.status",
      "followings_sync_runs.sync_mode",
      "followings_sync_runs.completed_at",
      "followings_sync_runs.cursor_exhausted",
      "followings_sync_runs.last_api_status",
      "followings_sync_runs.last_api_error",
      "followings_sync_runs.last_http_request",
      "followings_sync_runs.last_http_response",
    ])
    .where("followings_sync_runs.ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    ingestEventId: IngestEventIdBrand(row.ingest_event_id),
    ingestKind: row.ingest_kind,
    createdAt: row.created_at,
    sourceUserId: UserIdBrand(row.source_user_id),
    status: row.status,
    syncMode: row.sync_mode,
    completedAt: row.completed_at,
    cursorExhausted: row.cursor_exhausted,
    lastApiStatus: row.last_api_status,
    lastApiError: row.last_api_error,
    lastHttpRequest: row.last_http_request,
    lastHttpResponse: row.last_http_response,
  };
}

export async function getPostsSyncRunById(
  db: DbOrTx,
  ingestEventId: IngestEventId,
): Promise<PostsSyncRunDetail | null> {
  const row = await db
    .selectFrom("posts_sync_runs")
    .innerJoin("ingest_events", "ingest_events.id", "posts_sync_runs.ingest_event_id")
    .select([
      "posts_sync_runs.ingest_event_id",
      "ingest_events.ingest_kind",
      "ingest_events.created_at",
      "posts_sync_runs.status",
      "posts_sync_runs.completed_at",
      "posts_sync_runs.cursor_exhausted",
      "posts_sync_runs.synced_since",
      "posts_sync_runs.last_api_status",
      "posts_sync_runs.last_api_error",
      "posts_sync_runs.last_http_request",
      "posts_sync_runs.last_http_response",
    ])
    .where("posts_sync_runs.ingest_event_id", "=", ingestEventId)
    .executeTakeFirst();

  if (!row) return null;

  const targetRows = await db
    .selectFrom("posts_sync_run_target_users")
    .select(["target_user_id"])
    .where("posts_sync_run_id", "=", ingestEventId)
    .orderBy("target_user_id", "asc")
    .execute();

  return {
    ingestEventId: IngestEventIdBrand(row.ingest_event_id),
    ingestKind: row.ingest_kind,
    createdAt: row.created_at,
    status: row.status,
    completedAt: row.completed_at,
    cursorExhausted: row.cursor_exhausted,
    syncedSince: row.synced_since,
    lastApiStatus: row.last_api_status,
    lastApiError: row.last_api_error,
    lastHttpRequest: row.last_http_request,
    lastHttpResponse: row.last_http_response,
    targetUserIds: targetRows.map((target) => UserIdBrand(target.target_user_id)),
  };
}
