import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  const ingestKindType = sql`ingest_kind`;
  const syncRunStatusType = sql`sync_run_status`;
  const followsSyncModeType = sql`follows_sync_mode`;
  const assetSlugType = sql`asset_slug`;
  const assetMaterializationStatusType = sql`asset_materialization_status`;
  const assetInstanceFanoutModeType = sql`asset_instance_fanout_mode`;
  const assetEventType = sql`asset_event_type`;
  const textArrayType = sql`text[]`;

  await sql`
    create type ingest_kind as enum (
      'twitterio_api_user_followers',
      'twitterio_api_user_followings',
      'twitterio_api_users_posts',
      'ifttt_webhook_new_follow'
    )
  `.execute(db);

  await sql`
    create type sync_run_status as enum (
      'success',
      'in_progress',
      'cancelled',
      'error'
    )
  `.execute(db);

  await sql`
    create type follows_sync_mode as enum (
      'full_refresh',
      'incremental'
    )
  `.execute(db);

  await sql`
    create type asset_slug as enum (
      'segment_specified_users',
      'segment_followers',
      'segment_followed',
      'segment_mutuals',
      'segment_unreciprocated_followed',
      'post_corpus_for_segment'
    )
  `.execute(db);

  await sql`
    create type asset_materialization_status as enum (
      'success',
      'in_progress',
      'cancelled',
      'error'
    )
  `.execute(db);

  await sql`
    create type asset_instance_fanout_mode as enum (
      'global_per_item',
      'scoped_by_source'
    )
  `.execute(db);

  await sql`
    create type asset_event_type as enum (
      'enter',
      'exit'
    )
  `.execute(db);

  await db.schema
    .createTable("ingest_events")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("ingest_kind", ingestKindType, (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("id", "bigint", (col) => col.primaryKey())
    .addColumn("handle", "text")
    .addColumn("display_name", "text")
    .addColumn("profile_url", "text")
    .addColumn("profile_image_url", "text")
    .addColumn("cover_image_url", "text")
    .addColumn("bio", "text")
    .addColumn("location", "text")
    .addColumn("is_blue_verified", "boolean")
    .addColumn("verified_type", "text")
    .addColumn("is_translator", "boolean")
    .addColumn("is_automated", "boolean")
    .addColumn("automated_by", "text")
    .addColumn("possibly_sensitive", "boolean")
    .addColumn("unavailable", "boolean")
    .addColumn("unavailable_message", "text")
    .addColumn("unavailable_reason", "text")
    .addColumn("followers_count", "bigint")
    .addColumn("following_count", "bigint")
    .addColumn("favourites_count", "bigint")
    .addColumn("media_count", "bigint")
    .addColumn("statuses_count", "bigint")
    .addColumn("user_created_at", "timestamptz")
    .addColumn("bio_entities", "jsonb")
    .addColumn("affiliates_highlighted_label", "jsonb")
    .addColumn("pinned_tweet_ids", textArrayType)
    .addColumn("withheld_countries", textArrayType)
    .addColumn("is_deleted", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("last_ingest_event_id", "bigint", (col) =>
      col.references("ingest_events.id").onDelete("set null"),
    )
    .addColumn("last_updated_at", "timestamptz")
    .addColumn("last_ingest_kind", ingestKindType)
    .execute();

  await sql`
    alter table users
      add column handle_norm text generated always as (lower(handle)) stored
  `.execute(db);

  await sql`
    create unique index users_handle_norm_unique
      on users (handle_norm)
      where handle is not null
  `.execute(db);

  await db.schema
    .createTable("follows")
    .addColumn("target_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("follower_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("is_deleted", "boolean", (col) => col.notNull().defaultTo(false))
    .addPrimaryKeyConstraint("follows_pkey", ["target_id", "follower_id"])
    .execute();

  await db.schema
    .createIndex("follows_target_active_idx")
    .on("follows")
    .columns(["target_id", "is_deleted"])
    .execute();

  await db.schema
    .createIndex("follows_follower_active_idx")
    .on("follows")
    .columns(["follower_id", "is_deleted"])
    .execute();

  await db.schema
    .createTable("posts")
    .addColumn("id", "bigint", (col) => col.primaryKey())
    .addColumn("author_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("posted_at", "timestamptz", (col) => col.notNull())
    .addColumn("text", "text")
    .addColumn("lang", "text")
    .addColumn("raw_json", "jsonb")
    .addColumn("is_deleted", "boolean", (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createIndex("posts_author_posted_at_idx")
    .on("posts")
    .columns(["author_id", "posted_at"])
    .execute();

  await db.schema
    .createTable("followers_sync_runs")
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.primaryKey().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("target_user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("completed_at", "timestamptz")
    .addColumn("status", syncRunStatusType, (col) =>
      col.notNull().defaultTo(sql`'in_progress'::sync_run_status`),
    )
    .addColumn("sync_mode", followsSyncModeType, (col) =>
      col.notNull().defaultTo(sql`'full_refresh'::follows_sync_mode`),
    )
    .addColumn("last_api_status", "text")
    .addColumn("last_api_error", "text")
    .addColumn("last_http_request", "jsonb")
    .addColumn("last_http_response", "jsonb")
    .addColumn("cursor_exhausted", "boolean", (col) => col.notNull().defaultTo(false))
    .addCheckConstraint(
      "followers_sync_runs_completed_at_check",
      sql`(status = 'in_progress'::sync_run_status) = (completed_at is null)`
    )
    .execute();

  await db.schema
    .createIndex("followers_sync_runs_lookup_idx")
    .on("followers_sync_runs")
    .columns(["target_user_id", "status", "completed_at"])
    .execute();

  await db.schema
    .createIndex("followers_sync_runs_mode_lookup_idx")
    .on("followers_sync_runs")
    .columns(["target_user_id", "sync_mode", "status", "completed_at"])
    .execute();

  await db.schema
    .createTable("followings_sync_runs")
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.primaryKey().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("source_user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("completed_at", "timestamptz")
    .addColumn("status", syncRunStatusType, (col) =>
      col.notNull().defaultTo(sql`'in_progress'::sync_run_status`),
    )
    .addColumn("sync_mode", followsSyncModeType, (col) =>
      col.notNull().defaultTo(sql`'full_refresh'::follows_sync_mode`),
    )
    .addColumn("last_api_status", "text")
    .addColumn("last_api_error", "text")
    .addColumn("last_http_request", "jsonb")
    .addColumn("last_http_response", "jsonb")
    .addColumn("cursor_exhausted", "boolean", (col) => col.notNull().defaultTo(false))
    .addCheckConstraint(
      "followings_sync_runs_completed_at_check",
      sql`(status = 'in_progress'::sync_run_status) = (completed_at is null)`
    )
    .execute();

  await db.schema
    .createIndex("followings_sync_runs_lookup_idx")
    .on("followings_sync_runs")
    .columns(["source_user_id", "status", "completed_at"])
    .execute();

  await db.schema
    .createIndex("followings_sync_runs_mode_lookup_idx")
    .on("followings_sync_runs")
    .columns(["source_user_id", "sync_mode", "status", "completed_at"])
    .execute();

  await db.schema
    .createTable("posts_sync_runs")
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.primaryKey().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("completed_at", "timestamptz")
    .addColumn("status", syncRunStatusType, (col) =>
      col.notNull().defaultTo(sql`'in_progress'::sync_run_status`),
    )
    .addColumn("last_api_status", "text")
    .addColumn("last_api_error", "text")
    .addColumn("last_http_request", "jsonb")
    .addColumn("last_http_response", "jsonb")
    .addColumn("cursor_exhausted", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("synced_since", "timestamptz")
    .addCheckConstraint(
      "posts_sync_runs_completed_at_check",
      sql`(status = 'in_progress'::sync_run_status) = (completed_at is null)`
    )
    .execute();

  await db.schema
    .createIndex("posts_sync_runs_lookup_idx")
    .on("posts_sync_runs")
    .columns(["status", "completed_at"])
    .execute();

  await db.schema
    .createTable("posts_sync_run_target_users")
    .addColumn("posts_sync_run_id", "bigint", (col) =>
      col.notNull().references("posts_sync_runs.ingest_event_id").onDelete("cascade"),
    )
    .addColumn("target_user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("posts_sync_run_target_users_pkey", [
      "posts_sync_run_id",
      "target_user_id",
    ])
    .execute();

  await db.schema
    .createIndex("posts_sync_run_target_users_lookup_idx")
    .on("posts_sync_run_target_users")
    .columns(["target_user_id", "posts_sync_run_id"])
    .execute();

  await db.schema
    .createTable("webhook_follow_events")
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.primaryKey().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("target_user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("follower_user_id", "bigint", (col) =>
      col.references("users.id").onDelete("set null"),
    )
    .addColumn("follower_handle", "text")
    .addColumn("raw_payload", "jsonb")
    .execute();

  await db.schema
    .createTable("users_meta")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.notNull().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("ingest_kind", ingestKindType, (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("users_meta_user_ingest_unique", ["user_id", "ingest_event_id"])
    .execute();

  await db.schema
    .createIndex("users_meta_ingest_event_idx")
    .on("users_meta")
    .columns(["ingest_event_id"])
    .execute();

  await db.schema
    .createTable("follows_meta")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("target_id", "bigint", (col) => col.notNull())
    .addColumn("follower_id", "bigint", (col) => col.notNull())
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.notNull().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("ingest_kind", ingestKindType, (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("follows_meta_follow_ingest_unique", [
      "target_id",
      "follower_id",
      "ingest_event_id",
    ])
    .addForeignKeyConstraint(
      "follows_meta_follow_fk",
      ["target_id", "follower_id"],
      "follows",
      ["target_id", "follower_id"],
      (cb) => cb.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createIndex("follows_meta_ingest_event_idx")
    .on("follows_meta")
    .columns(["ingest_event_id"])
    .execute();

  await db.schema
    .createTable("posts_meta")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("post_id", "bigint", (col) =>
      col.notNull().references("posts.id").onDelete("cascade"),
    )
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.notNull().references("ingest_events.id").onDelete("cascade"),
    )
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("posts_meta_post_ingest_unique", ["post_id", "ingest_event_id"])
    .execute();

  await db.schema
    .createTable("user_handle_history")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("previous_handle", "text", (col) => col.notNull())
    .addColumn("new_handle", "text", (col) => col.notNull())
    .addColumn("ingest_event_id", "bigint", (col) =>
      col.references("ingest_events.id").onDelete("set null"),
    )
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("scheduler_policy_overrides")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("job_id", "text", (col) => col.notNull())
    .addColumn("target_id", "text")
    .addColumn("cadence_seconds", "bigint")
    .addColumn("jitter_seconds", "int2")
    .addColumn("max_parallel_per_target", "int2")
    .addColumn("max_retries", "int2")
    .addColumn("disabled", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("reason", "text")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("scheduler_planner_events")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("job_id", "text", (col) => col.notNull())
    .addColumn("target_id", "text")
    .addColumn("target_params", "text")
    .addColumn("decision", "text", (col) => col.notNull())
    .addColumn("reason", "text")
    .addColumn("planned_for", "timestamptz")
    .addColumn("planner_run_id", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("worker_heartbeats")
    .addColumn("service", "text", (col) => col.notNull())
    .addColumn("worker_id", "text", (col) => col.notNull())
    .addColumn("started_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("last_heartbeat_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("worker_heartbeats_pkey", ["service", "worker_id"])
    .execute();

  await db.schema
    .createTable("asset_params")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("asset_slug", assetSlugType, (col) => col.notNull())
    .addColumn("params_hash_version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("params_hash", "text", (col) => col.notNull())
    .addColumn("fanout_source_params_hash", "text")
    .addColumn("fanout_source_params_hash_version", "integer")
    .addUniqueConstraint("asset_params_slug_hash_unique", [
      "asset_slug",
      "params_hash_version",
      "params_hash",
    ])
    .execute();

  await db.schema
    .createIndex("asset_params_slug_hash_idx")
    .on("asset_params")
    .columns(["asset_slug", "params_hash_version", "params_hash"])
    .execute();

  await db.schema
    .createTable("segment_specified_users_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("stable_key", "text", (col) => col.notNull())
    .addUniqueConstraint("segment_specified_users_params_key_unique", ["stable_key"])
    .execute();

  await db.schema
    .createTable("segment_followers_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("subject_external_id", "bigint", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("segment_followed_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("subject_external_id", "bigint", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("segment_mutuals_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("subject_external_id", "bigint", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("segment_unreciprocated_followed_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("subject_external_id", "bigint", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("post_corpus_for_segment_params")
    .addColumn("asset_params_id", "bigint", (col) =>
      col.primaryKey().references("asset_params.id").onDelete("cascade"),
    )
    .addColumn("source_segment_params_id", "bigint", (col) =>
      col.notNull().references("asset_params.id").onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("asset_instances")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("params_id", "bigint", (col) =>
      col.notNull().references("asset_params.id").onDelete("restrict"),
    )
    .addColumn("asset_slug", assetSlugType, (col) => col.notNull())
    .addColumn("params_hash_version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("params_hash", "text", (col) => col.notNull())
    .addColumn("current_membership_materialization_id", "bigint")
    .addUniqueConstraint("asset_instances_params_unique", ["params_id"])
    .addUniqueConstraint("asset_instances_slug_hash_unique", [
      "asset_slug",
      "params_hash_version",
      "params_hash",
    ])
    .execute();

  await db.schema
    .createIndex("asset_instances_slug_hash_idx")
    .on("asset_instances")
    .columns(["asset_slug", "params_hash_version", "params_hash"])
    .execute();

  await db.schema
    .createTable("asset_instance_roots")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("disabled_at", "timestamptz")
    .addUniqueConstraint("asset_instance_roots_instance_unique", ["instance_id"])
    .execute();

  await db.schema
    .createTable("asset_instance_fanout_roots")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("source_instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("target_asset_slug", assetSlugType, (col) => col.notNull())
    .addColumn("fanout_mode", assetInstanceFanoutModeType, (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("disabled_at", "timestamptz")
    .addUniqueConstraint("asset_instance_fanout_roots_unique", [
      "source_instance_id",
      "target_asset_slug",
      "fanout_mode",
    ])
    .execute();

  await db.schema
    .createIndex("asset_instance_fanout_roots_source_idx")
    .on("asset_instance_fanout_roots")
    .columns(["source_instance_id", "target_asset_slug"])
    .execute();

  await db.schema
    .createTable("asset_materializations")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("asset_instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("asset_slug", assetSlugType, (col) => col.notNull())
    .addColumn("inputs_hash_version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("inputs_hash", "text", (col) => col.notNull())
    .addColumn("dependency_revisions_hash_version", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("dependency_revisions_hash", "text", (col) => col.notNull())
    .addColumn("output_revision", "bigint", (col) => col.notNull().defaultTo(0))
    .addColumn("status", assetMaterializationStatusType, (col) =>
      col.notNull().defaultTo(sql`'in_progress'::asset_materialization_status`),
    )
    .addColumn("started_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamptz")
    .addColumn("trigger_reason", "text")
    .addColumn("error_payload", "jsonb")
    .addCheckConstraint(
      "asset_materializations_completed_at_check",
      sql`(status = 'in_progress'::asset_materialization_status) = (completed_at is null)`
    )
    .execute();

  await db.schema
    .createIndex("asset_materializations_instance_idx")
    .on("asset_materializations")
    .columns(["asset_instance_id"])
    .execute();

  await db.schema
    .createIndex("asset_materializations_instance_completed_idx")
    .on("asset_materializations")
    .columns(["asset_instance_id", "completed_at"])
    .execute();

  await db.schema
    .createIndex("asset_materializations_instance_status_completed_idx")
    .on("asset_materializations")
    .columns(["asset_instance_id", "status", "completed_at", "id"])
    .execute();

  await db.schema
    .createIndex("asset_materializations_instance_inputs_idx")
    .on("asset_materializations")
    .columns([
      "asset_instance_id",
      "inputs_hash_version",
      "inputs_hash",
      "dependency_revisions_hash_version",
      "dependency_revisions_hash",
      "completed_at",
    ])
    .execute();

  await db.schema
    .createTable("asset_materialization_dependencies")
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("dependency_materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("asset_materialization_dependencies_pkey", [
      "materialization_id",
      "dependency_materialization_id",
    ])
    .execute();

  await db.schema
    .createTable("asset_materialization_requests")
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("requested_by_materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("asset_materialization_requests_pkey", [
      "materialization_id",
      "requested_by_materialization_id",
    ])
    .execute();

  await db.schema
    .createTable("posts_sync_run_requested_by_materializations")
    .addColumn("posts_sync_run_id", "bigint", (col) =>
      col.notNull().references("posts_sync_runs.ingest_event_id").onDelete("cascade"),
    )
    .addColumn("requested_by_materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("posts_sync_run_requested_by_materializations_pkey", [
      "posts_sync_run_id",
      "requested_by_materialization_id",
    ])
    .execute();

  await db.schema
    .alterTable("asset_instances")
    .addForeignKeyConstraint(
      "asset_instances_current_membership_materialization_id_fkey",
      ["current_membership_materialization_id"],
      "asset_materializations",
      ["id"],
      (cb) => cb.onDelete("set null"),
    )
    .execute();

  await db.schema
    .createTable("segment_events")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("event_type", assetEventType, (col) => col.notNull())
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("is_first_appearance", "boolean")
    .addUniqueConstraint("segment_events_materialization_user_unique", [
      "materialization_id",
      "user_id",
    ])
    .addCheckConstraint(
      "segment_events_first_appearance_check",
      sql`(event_type = 'enter'::asset_event_type and is_first_appearance is not null)
        or (event_type = 'exit'::asset_event_type and is_first_appearance is null)`
    )
    .execute();

  await db.schema
    .createIndex("segment_events_materialization_idx")
    .on("segment_events")
    .columns(["materialization_id"])
    .execute();

  await db.schema
    .createTable("post_corpus_events")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("post_id", "bigint", (col) =>
      col.notNull().references("posts.id").onDelete("cascade"),
    )
    .addColumn("event_type", assetEventType, (col) => col.notNull())
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("is_first_appearance", "boolean")
    .addUniqueConstraint("post_corpus_events_materialization_post_unique", [
      "materialization_id",
      "post_id",
    ])
    .addCheckConstraint(
      "post_corpus_events_first_appearance_check",
      sql`(event_type = 'enter'::asset_event_type and is_first_appearance is not null)
        or (event_type = 'exit'::asset_event_type and is_first_appearance is null)`
    )
    .execute();

  await db.schema
    .createIndex("post_corpus_events_materialization_idx")
    .on("post_corpus_events")
    .columns(["materialization_id"])
    .execute();

  await sql`create view segment_enter_events as
    select * from segment_events where event_type = 'enter'::asset_event_type`.execute(db);
  await sql`create view segment_exit_events as
    select * from segment_events where event_type = 'exit'::asset_event_type`.execute(db);
  await sql`create view post_corpus_enter_events as
    select * from post_corpus_events where event_type = 'enter'::asset_event_type`.execute(db);
  await sql`create view post_corpus_exit_events as
    select * from post_corpus_events where event_type = 'exit'::asset_event_type`.execute(db);

  await db.schema
    .createTable("segment_membership_snapshots")
    .addColumn("instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("user_id", "bigint", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("segment_membership_snapshots_pkey", ["instance_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("segment_membership_snapshots_instance_idx")
    .on("segment_membership_snapshots")
    .columns(["instance_id"])
    .execute();

  await db.schema
    .createTable("post_corpus_membership_snapshots")
    .addColumn("instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("post_id", "bigint", (col) =>
      col.notNull().references("posts.id").onDelete("cascade"),
    )
    .addColumn("materialization_id", "bigint", (col) =>
      col.notNull().references("asset_materializations.id").onDelete("cascade"),
    )
    .addColumn("recorded_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("post_corpus_membership_snapshots_pkey", [
      "instance_id",
      "post_id",
    ])
    .execute();

  await db.schema
    .createIndex("post_corpus_membership_snapshots_instance_idx")
    .on("post_corpus_membership_snapshots")
    .columns(["instance_id"])
    .execute();

  await db.schema
    .createTable("segment_specified_users_inputs")
    .addColumn("instance_id", "bigint", (col) =>
      col.notNull().references("asset_instances.id").onDelete("cascade"),
    )
    .addColumn("user_external_id", "bigint", (col) => col.notNull())
    .addPrimaryKeyConstraint("segment_specified_users_inputs_pkey", [
      "instance_id",
      "user_external_id",
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("segment_specified_users_inputs").ifExists().execute();
  await sql`drop view if exists post_corpus_exit_events`.execute(db);
  await sql`drop view if exists post_corpus_enter_events`.execute(db);
  await sql`drop view if exists segment_exit_events`.execute(db);
  await sql`drop view if exists segment_enter_events`.execute(db);
  await db.schema.dropTable("post_corpus_membership_snapshots").ifExists().execute();
  await db.schema.dropTable("segment_membership_snapshots").ifExists().execute();
  await db.schema.dropTable("post_corpus_events").ifExists().execute();
  await db.schema.dropTable("segment_events").ifExists().execute();
  await db.schema.dropTable("posts_sync_run_requested_by_materializations").ifExists().execute();
  await db.schema.dropTable("asset_materialization_requests").ifExists().execute();
  await db.schema.dropTable("asset_materialization_dependencies").ifExists().execute();
  await db.schema.dropTable("asset_materializations").ifExists().execute();
  await db.schema.dropTable("asset_instance_fanout_roots").ifExists().execute();
  await db.schema.dropTable("asset_instance_roots").ifExists().execute();
  await db.schema.dropTable("asset_instances").ifExists().execute();
  await db.schema.dropTable("post_corpus_for_segment_params").ifExists().execute();
  await db.schema.dropTable("segment_unreciprocated_followed_params").ifExists().execute();
  await db.schema.dropTable("segment_mutuals_params").ifExists().execute();
  await db.schema.dropTable("segment_followed_params").ifExists().execute();
  await db.schema.dropTable("segment_followers_params").ifExists().execute();
  await db.schema.dropTable("segment_specified_users_params").ifExists().execute();
  await db.schema.dropTable("asset_params").ifExists().execute();
  await db.schema.dropTable("worker_heartbeats").ifExists().execute();
  await db.schema.dropTable("scheduler_planner_events").ifExists().execute();
  await db.schema.dropTable("scheduler_policy_overrides").ifExists().execute();
  await db.schema.dropTable("user_handle_history").ifExists().execute();
  await db.schema.dropTable("posts_meta").ifExists().execute();
  await db.schema.dropTable("follows_meta").ifExists().execute();
  await db.schema.dropTable("users_meta").ifExists().execute();
  await db.schema.dropTable("webhook_follow_events").ifExists().execute();
  await db.schema.dropTable("posts_sync_run_target_users").ifExists().execute();
  await db.schema.dropTable("posts_sync_runs").ifExists().execute();
  await db.schema.dropTable("followings_sync_runs").ifExists().execute();
  await db.schema.dropTable("followers_sync_runs").ifExists().execute();
  await db.schema.dropTable("posts").ifExists().execute();
  await db.schema.dropTable("follows").ifExists().execute();
  await db.schema.dropTable("users").ifExists().execute();
  await db.schema.dropTable("ingest_events").ifExists().execute();

  await sql`drop type if exists asset_event_type`.execute(db);
  await sql`drop type if exists asset_instance_fanout_mode`.execute(db);
  await sql`drop type if exists asset_materialization_status`.execute(db);
  await sql`drop type if exists asset_slug`.execute(db);
  await sql`drop type if exists follows_sync_mode`.execute(db);
  await sql`drop type if exists sync_run_status`.execute(db);
  await sql`drop type if exists ingest_kind`.execute(db);
}
