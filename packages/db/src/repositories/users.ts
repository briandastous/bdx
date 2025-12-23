import { sql } from "kysely";
import type { DbOrTx } from "../db.js";
import type { IngestKind, JsonValue } from "../database.js";
import { withTransaction } from "../transactions.js";

export interface UserProfileInput {
  id: bigint;
  handle: string | null;
  displayName: string | null;
  profileUrl: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  bio: string | null;
  location: string | null;
  isBlueVerified: boolean | null;
  verifiedType: string | null;
  isTranslator: boolean | null;
  isAutomated: boolean | null;
  automatedBy: string | null;
  possiblySensitive: boolean | null;
  unavailable: boolean | null;
  unavailableMessage: string | null;
  unavailableReason: string | null;
  followersCount: bigint | null;
  followingCount: bigint | null;
  favouritesCount: bigint | null;
  mediaCount: bigint | null;
  statusesCount: bigint | null;
  userCreatedAt: Date | null;
  bioEntities: JsonValue | null;
  affiliatesHighlightedLabel: JsonValue | null;
  pinnedTweetIds: string[] | null;
  withheldCountries: string[] | null;
  ingestEventId: bigint;
  ingestKind: IngestKind;
  updatedAt: Date;
}

export interface UsersMetaInput {
  userId: bigint;
  ingestEventId: bigint;
  ingestKind: IngestKind;
  updatedAt: Date;
}

export interface UserHandleInput {
  userId: bigint;
  handle: string;
  ingestEventId: bigint;
  ingestKind: IngestKind;
  updatedAt: Date;
}

export async function ensureUser(db: DbOrTx, params: { id: bigint }): Promise<void> {
  await db
    .insertInto("users")
    .values({
      id: params.id,
      is_deleted: false,
    })
    .onConflict((oc) => oc.column("id").doUpdateSet({ is_deleted: false }))
    .execute();
}

export async function ensureUsers(db: DbOrTx, ids: bigint[]): Promise<number> {
  if (ids.length === 0) return 0;

  const values = ids.map((id) => ({ id, is_deleted: false }));
  const result = await db
    .insertInto("users")
    .values(values)
    .onConflict((oc) => oc.column("id").doUpdateSet({ is_deleted: false }))
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

function normalizeHandle(handle: string | null): string | null {
  if (handle === null) return null;
  return handle.trim();
}

export async function upsertUserProfile(db: DbOrTx, input: UserProfileInput): Promise<void> {
  await withTransaction(db, async (trx) => {
    const handle = normalizeHandle(input.handle);
    const existing = await trx
      .selectFrom("users")
      .select(["handle"])
      .where("id", "=", input.id)
      .executeTakeFirst();

    const stolen =
      handle === null
        ? []
        : await trx
            .selectFrom("users")
            .select(["id", "handle"])
            .where("id", "!=", input.id)
            .where("handle_norm", "=", handle.toLowerCase())
            .execute();

    if (handle) {
      await trx
        .updateTable("users")
        .set({ handle: null })
        .where("id", "!=", input.id)
        .where("handle_norm", "=", handle.toLowerCase())
        .execute();
    }

    if (stolen.length > 0) {
      await trx
        .insertInto("user_handle_history")
        .values(
          stolen.map((row) => ({
            user_id: row.id,
            previous_handle: row.handle ?? "",
            new_handle: "",
            ingest_event_id: input.ingestEventId,
            recorded_at: input.updatedAt,
          })),
        )
        .execute();
    }

    await trx
      .insertInto("users")
      .values({
        id: input.id,
        handle,
        display_name: input.displayName,
        profile_url: input.profileUrl,
        profile_image_url: input.profileImageUrl,
        cover_image_url: input.coverImageUrl,
        bio: input.bio,
        location: input.location,
        is_blue_verified: input.isBlueVerified,
        verified_type: input.verifiedType,
        is_translator: input.isTranslator,
        is_automated: input.isAutomated,
        automated_by: input.automatedBy,
        possibly_sensitive: input.possiblySensitive,
        unavailable: input.unavailable,
        unavailable_message: input.unavailableMessage,
        unavailable_reason: input.unavailableReason,
        followers_count: input.followersCount,
        following_count: input.followingCount,
        favourites_count: input.favouritesCount,
        media_count: input.mediaCount,
        statuses_count: input.statusesCount,
        user_created_at: input.userCreatedAt,
        bio_entities: input.bioEntities,
        affiliates_highlighted_label: input.affiliatesHighlightedLabel,
        pinned_tweet_ids: input.pinnedTweetIds,
        withheld_countries: input.withheldCountries,
        is_deleted: false,
        last_ingest_event_id: input.ingestEventId,
        last_ingest_kind: input.ingestKind,
        last_updated_at: input.updatedAt,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          handle,
          display_name: input.displayName,
          profile_url: input.profileUrl,
          profile_image_url: input.profileImageUrl,
          cover_image_url: input.coverImageUrl,
          bio: input.bio,
          location: input.location,
          is_blue_verified: input.isBlueVerified,
          verified_type: input.verifiedType,
          is_translator: input.isTranslator,
          is_automated: input.isAutomated,
          automated_by: input.automatedBy,
          possibly_sensitive: input.possiblySensitive,
          unavailable: input.unavailable,
          unavailable_message: input.unavailableMessage,
          unavailable_reason: input.unavailableReason,
          followers_count: input.followersCount,
          following_count: input.followingCount,
          favourites_count: input.favouritesCount,
          media_count: input.mediaCount,
          statuses_count: input.statusesCount,
          user_created_at: input.userCreatedAt,
          bio_entities: input.bioEntities,
          affiliates_highlighted_label: input.affiliatesHighlightedLabel,
          pinned_tweet_ids: input.pinnedTweetIds,
          withheld_countries: input.withheldCountries,
          is_deleted: false,
          last_ingest_event_id: input.ingestEventId,
          last_ingest_kind: input.ingestKind,
          last_updated_at: input.updatedAt,
        }),
      )
      .execute();

    if (existing && handle && existing.handle !== handle) {
      await trx
        .insertInto("user_handle_history")
        .values({
          user_id: input.id,
          previous_handle: existing.handle ?? "",
          new_handle: handle,
          ingest_event_id: input.ingestEventId,
          recorded_at: input.updatedAt,
        })
        .execute();
    }
  });
}

export async function upsertUserHandle(db: DbOrTx, input: UserHandleInput): Promise<void> {
  await withTransaction(db, async (trx) => {
    const handle = normalizeHandle(input.handle);
    const existing = await trx
      .selectFrom("users")
      .select(["handle"])
      .where("id", "=", input.userId)
      .executeTakeFirst();

    const stolen =
      handle === null
        ? []
        : await trx
            .selectFrom("users")
            .select(["id", "handle"])
            .where("id", "!=", input.userId)
            .where("handle_norm", "=", handle.toLowerCase())
            .execute();

    if (handle) {
      await trx
        .updateTable("users")
        .set({ handle: null })
        .where("id", "!=", input.userId)
        .where("handle_norm", "=", handle.toLowerCase())
        .execute();
    }

    if (stolen.length > 0) {
      await trx
        .insertInto("user_handle_history")
        .values(
          stolen.map((row) => ({
            user_id: row.id,
            previous_handle: row.handle ?? "",
            new_handle: "",
            ingest_event_id: input.ingestEventId,
            recorded_at: input.updatedAt,
          })),
        )
        .execute();
    }

    await trx
      .insertInto("users")
      .values({
        id: input.userId,
        handle,
        is_deleted: false,
        last_ingest_event_id: input.ingestEventId,
        last_ingest_kind: input.ingestKind,
        last_updated_at: input.updatedAt,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          handle,
          is_deleted: false,
          last_ingest_event_id: input.ingestEventId,
          last_ingest_kind: input.ingestKind,
          last_updated_at: input.updatedAt,
        }),
      )
      .execute();

    if (existing && handle && existing.handle !== handle) {
      await trx
        .insertInto("user_handle_history")
        .values({
          user_id: input.userId,
          previous_handle: existing.handle ?? "",
          new_handle: handle,
          ingest_event_id: input.ingestEventId,
          recorded_at: input.updatedAt,
        })
        .execute();
    }
  });
}

export async function upsertUsersMeta(db: DbOrTx, rows: UsersMetaInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map((row) => ({
    user_id: row.userId,
    ingest_event_id: row.ingestEventId,
    ingest_kind: row.ingestKind,
    updated_at: row.updatedAt,
  }));

  const result = await db
    .insertInto("users_meta")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["user_id", "ingest_event_id"]).doUpdateSet({
        ingest_kind: sql`excluded.ingest_kind`,
        updated_at: sql`excluded.updated_at`,
      }),
    )
    .executeTakeFirst();

  return Number(result.numInsertedOrUpdatedRows ?? 0n);
}

export async function markUsersSoftDeleted(db: DbOrTx, userIds: bigint[]): Promise<number> {
  if (userIds.length === 0) return 0;

  const result = await db
    .updateTable("users")
    .set({ is_deleted: true })
    .where("id", "in", userIds)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0n);
}
