import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table users_by_ids_hydration_runs rename to users_by_ids_ingest_runs`.execute(db);
  await sql`
    alter table users_by_ids_hydration_run_requested_users
    rename to users_by_ids_ingest_run_requested_users
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_run_requested_users
    rename column users_by_ids_hydration_run_id to users_by_ids_ingest_run_id
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_runs
    rename constraint users_by_ids_hydration_runs_completed_at_check
    to users_by_ids_ingest_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_run_requested_users
    rename constraint users_by_ids_hydration_run_requested_users_pkey
    to users_by_ids_ingest_run_requested_users_pkey
  `.execute(db);
  await sql`
    alter index users_by_ids_hydration_run_requested_users_lookup_idx
    rename to users_by_ids_ingest_run_requested_users_lookup_idx
  `.execute(db);

  await sql`alter table posts_by_ids_hydration_runs rename to posts_by_ids_ingest_runs`.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename to posts_by_ids_ingest_run_requested_posts
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_run_requested_posts
    rename column posts_by_ids_hydration_run_id to posts_by_ids_ingest_run_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_runs
    rename constraint posts_by_ids_hydration_runs_completed_at_check
    to posts_by_ids_ingest_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_run_requested_posts
    rename constraint posts_by_ids_hydration_run_requested_posts_pkey
    to posts_by_ids_ingest_run_requested_posts_pkey
  `.execute(db);
  await sql`
    alter index posts_by_ids_hydration_run_requested_posts_lookup_idx
    rename to posts_by_ids_ingest_run_requested_posts_lookup_idx
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table posts_by_ids_ingest_runs
    rename constraint posts_by_ids_ingest_runs_completed_at_check
    to posts_by_ids_hydration_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_run_requested_posts
    rename constraint posts_by_ids_ingest_run_requested_posts_pkey
    to posts_by_ids_hydration_run_requested_posts_pkey
  `.execute(db);
  await sql`
    alter index posts_by_ids_ingest_run_requested_posts_lookup_idx
    rename to posts_by_ids_hydration_run_requested_posts_lookup_idx
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_run_requested_posts
    rename column posts_by_ids_ingest_run_id to posts_by_ids_hydration_run_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_ingest_run_requested_posts
    rename to posts_by_ids_hydration_run_requested_posts
  `.execute(db);
  await sql`alter table posts_by_ids_ingest_runs rename to posts_by_ids_hydration_runs`.execute(db);

  await sql`
    alter table users_by_ids_ingest_runs
    rename constraint users_by_ids_ingest_runs_completed_at_check
    to users_by_ids_hydration_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_run_requested_users
    rename constraint users_by_ids_ingest_run_requested_users_pkey
    to users_by_ids_hydration_run_requested_users_pkey
  `.execute(db);
  await sql`
    alter index users_by_ids_ingest_run_requested_users_lookup_idx
    rename to users_by_ids_hydration_run_requested_users_lookup_idx
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_run_requested_users
    rename column users_by_ids_ingest_run_id to users_by_ids_hydration_run_id
  `.execute(db);
  await sql`
    alter table users_by_ids_ingest_run_requested_users
    rename to users_by_ids_hydration_run_requested_users
  `.execute(db);
  await sql`alter table users_by_ids_ingest_runs rename to users_by_ids_hydration_runs`.execute(db);
}
