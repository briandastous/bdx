import { sql } from "kysely";
import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table segment_specified_users_inputs
      rename column user_external_id to user_id
  `.execute(db);

  await sql`
    alter table segment_specified_users_inputs
      add constraint segment_specified_users_inputs_user_id_fkey
      foreign key (user_id)
      references users(id)
      on delete restrict
  `.execute(db);

  await sql`
    alter table followers_sync_runs
      drop constraint if exists followers_sync_runs_target_user_id_fkey
  `.execute(db);

  await sql`
    alter table followings_sync_runs
      drop constraint if exists followings_sync_runs_source_user_id_fkey
  `.execute(db);

  await sql`
    alter table posts_sync_run_target_users
      drop constraint if exists posts_sync_run_target_users_target_user_id_fkey
  `.execute(db);

  await sql`
    alter table webhook_follow_events
      drop constraint if exists webhook_follow_events_target_user_id_fkey
  `.execute(db);

  await sql`
    alter table webhook_follow_events
      drop constraint if exists webhook_follow_events_follower_user_id_fkey
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table webhook_follow_events
      add constraint webhook_follow_events_follower_user_id_fkey
      foreign key (follower_user_id)
      references users(id)
      on delete set null
  `.execute(db);

  await sql`
    alter table webhook_follow_events
      add constraint webhook_follow_events_target_user_id_fkey
      foreign key (target_user_id)
      references users(id)
      on delete cascade
  `.execute(db);

  await sql`
    alter table posts_sync_run_target_users
      add constraint posts_sync_run_target_users_target_user_id_fkey
      foreign key (target_user_id)
      references users(id)
      on delete cascade
  `.execute(db);

  await sql`
    alter table followings_sync_runs
      add constraint followings_sync_runs_source_user_id_fkey
      foreign key (source_user_id)
      references users(id)
      on delete cascade
  `.execute(db);

  await sql`
    alter table followers_sync_runs
      add constraint followers_sync_runs_target_user_id_fkey
      foreign key (target_user_id)
      references users(id)
      on delete cascade
  `.execute(db);

  await sql`
    alter table segment_specified_users_inputs
      drop constraint if exists segment_specified_users_inputs_user_id_fkey
  `.execute(db);

  await sql`
    alter table segment_specified_users_inputs
      rename column user_id to user_external_id
  `.execute(db);
}
