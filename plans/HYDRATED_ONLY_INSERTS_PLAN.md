# Hydrated-Only Domain Inserts Plan (Users + Posts)

This document defines an executable plan to make “hydrated-only” inserts a global invariant for the `users` and
`posts` domain tables in this repository.

The intent is to eliminate “placeholder” rows (e.g., `users(id)` inserted solely to satisfy FKs) and ensure that when a
domain row exists, its substantive fields reflect an actual upstream fetch (even if the upstream indicates “unavailable”
and many fields are `null`).

This is a first pass: **no freshness guarantees** and **no asset-definition API changes**.

## Legacy Repo References

This plan is scoped to the current rewrite repo (`bdx`). Key references:

- Placeholder row creation:
  - `packages/db/src/repositories/users.ts` (`ensureUser`, `ensureUsers`)
  - `packages/db/src/repositories/follows.ts` (calls `ensureUsers`)
  - `packages/db/src/repositories/posts.ts` (calls `ensureUsers`)
  - `packages/db/src/repositories/ingest.ts` (calls `ensureUser` for sync run/webhook writes)
- Materialization writes that currently rely on FK-safety:
  - `packages/engine/src/engine.ts` (membership snapshots/events reference `users`/`posts`)
- Upstream APIs:
  - `/twitter/user/batch_info_by_ids` (“batch get user info by user ids”)
  - `/twitter/tweets` (“get tweet by tweet ids”)

## Goals / Non-Goals

### Goals

- Make it impossible (in normal operation) for this codebase to create “anemic” `users` rows that exist only to satisfy
  foreign key constraints.
- Remove `ensureUser` / `ensureUsers` and all call sites; replace their role with explicit **hydration** operations.
- Remove `upsertUserHandle` so that user rows are only created/updated from a full upstream user payload (via
  `upsertUserProfile`).
- Adopt a “boundary hydration” philosophy: **any user/post ID that enters persistent state is hydrated at the boundary**
  (ingest services + operator/config writes), so assets can treat materialized IDs as already-hydrated without a general
  “compute → hydrate → write outputs” phase.
- Fence operator/config-sourced user ID sets (e.g. `segment_specified_users_inputs`) so that they cannot reference users
  that do not exist: enforce a FK to `users(id)` and hydrate missing users at the time the inputs are written (CLI/API).
- Introduce ingest-layer wrappers for:
  - user hydration by user IDs (`/twitter/user/batch_info_by_ids`),
  - post hydration by tweet IDs (`/twitter/tweets`) (implemented now for symmetry/future assets, even if not required yet).
- Ensure existing ingest services (followers/followings/posts) delegate to user-hydration when a workflow needs a user row
  but doesn’t already have full user profile data available.
- Preserve current asset definitions and their `ingestRequirements` shape; any hydration needed for FK safety happens
  outside the asset API for this pass.

### Non-Goals

- No freshness semantics (no “within X hours” requirements). Hydration is “at least once”.
- No general-purpose dependency DSL and no “query planner” for arbitrary domain dependencies.
- No requirement to backfill historical placeholder users as part of a DB migration (network calls do not belong in
  migrations). Backfill is performed by explicit operator/worker workflows.
- No requirement to preserve the exact number of upstream calls per materialization/ingest (we’ll optimize later).

## Acceptance Criteria

### Hydration invariants

- There are no write paths that insert/update a `users` row without it being derived from an upstream user payload.
  - Operationally: `ensureUser` / `ensureUsers` no longer exist and nothing replaces them with a “stub insert”.
- There are no write paths that insert a `posts` row without the tweet payload (or equivalent) being available.
- `follows`, asset membership snapshots/events, and ingest detail tables that reference `users.id` / `posts.id` only do so
  after hydration has ensured those rows exist.
- Ingest/webhook _failure recording_ does not require placeholder domain rows:
  - ingest run and webhook event tables can persist the relevant user IDs even if the corresponding `users` row does not
    exist yet (no `users` FK on those metadata tables).

### Schema enforcement

- `users.last_updated_at` is `NOT NULL` at the schema level (added after legacy placeholders are hydrated).
  - Migration strategy (non-destructive): add a migration that asserts `count(*) where last_updated_at is null = 0`, then
    `ALTER TABLE users ALTER COLUMN last_updated_at SET NOT NULL`.
  - Operator workflow (outside migrations): use the new user-hydration CLI/service to hydrate any existing `users` rows
    with `last_updated_at IS NULL` before applying the constraint.
  - Rationale: nullable `last_updated_at` is a durable “placeholder marker” that undermines the invariant, but we should
    not rely on destructive truncation in dev once real data exists.

### Repo-level checks

- `rg -n "\\bensureUsers\\b|\\bensureUser\\b|\\bupsertUserHandle\\b" packages apps` returns no matches (excluding
  plan/docs history).
- New integration tests demonstrate that:
  - attempting to write follows/posts without prior hydration fails fast (FK violation) at the repository layer,
  - the ingest layer resolves that by hydrating first and then writing edges/posts/materializations successfully.

### Tests

The implementation should be covered by targeted integration tests (testcontainers Postgres) that exercise the real DB
constraints and the intended write ordering.

- **Migration/schema**
  - Once the `users.last_updated_at NOT NULL` migration lands, `migrateToLatest` yields a `users` table where inserting
    `{ id }` without `last_updated_at` fails.
  - Existing tests that directly insert into `users` are updated to insert hydrated users only (see below).
- **DB repositories**
  - `upsertFollows` and `upsertPosts` do not attempt to create missing users; they fail fast if referenced users do not
    exist.
  - No remaining production code or tests use `insertInto("users")` to create placeholder rows.
- **Ingest services**
  - Followers/followings sync against an empty DB succeeds (hydrates primary user + counterparts before any FK-dependent
    writes) and leaves no anemic users.
  - Posts sync against an empty DB succeeds (hydrates target users before writing `posts_sync_run_target_users` and posts).
  - Failure paths persist run metadata without requiring placeholder `users` rows.
  - Posts sync persists tweets whose `author_id` is outside the requested target set by hydrating those author users and
    logging a warning (no silent drops).
- **Config boundary (Option B)**
  - Writing `segment_specified_users_inputs` (CLI/API) against an empty `users` table hydrates missing users first, then
    inserts inputs via a FK to `users(id)` (so materialization never needs to “fix up” operator-provided IDs).
- **Webhook**
  - `/webhooks/ifttt/new-x-follower` succeeds against an empty DB by hydrating the configured target user by ID (ignoring
    handle input) and persisting the follower relationship with hydrated users only.

Concrete test changes (by file):

- Update (stop creating placeholder users):
  - `packages/db/src/pagination.test.ts`
  - `packages/db/src/repositories/assets/membership.test.ts`
  - `packages/engine/src/engine.test.ts`
  - `packages/ingest/src/ingest.test.ts`
  - `apps/api/src/server.test.ts`
- Add (new coverage):
  - DB-level invariant tests proving `users.last_updated_at NOT NULL` blocks placeholder inserts.
  - Engine ingest requirement evaluation ignores non-successful ingests:
    - if the latest sync run for a requirement has `status != 'success'` (even if it has `completed_at`), the engine still
      treats the requirement as unmet and triggers ingest.
  - Config-driven hydration batching:
    - `packages/config/src/env.test.ts` covers default + override behavior for `twitterapiIo.batchUsersByIdsMax` and
      `twitterapiIo.batchTweetsByIdsMax` on `WorkerEnv`.
    - Hydration services split upstream calls according to the configured batch size.
  - No-op hydration:
    - missing-only hydration where all requested IDs already exist returns without creating an `ingest_events` row.
  - Hydration wrapper tests for the new batch user/tweet endpoints:
    - success path (all IDs returned),
    - **missing ID fails** (batch response omits a requested ID, and no partial user upserts are committed),
    - upstream failure metadata persisted (HTTP snapshot/status).

### Observability

- Hydration operations are recorded as ingest events with a distinct `ingest_kind` and persisted HTTP metadata on failure
  (consistent with other ingest services).

## Architecture

### Where hydration lives

- Hydration is an **ingest concern** (network + persistence), implemented in `packages/ingest`.
- SQL remains in `packages/db` repositories; ingest services call repositories inside explicit transactions.

### New ingest wrappers (first pass)

- `UsersHydrationService` (new):
  - input: `userIds: UserId[]`
  - predicate: **needs hydration = row missing** (do not use `last_updated_at`; the steady state makes it `NOT NULL`)
  - backfill mode: support an explicit “force hydrate existing rows” mode for legacy cleanup (used to hydrate historical
    placeholder rows before we can enforce `users.last_updated_at NOT NULL`).
  - effect:
    - query which IDs already exist in `users` and only request the missing IDs,
    - fetch profiles via `/twitter/user/batch_info_by_ids` (batched),
    - **fail the hydration run if any requested IDs are absent from the response** (do not silently ignore),
    - upsert via `upsertUserProfile` (+ `users_meta`)
  - output: set of hydrated IDs + explicit errors for missing IDs / upstream failures
- `TweetsHydrationService` (new):
  - input: `tweetIds: PostId[]`
  - effect:
    - fetch tweets via `/twitter/tweets` (batched) using a **comma-separated** `tweet_ids` query param,
    - convert into `TweetData` / `PostInput` and `upsertPosts`
  - corollary: ensure `posts.author_id` users are hydrated as part of the same operation (from embedded author payloads)

### Delegation from existing ingest services

- Followers/followings sync:
  - delegates to `UsersHydrationService` when a workflow needs a user row for FK safety but only has an ID/handle.
- Posts sync:
  - uses `UsersHydrationService` (batch) to hydrate target users before writing `posts_sync_run_target_users` and posts.
  - if the search API returns a tweet whose `author_id` is outside the requested target set, hydrate+store anyway but log a
    warning (unexpected author).
- Webhook ingest:
  - ensures referenced users are hydrated before inserting webhook detail rows and follow edges.

## Legacy Bugs / Feature Gaps

- Placeholder users can currently be created (directly or indirectly) without any profile hydration (e.g., via FK-safety
  helpers), leading to:
  - downstream analysis seeing “existent users” with no substantive fields,
  - incremental graph syncs never “fixing” those placeholders if the IDs are treated as “already known”.

## Invariant Register

This plan adds (or tightens) the following invariants:

- **Users are hydrated-only**: `users` rows are created/updated only from an upstream user payload.
- **Users have non-null `last_updated_at`**: `users.last_updated_at` is `NOT NULL` and is set from profile-sourced writes.
- **Posts are hydrated-only**: `posts` rows are created/updated only from an upstream tweet payload.
- **FK references are hydration-gated**: any write that references `users.id` / `posts.id` must ensure hydration first.
- **Hydration is boundary-enforced**: asset membership/config IDs are only sourced from (a) FK-enforced input tables and
  (b) ingest services that upsert domain rows before any FK-bearing writes.
- **Failure recording is FK-independent**: ingest run rows and webhook event rows can be written even when the referenced
  `users` rows are missing (by dropping `users` FKs from those metadata tables).

Enforcement is application-level (service preconditions + tests) and schema-level (e.g. `users.last_updated_at NOT NULL`)
once placeholder helpers are removed.

## Work Plan

### Phase 1: Define “hydrated” and audit existing write paths

- [ ] Define the “hydrated user” and “hydrated post” predicate in DB terms.
  - Users: **hydrated = row exists** (and user rows are only created from an upstream user payload).
    - Keep `users.last_updated_at` as an audit/future-freshness signal; in the steady state it should be non-null for all
      rows because only profile-sourced writes create users.
  - Proposed default for posts: row existence is already “hydrated” because `posts.posted_at` and `posts.author_id` are
    required; ensure raw payload capture is consistent across ingest paths.
- [ ] Enumerate all FK-dependent writes that currently rely on placeholder insertion.
- [ ] Enumerate all config tables that persist user IDs, and classify them by whether they are **membership IDs** vs
      **seed IDs**:
  - membership IDs (must be hydrated at write-time / FK-fenced, because they are used directly as segment membership):
    - `segment_specified_users_inputs.user_external_id` (migrated to FK `user_id` in Phase 3)
  - seed IDs (used only to scope ingest queries; do not need a `users` row to exist at config-write time):
    - `segment_followers_params.subject_external_id`
    - `segment_followed_params.subject_external_id`
    - `segment_mutuals_params.subject_external_id`
    - `segment_unreciprocated_followed_params.subject_external_id`
- [ ] Identify ingest/webhook metadata tables that currently require placeholder users due to FKs, and plan the FK removals
      needed to allow failure recording without domain placeholder inserts.
- [ ] Confirm ingest requirement evaluation only considers successful ingests:
  - verify engine queries for “freshness” use `status = 'success'` and ignore the latest `error`/`cancelled`/`in_progress`
    runs when determining whether an ingest requirement is satisfied.
- [ ] Specify failure semantics (hydration + sync):
  - persist run metadata in ingest detail tables on failure (status + last HTTP exchange), but do not insert placeholder
    domain rows.
  - if a hydration/sync run makes no upstream calls (e.g. missing-only hydration where all IDs already exist), do not
    create a new ingest event.

### Phase 2: Implement user hydration wrapper (batch by IDs)

- [ ] Add a new `ingest_kind` value (e.g., `twitterio_api_users_by_ids`) via a DB migration.
- [ ] Add a detail table for hydration runs (mirrors other ingest detail tables):
  - status/timestamps, last upstream HTTP metadata, and a join table of requested user IDs.
- [ ] Extend `packages/twitterapi-io` with a first-class batch method that accepts `UserId[]` and returns `XUserData[]`
      mapped by ID (including “unavailable” users).
- [ ] Extend configuration:
  - add `twitterapiIo.batchUsersByIdsMax` to `config/base.yaml` (and thread it through `packages/config` so it’s available
    on `WorkerEnv`).
- [ ] Implement `UsersHydrationService` in `packages/ingest`:
  - batches requests to the API limit,
  - uses a configurable batch size from `config/base.yaml` (e.g. `twitterapiIo.batchUsersByIdsMax`),
  - upserts `users` via `upsertUserProfile`,
  - records `users_meta` rows for traceability,
  - persists failure metadata consistently with other ingest services.
  - **run atomicity**: when hydrating N IDs, require all-or-nothing domain writes (if any ID fails or is missing from the
    upstream response, no user/profile rows are written for the run).
- [ ] Add an operator entrypoint (CLI command) for:
  - hydrating an explicit CSV list of user IDs,
  - (Optional, later) hydrating IDs from other local sources (e.g., segment inputs) if we adopt a “truncate domain tables
    but keep config tables” workflow in dev.

### Phase 3: Fence `segment_specified_users_inputs` with a FK and hydrate at write-time (Option B)

- [ ] Add a DB migration that makes `segment_specified_users_inputs` reference `users(id)`:
  - rename `user_external_id` → `user_id` (or keep the column name but add the FK; prefer `user_id` for clarity),
  - add FK `segment_specified_users_inputs.user_id → users.id` with `ON DELETE RESTRICT`,
  - update PK/index definitions accordingly.
- [ ] Update DB repository helpers:
  - `packages/db/src/repositories/assets/inputs.ts` reads/writes `user_id` (instead of `user_external_id`).
- [ ] Update the config write paths (CLI/API) to hydrate missing users before inserting inputs:
  - `packages/cli/src/commands/assets/roots/enable.ts`:
    - load `WorkerEnv` (requires `TWITTERAPI_IO_TOKEN`) to construct a twitter client for hydration,
    - query for which IDs already exist in `users`,
    - call `UsersHydrationService` for the missing IDs,
    - only then call `replaceSpecifiedUsersInputs`.
  - Update any tests that call `replaceSpecifiedUsersInputs` to either pre-create users (via `upsertUserProfile`) or to
    stub hydration.
- [ ] Scope decision (explicit): do not FK-fence the `segment_*_params.subject_external_id` tables in this pass.
  - Rationale: those IDs are **seed IDs**, not membership IDs, so their existence does not affect membership FK-safety;
    hydration happens at ingest time (graph sync fetches and upserts the primary user profile before any FK-bearing domain
    writes occur).

### Phase 4: Implement tweet hydration wrapper (batch by IDs)

- [ ] Add a new `ingest_kind` value (e.g., `twitterio_api_tweets_by_ids`) via a DB migration.
- [ ] Add a detail table for tweet hydration runs + requested tweet IDs join table.
- [ ] Extend `packages/twitterapi-io` to call `/twitter/tweets`:
  - implement `tweet_ids` as a comma-separated query param (per docs).
- [ ] Implement tweet conversion into the existing `TweetData` / `PostInput` shape.
- [ ] Extend configuration:
  - add `twitterapiIo.batchTweetsByIdsMax` to `config/base.yaml` (and thread it through `packages/config` so it’s
    available on `WorkerEnv`).
- [ ] Implement `TweetsHydrationService` in `packages/ingest`:
  - uses a configurable batch size from `config/base.yaml` (e.g. `twitterapiIo.batchTweetsByIdsMax`),
  - upserts posts via `upsertPosts`,
  - ensures author users are hydrated from the embedded author payloads.
- [ ] Add an operator entrypoint (CLI command) to hydrate a list of tweet IDs (primarily for future asset types).

### Phase 5: Remove placeholder helpers and refactor all writers to hydrate first

- [ ] Add a migration to allow ingest/webhook failure recording without `users` placeholder inserts:
  - drop `users` FKs from:
    - `followers_sync_runs.target_user_id`
    - `followings_sync_runs.source_user_id`
    - `posts_sync_run_target_users.target_user_id`
    - `webhook_follow_events.target_user_id`
    - `webhook_follow_events.follower_user_id` (already nullable; still drop FK)
  - keep the user ID columns (and any `NOT NULL`) so failures still record the relevant IDs.
- [ ] Delete `ensureUser` and `ensureUsers` from `packages/db/src/repositories/users.ts`.
- [ ] Delete `upsertUserHandle` from `packages/db/src/repositories/users.ts` and update webhook ingestion to hydrate the
      target user by ID (ignore handle-only inputs).
- [ ] Remove all `ensureUser` / `ensureUsers` call sites:
  - `packages/db/src/repositories/follows.ts`
  - `packages/db/src/repositories/posts.ts`
  - `packages/db/src/repositories/ingest.ts`
  - `packages/ingest/src/posts.ts`
  - tests that rely on placeholder users for setup
- [ ] Refactor ingest services to explicitly ensure hydration before any FK-dependent writes:
  - followers/followings: hydrate primary user (and any other required IDs) without placeholder inserts
  - posts: hydrate target users before writing `posts_sync_run_target_users` and posts
  - webhook ingest: hydrate target/follower users before inserting webhook detail rows and follow edges
- [ ] Add targeted regression tests proving “no placeholders are created” for these flows:
  - update `packages/ingest/src/ingest.test.ts` to stop relying on placeholder users created via `upsertFollows`
  - update `packages/engine/src/engine.test.ts` to stop using `ensureUsers` and instead rely on hydration behavior
  - update `apps/api/src/server.test.ts` to cover target-user-by-id hydration when the DB is empty
  - update `packages/db/src/repositories/assets/membership.test.ts` to create hydrated users (via profile upserts)
  - update `packages/db/src/pagination.test.ts` to insert a hydrated user (not `{ id }`)

### Phase 6: Backfill legacy placeholders and enforce `last_updated_at` at the schema level

- [ ] Add a CLI/service workflow to hydrate specific user IDs (from Phase 2) and document the dev backfill steps:
  - Query for placeholders: `select id from users where last_updated_at is null order by id;`
  - Hydrate those IDs via the new user-hydration CLI/service in **force** mode (so existing placeholder rows are updated).
  - Verify: `select count(*) from users where last_updated_at is null;` returns 0.
- [ ] Add a migration that enforces `users.last_updated_at NOT NULL` (and fails fast if any nulls remain).
- [ ] Add/extend an integration test that runs `migrateToLatest` and asserts the `NOT NULL` constraint is present.

## Work to Consider Post-Migration

- Add freshness semantics (hydrated “within X”) as an optional layer on top of the baseline “hydrated at least once”.
- Add cross-materialization dedupe so hydration work is shared across concurrent engine runs.
- Move hydration requirements into a richer asset-level API once we have more examples beyond users/posts.
- Add cost-aware batching policies and caching (especially for large specified-user sets and fanout-heavy graphs).
