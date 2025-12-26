import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tweets_by_ids_hydration_runs rename to posts_by_ids_hydration_runs`.execute(
    db,
  );
  await sql`
    alter table tweets_by_ids_hydration_run_requested_tweets
    rename to posts_by_ids_hydration_run_requested_posts
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename column tweets_by_ids_hydration_run_id to posts_by_ids_hydration_run_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename column tweet_id to post_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_runs
    rename constraint tweets_by_ids_hydration_runs_completed_at_check
    to posts_by_ids_hydration_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename constraint tweets_by_ids_hydration_run_requested_tweets_pkey
    to posts_by_ids_hydration_run_requested_posts_pkey
  `.execute(db);
  await sql`
    alter index tweets_by_ids_hydration_run_requested_tweets_lookup_idx
    rename to posts_by_ids_hydration_run_requested_posts_lookup_idx
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table posts_by_ids_hydration_runs
    rename constraint posts_by_ids_hydration_runs_completed_at_check
    to tweets_by_ids_hydration_runs_completed_at_check
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename constraint posts_by_ids_hydration_run_requested_posts_pkey
    to tweets_by_ids_hydration_run_requested_tweets_pkey
  `.execute(db);
  await sql`
    alter index posts_by_ids_hydration_run_requested_posts_lookup_idx
    rename to tweets_by_ids_hydration_run_requested_tweets_lookup_idx
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename column posts_by_ids_hydration_run_id to tweets_by_ids_hydration_run_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename column post_id to tweet_id
  `.execute(db);
  await sql`
    alter table posts_by_ids_hydration_run_requested_posts
    rename to tweets_by_ids_hydration_run_requested_tweets
  `.execute(db);
  await sql`alter table posts_by_ids_hydration_runs rename to tweets_by_ids_hydration_runs`.execute(
    db,
  );
}
