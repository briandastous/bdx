import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  const syncRunStatusType = sql`sync_run_status`;

  await sql`
    alter type ingest_kind add value if not exists 'twitterio_api_users_by_ids'
  `.execute(db);
  await sql`
    alter type ingest_kind add value if not exists 'twitterio_api_posts_by_ids'
  `.execute(db);

  await db.schema
    .createTable("users_by_ids_hydration_runs")
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
    .addCheckConstraint(
      "users_by_ids_hydration_runs_completed_at_check",
      sql`(status = 'in_progress'::sync_run_status) = (completed_at is null)`,
    )
    .execute();

  await db.schema
    .createTable("users_by_ids_hydration_run_requested_users")
    .addColumn("users_by_ids_hydration_run_id", "bigint", (col) =>
      col.notNull().references("users_by_ids_hydration_runs.ingest_event_id").onDelete("cascade"),
    )
    .addColumn("user_id", "bigint", (col) => col.notNull())
    .addPrimaryKeyConstraint("users_by_ids_hydration_run_requested_users_pkey", [
      "users_by_ids_hydration_run_id",
      "user_id",
    ])
    .execute();

  await db.schema
    .createIndex("users_by_ids_hydration_run_requested_users_lookup_idx")
    .on("users_by_ids_hydration_run_requested_users")
    .columns(["user_id", "users_by_ids_hydration_run_id"])
    .execute();

  await db.schema
    .createTable("tweets_by_ids_hydration_runs")
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
    .addCheckConstraint(
      "tweets_by_ids_hydration_runs_completed_at_check",
      sql`(status = 'in_progress'::sync_run_status) = (completed_at is null)`,
    )
    .execute();

  await db.schema
    .createTable("tweets_by_ids_hydration_run_requested_tweets")
    .addColumn("tweets_by_ids_hydration_run_id", "bigint", (col) =>
      col.notNull().references("tweets_by_ids_hydration_runs.ingest_event_id").onDelete("cascade"),
    )
    .addColumn("tweet_id", "bigint", (col) => col.notNull())
    .addPrimaryKeyConstraint("tweets_by_ids_hydration_run_requested_tweets_pkey", [
      "tweets_by_ids_hydration_run_id",
      "tweet_id",
    ])
    .execute();

  await db.schema
    .createIndex("tweets_by_ids_hydration_run_requested_tweets_lookup_idx")
    .on("tweets_by_ids_hydration_run_requested_tweets")
    .columns(["tweet_id", "tweets_by_ids_hydration_run_id"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("tweets_by_ids_hydration_run_requested_tweets").ifExists().execute();
  await db.schema.dropTable("tweets_by_ids_hydration_runs").ifExists().execute();
  await db.schema.dropTable("users_by_ids_hydration_run_requested_users").ifExists().execute();
  await db.schema.dropTable("users_by_ids_hydration_runs").ifExists().execute();
}
