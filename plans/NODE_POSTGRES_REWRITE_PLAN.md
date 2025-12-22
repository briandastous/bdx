# Node + Postgres Rewrite Plan (TypeScript + Kysely)

This document turns `docs/NODE_POSTGRES_REWRITE.md` from research into an executable plan for this
repository. We will start fresh in Postgres (no data migration from Gel).

## Legacy Repo References

The parity source of truth is the legacy codebase (`bdastous_monorepo`).

- Local checkout (this machine): `/Volumes/bjd_external/Projects/bdastous_monorepo/` (non-portable path; for convenience only)
- Key docs to reference:
  - `docs/ANALYSIS.md` (architecture + data model)
  - `docs/CLI_REFERENCE.md` (operator surface, commands)
  - `docs/NODE_POSTGRES_REWRITE.md` (scope decisions for this rewrite)
  - `dbschema/default.gel` (legacy schema + constraints)

## Goals / Non-Goals

### Goals

- Achieve functional parity for everything under **“Must port (core product behavior)”** in `docs/NODE_POSTGRES_REWRITE.md`.
  - API details may change where TypeScript/Postgres best practices call for it, but the behaviors and invariants should match.
- Replace Python + Gel with **Node.js (Active LTS only) + TypeScript (strict) + Postgres + Kysely**.
- Preserve the product’s core conceptual model:
  - Graph ingest (users, follows, posts) with soft-deletion and “revival on re-seen”.
  - Full-fidelity asset system: instances, roots, fanout roots, closure planning, ingest prerequisites, materializations, provenance, membership events, membership snapshots, and checkpoint repair.
  - A single long-running **engine runner** (“worker”) that drives ingest as prerequisites and materializes assets.
- Provide operator surfaces:
  - CLI(s) for ad-hoc sync and asset instance/root management.
  - Local/dev stack orchestration to run API + worker + Postgres.
- Provide webhook ingestion for “new follower” (or equivalent) events with token-based auth.
- Provide observability sufficient to debug “why did this run happen / what did it touch”:
  - Structured logs with run IDs and materialization IDs.
  - Persisted run metadata/provenance in Postgres.

### Non-Goals

- Do not port anything listed under **“Do not port (Gel/Python-specific mechanics)”** in `docs/NODE_POSTGRES_REWRITE.md`, including:
  - Gel/EdgeQL schema and codegen workflows.
  - Prefect Cloud and its deployment model (the engine runner replaces it).
- Do not port the Letta app/server (it is not part of the rewrite’s v1 scope or local/dev stack).
- Do not port anything listed under **“Defer (rebuild later on the TypeScript foundation)”**, especially:
  - Enter/exit/scheduled hook execution machinery (`*ActionRun` tables/claim/retry) and the Python hook APIs.
- Do not port `enable-env` or any secrets-injection wrapper workflow.
  - Use standard environment variables for secrets and fail-fast validation (no wrapper-coupled workflows).
  - Use YAML overlays for non-secret configuration per “Configuration (Decision)”.
  - Treat `.env.example` (and optionally env-specific examples) as documentation/templates only.
- No data migration from Gel (fresh Postgres database).
- No requirement to preserve current endpoint paths, payload shapes, or CLI UX exactly (functional parity > interface parity).
- No UI is required for the initial rewrite (operator CLI + logs + DB state are sufficient).

## Acceptance Criteria

### Repository + Tooling

- The repo targets Node **24 LTS** and TypeScript **strict** (including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`).
- The repo builds, lints, typechecks, and tests in CI with reproducible installs via `pnpm-lock.yaml`.
- TypeScript implementation and review follows `docs/typescript/best_practices` (deviations require explicit justification).

### Documentation

- The repo includes a minimal root `README.md` that is kept accurate as the implementation evolves:
  - local/dev quickstart (Node/pnpm, Postgres via `docker-compose`, `.env.local`, `DEPLOY_ENV`, `pnpm dev`),
  - migration workflow (how to author/execute migrations and the worker/CLI policy),
  - pointers to `plans/NODE_POSTGRES_REWRITE_PLAN.md` and other key docs.
- The repo includes lightweight runbooks for:
  - Postgres migrations (how they’re written/executed and operational safety controls),
  - Railway deploy shape (api + worker services, env vars/secrets, running ops via Railway SSH),
  - API/OpenAPI conventions (including BigInt-as-string at the HTTP boundary).
- Kysely documentation is made actionable and version-accurate:
  - a vendored snapshot of the Kysely docs for the pinned version,
  - a repo runbook (`docs/runbooks/kysely.md`) plus a Codex skill (`kysely-workflows`) that references it.

### Configuration (Decision)

- Use YAML overlays for **non-secret** configuration and environment variables for **secrets**:
  - `NODE_ENV` remains the standard Node runtime mode (`development|test|production`).
  - `DEPLOY_ENV` selects the deployment/config profile (`development|staging|production`) and drives YAML overlays.
    - Default `DEPLOY_ENV` to `production` when `NODE_ENV=production`, otherwise default to `development`.
    - Do not introduce `DEPLOY_ENV=test`; automated tests should use `NODE_ENV=test` without a YAML overlay.
  - `config/base.yaml` + `config/env/<DEPLOY_ENV>.yaml` (deep-merged; env overlay overrides base).
  - Environment variables override YAML when both are provided (required for platforms like Railway).
- Keep secrets out of YAML:
  - `DATABASE_URL`, `WEBHOOK_TOKEN`, and any API tokens/credentials must come from environment variables only.
- Validate the fully-resolved config at startup (Zod) and fail fast on missing/invalid values.

### Query Strategy (Decision)

- Avoid 1:1 “port every EdgeQL query” translations.
- Prefer well-factored, reusable Kysely query utilities so cross-query reuse is a first-class benefit of the rewrite:
  - shared projections (stable “what fields do we select” helpers),
  - shared joins (common relationships expressed once),
  - shared filters (soft-delete semantics, status predicates, etc.).
- Prefer cursor pagination (over offset pagination) for list endpoints:
  - use `kysely-cursor` (or an equivalent cursor helper) directly (no homegrown pagination implementation).
  - if we add helpers, keep them thin: centralize ordering rules + response shape, but do not reimplement token encoding/decoding.
  - mitigate cross-version cursor token compatibility concerns by pinning versions and treating cursor tokens as opaque + short-lived (token invalidation across deploys is acceptable).

### IDs + Keys (Decision)

- Use `bigint generated always as identity` surrogate primary keys for non-upstream/internal tables (runs, materializations, params, instances, events, etc.).
- Use X/Twitter IDs as Postgres `bigint` and TypeScript `bigint` end-to-end for `users` and `posts`.
  - At HTTP/JSON boundaries, accept IDs as strings (or numbers when safe) and normalize to `bigint`; never emit JSON `bigint` values directly.
- Use the upstream X/Twitter ID as the primary key for `users` and `posts`:
  - `users.id` is the X user ID (`bigint`, not identity).
  - `posts.id` is the X post ID (`bigint`, not identity).
- Avoid polymorphic foreign keys for “asset items”:
  - Use typed membership and enter/exit event tables per asset family/item type (segments → `users`, post corpora → `posts`).
  - If we add a new asset family with a new item type, add new typed membership/event tables (and optional union views) rather than introducing polymorphic FK logic.
  - Prefer a single typed **events** table per item type (rather than separate physical enter/exit tables):
    - store `event_type` (`enter`/`exit`) on the events table and enforce `UNIQUE(materialization_id, item_id)` so a materialization cannot write both enter+exit for the same item,
    - store enter-only fields (e.g., `is_first_appearance`) as nullable columns and enforce correctness via `CHECK` constraints (e.g., `event_type = 'enter'` implies `is_first_appearance is not null`; `event_type = 'exit'` implies `is_first_appearance is null`),
    - optionally expose read-friendly `*_enter_events` / `*_exit_events` **views** over the single events table.

### Constraints (Policy)

- Prefer Postgres-native, declarative constraints whenever possible:
  - `NOT NULL`, `DEFAULT`, `PRIMARY KEY`, `FOREIGN KEY` (with `ON DELETE CASCADE` when appropriate),
  - `UNIQUE` constraints and/or unique indexes (including partial unique indexes),
  - `CHECK` constraints for state invariants (e.g., `(status = 'in_progress') = (completed_at IS NULL)`).
- If a legacy invariant cannot be expressed declaratively, prefer reshaping the schema so it *can* be expressed (e.g., split polymorphic tables into typed tables).
- If it still cannot be expressed declaratively and it is **context-free integrity** (must hold regardless of caller/service), prefer **triggers** over repository-only enforcement.
- If an invariant requires **caller context** (e.g., needs a run/materialization ID, depends on workflow semantics), enforce it in the repository/query layer (Kysely) and back it with tests.
- Any invariant not enforced declaratively must be explicitly documented (see “Invariant Register”) with its chosen enforcement mechanism and a test strategy.

### Hashing (Decision)

- Use `sha256` (hex) for `params_hash`, `inputs_hash`, and dependency revision hashes.
- Store a `hash_version` alongside stored hashes so canonicalization can evolve safely.
- Prefer explicit, per-asset “hash input” builders over hashing arbitrary objects:
  - represent IDs as decimal strings in hash inputs (e.g., `userId.toString()`),
  - sort any set-like collections deterministically before hashing,
  - omit `undefined` entirely; use `null` only when semantically meaningful,
  - ensure object keys are stable and ordered when serialized.

### Handles (Decision)

- Store the current handle on `users.handle` (`text`, nullable) and enforce case-insensitive uniqueness via:
  - `users.handle_norm text generated always as (lower(handle)) stored`,
  - a unique index on `users.handle_norm` where `handle is not null`.
- Preserve legacy handle reassignment behavior:
  - when setting a handle for a user, clear it from any other user currently holding that handle (in the same transaction),
  - record changes in `user_handle_history` (append-only) when a user’s handle changes.

### BigInt in Node (Decision)

- Configure `postgres` (postgres-js) so Postgres `bigint` is parsed as JavaScript `bigint` (not string).
- Treat JSON as a boundary format that cannot carry `bigint`:
  - accept ID inputs as strings and normalize to `bigint`,
  - emit IDs as strings in API responses and logs-as-data payloads (logs can still include numeric strings for readability).
  - document IDs in OpenAPI as `type: string` with `format: int64` (never JSON numbers).

### Testing Stack (Decision)

- Use `docker-compose` Postgres for the human local/dev stack.
- Use `testcontainers` Postgres for automated integration tests so tests are hermetic and do not depend on a fixed local port or pre-running DB.

### Ingest Metadata (Decision)

- Use a normalized “base + detail tables” model (legacy parity with `x_ops::IngestEvent` + specialized run/event types):
  - `ingest_events` as the base table (internal `bigint generated always as identity` primary key, `ingest_kind`, `created_at`).
  - 1:1 detail tables per ingest kind (each keyed by `ingest_event_id` with a `UNIQUE` FK), e.g.:
    - `followers_sync_runs`,
    - `followings_sync_runs`,
    - `posts_sync_runs`,
    - `webhook_follow_events` (or equivalent webhook event table).
  - join tables where the detail type is multi-target (e.g., `posts_sync_run_target_users`).
- Keep “what wrote this row” traceability via lightweight link tables (e.g., follow/post/user meta tables referencing `ingest_events`).
  - Divergence from legacy: model followers vs followings runs as separate detail tables (instead of one shared “follows runs” table).

### Membership “As-Of” Reads (Decision)

- Compute membership “as-of” a historical successful materialization by **rewinding from the current membership snapshot** using **enter/exit events** recorded after the target.
  - Assume the target materialization is not very old (dependency pinning should typically reference recent materializations), so scanning events since the target is acceptable.
  - Correctness rule: each enter/exit event is a membership toggle; to rewind from checkpoint → target, **toggle** an item iff it has an **odd** number of events in the window `(target, checkpoint]`.
    - Equivalent: `membership_at_target = snapshot_membership XOR flipped_items`, where `flipped_items` are items with `count(events) % 2 = 1` in that window.
  - If the current snapshot checkpoint is older than the requested target (cannot rewind), treat this as an invariant violation and run checkpoint repair (or fail fast) before continuing.

### Operator Surfaces

- A CLI exists for operator workflows (commands and flags may differ from legacy; behavior parity matters).
  - includes: migrations, ad-hoc ingest runs, and root/instance management.
- Local/dev stack orchestration exists to run API + worker + Postgres.
  - Postgres runs via `docker-compose`.
  - API + worker can be started with a single documented command (or a small, explicit sequence) and use:
    - `.env.example` as the template for required **secrets** and platform-provided env vars,
    - `config/*.yaml` as the template for **non-secret** configuration.

### Non-Goals (Enforced)

- The rewrite does not include:
  - Letta app/server or its orchestration.
  - Prefect Cloud deployment model or scheduler workers.
  - `enable-env` (or any secrets injection wrapper) as a required workflow.
  - Hook execution DB artifacts / APIs (`*ActionRun` claim/retry machinery and Python hook APIs).

### Parity + Divergence Policy

- Match legacy behavior for everything under **“Must port (core product behavior)”** in `docs/NODE_POSTGRES_REWRITE.md`, unless we explicitly decide to diverge.
- If we discover a likely **bug** or important **feature gap** in the legacy implementation, do not reproduce it by default.
  - Document it in this plan (see “Legacy Bugs / Feature Gaps”) with: legacy location, observed behavior, impact, and a proposed resolution.
  - Bring it to the project owner for an explicit decision (port as-is vs fix vs defer).

### Database (Postgres)

- The schema supports (at minimum) the following concepts with explicit constraints/indexing:
  - Users keyed by X user ID (`users.id`) with profile fields and soft-deletion.
  - Handle uniqueness and handle history on change.
  - Follows edges with uniqueness on `(follower_id, target_id)` and soft-deletion + revival semantics.
  - Posts keyed by X post ID (`posts.id`) with soft-deletion + revival semantics and author linkage.
  - Ingest run records (followers/followings/posts) with status, timestamps, cursor exhaustion, and last upstream HTTP metadata.
  - Asset instances (code-defined definitions; data-defined instances) with param-structural identity (hashing), roots, fanout roots.
  - Asset materializations with provenance:
    - `dependency_materializations` (what was used),
    - `requested_by_materializations` (fanout/scheduling provenance),
    - stable hashes (`inputs_hash`, dependency revision hash equivalent).
  - Membership projection:
    - immutable enter/exit events per materialization,
    - membership snapshot table as the “current membership” checkpoint,
    - ability to compute membership “as of” a historical materialization.
- Advisory locks (or an equivalent Postgres mechanism) prevent concurrent materialization for the same instance.

### Ingest

- Followers/followings sync supports both incremental and full-refresh modes and preserves the write semantics:
  - edges are upserted, soft-deleted when removed, and revived on re-seen.
  - ingest runs persist status + last upstream error/http metadata.
- Posts sync preserves the write semantics:
  - posts are upserted by X post ID (`posts.id`), revived on re-seen, and stored with enough metadata to support post-corpus assets.
  - posts ingest run metadata is persisted (per-run and per-user context as needed).
- All ingest paths are auditable in the DB (what ran, when, why, and what state was written).

### Asset System + Engine Runner

- The worker runs a long-lived engine loop that:
  - expands enabled roots + fanout roots to a deterministic dependency closure,
  - evaluates ingest prerequisites based on recency/locks and triggers ingest inline,
  - materializes instances when inputs/dependencies changed (and no-op when they didn’t),
  - records planner decisions when work is skipped (validation, lock contention, stale dependencies, ingest failure).
- The initial rewrite ships with one engine runner and no separate job queue:
  - advisory locks + recency tables coordinate work; ingest is invoked inline as prerequisites.
- Asset materializations:
  - are immutable, have a stable ID, and record inputs + dependency materializations used,
  - write enter/exit events and update the membership snapshot on success,
  - support “membership as-of” reads by rewinding from snapshot via events,
  - have checkpoint repair logic to recover from missing/invalid snapshots/events.
- Hook execution (`*ActionRun` and related behavior) does not exist in v1, but the foundational data needed to rebuild it later does exist (materializations, events, membership snapshots, provenance).

### Webhook API

- A webhook endpoint exists for “new follower” events with token-based auth and runtime validation.
- Webhook ingestion persists an event record and updates the graph state (users/follows) with traceability.
- The API publishes an OpenAPI document generated from runtime validation schemas (for agent/client consumption).

### Observability

- Logs are structured and include correlation IDs (ingest run IDs, materialization IDs) for debugging.
- Operational failures (rate limit, upstream errors, lock timeouts) are represented as explicit statuses and persisted metadata.
- Defer pruning “rich” provenance (large request/response payloads, verbose history tables) until after parity + logging/tracing are verified; then keep only what we actually query/use and add retention policies as needed.

## Architecture

This repository is a pnpm monorepo with three operator/runtime entrypoints that all share the same Postgres schema.

### Components

- `apps/api` (Fastify): webhook ingestion + operator read APIs.
- `apps/worker`: long-running engine runner; owns ingest prerequisites + asset materializations.
- `packages/cli` (`bdx`): operator CLI (migrations, ad-hoc ingest, root/instance management).

### Shared packages + boundaries

- `packages/config`: configuration loading (YAML overlays + env secrets) and fail-fast validation (Zod).
- `packages/db`: Postgres access (Kysely + postgres-js), migrations, and repository/query utilities.
  - Only this layer should talk to SQL/driver primitives; apps/services should go through repositories.
  - Configure Postgres `bigint` ⇄ JS `bigint` per “BigInt in Node (Decision)”.
- `packages/engine`: deterministic planner/runner logic for closure planning and materialization (DB-driven).
- `packages/observability`: structured logging primitives.

### Migrations (Kysely)

- Migrations are Kysely “file migrations” executed by `Migrator` + `FileMigrationProvider`.
- Author migrations as TypeScript modules under `packages/db/src/migrations/` (compiled to `packages/db/dist/migrations/`).
  - Naming: use a zero-padded, increasing numeric prefix so alphanumeric order matches desired execution order (e.g., `0002_create_users.ts`).
  - Each migration exports `up(db: Kysely<any>)` and `down(db: Kysely<any>)` and should not reference the app’s evolving `Database` type.
  - Keep migrations “frozen in time”: do not import application code; use only `kysely` (schema builder + `sql`) and simple data transforms when required.
- Migration baseline (Decision):
  - This is a new repo with a fresh Postgres database; before real schema work begins, rewrite `packages/db/src/migrations/0001_init.ts` to be the true foundation migration.
  - After that baseline is established, treat migrations as append-only and immutable.
- Execute migrations via `packages/db` helpers:
  - `migrateToLatest` (library) runs all pending migrations and returns results.
  - `migrateToLatestWithLock` adds an advisory lock around migrations; Kysely’s migrator also serializes concurrent migration calls via its own DB lock table.
- Operational policy:
  - Local dev: allow running migrations via CLI or worker-on-start.
  - Staging/prod: run migrations from the worker only (with advisory lock) and keep `RUN_MIGRATIONS` as a kill switch.
  - Prefer expand/contract migrations; for destructive/high-risk migrations (drops/renames/big backfills), temporarily disable auto-migrate and run a one-off command via Railway SSH.

### Key runtime flows

- **Local/dev stack orchestration**
  - Postgres runs via `docker-compose`.
  - API + worker run via `pnpm dev` (or an equivalent single documented command/sequence).
  - Migrations are run either explicitly via CLI or automatically by the worker (guarded by an advisory lock and `RUN_MIGRATIONS`).
- **Webhook ingestion (API)**
  - Authenticate via token, validate payload, normalize IDs at the JSON boundary, write an `ingest_events` row + detail row, and upsert graph state with traceability.
- **Engine loop (worker)**
  - On each tick: expand enabled roots/fanout roots → compute closure → satisfy ingest prerequisites (with recency/locks) → materialize eligible instances.
  - A materialization is an immutable transaction: create materialization row, record provenance/dependency links, write enter/exit events, update the membership snapshot.

### Concurrency + invariants

- Postgres is the source of truth; invariants are enforced per “Constraints (Policy)” and tracked in the “Invariant Register”.
- Advisory locks prevent concurrent work for the same logical target (e.g., migrations and instance materialization).

## Legacy Bugs / Feature Gaps

Track legacy issues we discover during parity work that should not be copied blindly into the rewrite.

- Legacy “as-of” membership query appears to rewind using only the latest event per item after the target (which is incorrect if an item flips multiple times between target and checkpoint).
  - Legacy reference: `/Volumes/bjd_external/Projects/bdastous_monorepo/libs/shared/src/shared/edgeql/asset_instances/fetch_instance_user_membership_external_ids_as_of_materialization_by_params_hash.edgeql`
  - Rewrite approach: parity-based rewind using event toggle counts (see “Membership “As-Of” Reads (Decision)”).

## Invariant Register

Track invariants from legacy Gel constraints / required fields / Python checks and decide how each is enforced in Postgres.

For each invariant, record:
- legacy source (Gel constraint, required field, Python enforcement point),
- rewrite enforcement (constraint / schema shape / trigger / repository),
- test strategy (unit/integration).

- _None recorded yet._

## Work Plan

### Phase 1: Scope Freeze + Parity Inventory

- [ ] Phase 1 exit criteria (Gate): do not begin Phase 2/3 schema migrations until these artifacts exist and have been reviewed.
  - [ ] “Invariant Register” is seeded for core graph + ingest + assets (at minimum, everything we can extract from `dbschema/default.gel` plus key Python-enforced invariants like soft-delete/revive and membership snapshot/event consistency).
  - [ ] “Legacy Bugs / Feature Gaps” is actively maintained: any suspected legacy bug/behavior gap discovered during parity work is recorded here and surfaced to the owner for an explicit decision (port as-is vs fix vs defer).
  - [ ] A first-pass parity test matrix exists (linking “Must port” bullets to planned tests or explicit manual verification steps).
- [ ] Establish baseline repo documentation (keep it minimal, but accurate).
  - [ ] Add a root `README.md` with local/dev quickstart and pointers to the plan.
  - [ ] Add `docs/runbooks/migrations.md` (how to author/run migrations; worker/CLI policy; safety notes).
  - [ ] Add `docs/runbooks/deploy-railway.md` (service shape + env vars + ops via Railway SSH).
  - [ ] Vendor Kysely docs and make them actionable for implementation.
    - [ ] Add a vendored snapshot under `docs/vendor/kysely/<version>/` matching the pinned `kysely` version.
    - [ ] Add `docs/runbooks/kysely.md` with:
      - [ ] a bdx-specific section (conventions and required patterns),
      - [ ] a comprehensive index of the vendored upstream docs.
    - [ ] Add a Codex skill under `.codex/skills/kysely-workflows/` that points to `docs/runbooks/kysely.md` and the vendored docs.
- [ ] Confirm the exact “Must port” feature set by mapping each bullet in `docs/NODE_POSTGRES_REWRITE.md` to concrete behaviors and data invariants.
  - [ ] Enumerate all ingest job variants (followers, followings, posts) and their modes (incremental vs full refresh).
  - [ ] Enumerate all asset slugs and their params shapes from the current Python implementation.
    - [ ] For each asset slug, record:
      - [ ] params fields + identity semantics (what affects params hash vs inputs hash),
      - [ ] dependency specs (other assets),
      - [ ] ingest dependencies (what upstream syncs are prerequisites),
      - [ ] membership item type (user IDs vs post IDs).
  - [ ] Document “defer” and “do not port” items explicitly, with a checklist that they are absent in the rewrite.
  - [ ] If any additional “zombie” asset features are discovered during parity work, document them and get explicit sign-off before deprecating.
- [ ] Inventory legacy invariants (beyond schema) and seed the “Invariant Register”.
  - [ ] Extract invariants from `dbschema/default.gel` (required fields, exclusives, expression constraints, delete semantics).
  - [ ] Identify any invariants enforced primarily in Python (validation, state transitions, soft-delete/revive semantics).
- [ ] Define naming/ID conventions for the rewrite (IDs, hashes, timestamps, “deleted at” columns).
  - [ ] Apply the repo’s decided primary key strategy and document it in the schema/migrations.
    - [ ] Use `bigint generated always as identity` surrogate primary keys for internal tables.
    - [ ] Use X/Twitter IDs as Postgres `bigint` + TypeScript `bigint` for `users` and `posts` (and normalize at boundaries).
    - [ ] Use upstream X/Twitter IDs as the primary keys for `users` and `posts` (`users.id`, `posts.id`).
    - [ ] Use typed membership/event tables per asset family/item type (avoid polymorphic FKs).
  - [ ] Implement the decided hash strategy (`sha256` + `hash_version` + canonicalization rules).
  - [ ] Implement configuration overlays (non-secret) + env-based secrets.
    - [ ] Add `config/base.yaml` and `config/env/<DEPLOY_ENV>.yaml` (non-secret only).
    - [ ] Define and document precedence (env overlay overrides base; env vars override YAML).
    - [ ] Update `packages/config` to load YAML + env and validate the resolved config with Zod.
    - [ ] Ensure local dev workflow is explicit: `.env.local` for secrets (gitignored) + YAML for non-secrets.
- [ ] Create a parity test matrix linking acceptance criteria to planned tests (unit/integration/e2e).

### Phase 2: Postgres Schema Design (Core Graph + Ingest)

- [ ] Establish the rewrite’s migration baseline (Option B).
  - [ ] Rewrite `packages/db/src/migrations/0001_init.ts` to create the foundation schema for the rewrite (extensions/enums/base tables as needed).
  - [ ] After `0001_init.ts` is rewritten for the rewrite, treat subsequent migrations as append-only and immutable.
- [ ] Map legacy Gel constraints to Postgres constraints for core graph + ingest tables (using `dbschema/default.gel` as the source).
  - [ ] For each invariant, choose enforcement per “Constraints (Policy)” and record it in the “Invariant Register”.
- [ ] Design and implement migrations for core graph entities.
  - [ ] `users`
    - [ ] `id` is the X user ID (`bigint` primary key) + stable identity fields.
    - [ ] `handle` + `handle_norm` (generated) with case-insensitive uniqueness and handle reassignment semantics.
    - [ ] soft-delete (`deleted_at`) and “revive on re-seen” semantics.
    - [ ] “last ingest” metadata pointers (run IDs/timestamps) where helpful.
  - [ ] `user_handle_history`
    - [ ] record handle changes with timestamps and source ingest event linkage.
  - [ ] `follows`
    - [ ] unique edge `(follower_id, target_id)` with soft-delete + revive.
    - [ ] indexes to support “followers of X” and “followings of X”.
  - [ ] `posts`
    - [ ] `id` is the X post ID (`bigint` primary key), link to author, `posted_at`, text/lang, raw JSON.
    - [ ] index to support “posts by author ordered by posted_at”.
- [ ] Design and implement migrations for ingest metadata.
  - [ ] `ingest_events` (base table) with kind + timestamps + correlation IDs.
  - [ ] `followers_sync_runs`, `followings_sync_runs`, and `posts_sync_runs` (detail tables keyed by `ingest_event_id`) with:
    - [ ] status enum, timestamps, cursor exhaustion flags,
    - [ ] last upstream HTTP metadata (status code, error payload, retry-after if relevant),
    - [ ] per-run parameters (`sync_mode`, `since`, target user IDs, etc.).
    - [ ] `CHECK` constraint for status/completed_at invariants.
  - [ ] `webhook_follow_events` (detail table keyed by `ingest_event_id`) for “new follower” webhooks.
  - [ ] join tables for multi-target runs (e.g., `posts_sync_run_target_users`).
  - [ ] ensure all ingest writes can be associated to a run/event for auditing.
- [ ] Add Postgres advisory lock conventions for:
  - [ ] migrations (single migrator),
  - [ ] per-instance materialization (Phase 4+),
  - [ ] per-target ingest (optional; if needed for correctness/throughput).

### Phase 3: Postgres Schema Design (Assets + Materializations + Membership)

- [ ] Map legacy Gel constraints to Postgres constraints for asset params/instances/materializations/events/membership (using `dbschema/default.gel` as the source).
  - [ ] Decide how to model “asset items” so membership/events can have enforceable uniqueness and (when possible) foreign keys.
  - [ ] For each invariant, choose enforcement per “Constraints (Policy)” and record it in the “Invariant Register”.
- [ ] Design and implement the foundational asset tables.
  - [ ] asset instance identity
    - [ ] `asset_params` (or per-slug params tables) with `(asset_slug, params_hash)` uniqueness.
    - [ ] `asset_instances` with a 1:1 relationship to params and query-friendly `asset_slug/params_hash` columns.
  - [ ] “maintenance intent”
    - [ ] `asset_instance_roots` for operator-enabled root instances (soft-disable with timestamp).
    - [ ] `asset_instance_fanout_roots` describing fanout behavior from a source instance.
  - [ ] materializations + provenance
    - [ ] `asset_materializations` (immutable run records) with:
      - [ ] `inputs_hash`,
      - [ ] links to `dependency_materializations`,
      - [ ] links to `requested_by_materializations`,
      - [ ] status enum + timestamps + error payload.
  - [ ] events + membership projection
    - [ ] typed events tables (segments → users, post corpora → posts) with `event_type` (`enter`/`exit`) and `UNIQUE(materialization_id, item_id)`.
      - [ ] add `CHECK` constraints for enter-only fields (e.g., `is_first_appearance`).
      - [ ] add optional `*_enter_events` / `*_exit_events` views for readability.
    - [ ] typed membership snapshot tables storing current membership checkpoint per instance (segments → users, post corpora → posts).
    - [ ] `asset_instance.current_membership_materialization_id` pointer (or equivalent).
  - [ ] Design segment-specific and post-corpus-specific tables needed for v1 parity.
  - [ ] segments
    - [ ] tables for segment materializations and typed membership (user IDs).
    - [ ] tables for mutable segment inputs that affect `inputs_hash` but not params identity (e.g., “specified users set”).
  - [ ] post corpora
    - [ ] tables for post-corpus materializations and typed membership (post IDs).
    - [ ] event fields for “first appearance” semantics (store on events table for `event_type='enter'` with `CHECK` constraint).
- [ ] Add planner decision/event tables used for auditability.
  - [ ] `scheduler_planner_events` (or equivalent) with decision + reason + references to runs/materializations.
  - [ ] optional: `scheduler_policy_overrides` if needed for parity or future policy tuning.

### Phase 4: DB Access Layer + Codegen + Query Utilities

- [ ] Integrate `kysely-codegen` for schema→types generation (or an equivalent approach).
  - [ ] Decide whether generated DB types are committed or generated in CI.
  - [ ] Add a stable command for regeneration and a diff check for accidental drift.
- [ ] Implement DB module conventions.
  - [ ] connection pool configuration (timeouts, max connections, statement timeouts).
  - [ ] transaction helpers (explicit transaction boundaries in repositories/services).
  - [ ] advisory lock helpers (scoped acquire/release + timeout behavior).
- [ ] Implement shared Kysely query utilities (avoid duplicated ad-hoc queries).
  - [ ] projections (stable field selection helpers for common read shapes).
  - [ ] joins (common relationship joins expressed once).
  - [ ] filters (soft-delete semantics, status predicates, etc.).
  - [ ] cursor pagination utilities using `kysely-cursor` (or equivalent).
    - [ ] define a shared cursor/page result shape and consistent ordering rules.
    - [ ] add tests for pagination stability (deterministic order + no duplicates across pages).
- [ ] Implement repositories for core graph and ingest metadata.
  - [ ] Users repository:
    - [ ] upsert by X user ID (`users.id`),
    - [ ] handle history update with uniqueness enforcement,
    - [ ] soft-delete + revive paths.
  - [ ] Follows repository:
    - [ ] upsert edge + revive,
    - [ ] soft-delete removed edges for full refresh,
    - [ ] efficient “diff” queries to compare stored actives vs upstream actives.
  - [ ] Posts repository:
    - [ ] upsert by X post ID (`posts.id`) + revive,
    - [ ] author linkage and ordering queries.
  - [ ] Ingest runs repository:
    - [ ] create/update run status,
    - [ ] persist last HTTP metadata and error payloads,
    - [ ] query run history for “since cursor” planning.
- [ ] Implement repositories for asset system (instances/materializations/events/membership).
  - [ ] instance CRUD (create deterministic instances from params; enforce uniqueness).
  - [ ] materialization insert + status transitions.
  - [ ] enter/exit event insertion helpers.
  - [ ] membership snapshot read/write helpers.

### Phase 5: twitterapi.io Client (Typed + Rate-Limit Aware)

- [ ] Establish an OpenAPI-driven generation workflow for twitterapi.io (parity with legacy `openapi/twitterapi.io.yaml` + generator script).
  - [ ] Copy `openapi/twitterapi.io.yaml` into this repo (as the pinned contract for codegen and review).
  - [ ] Add a `pnpm`-based generator script (analogous to legacy `uvx` workflow) that runs without permanently adding codegen dependencies to the workspace.
    - [ ] Prefer `pnpm dlx` with a pinned generator version.
  - [ ] Generate TypeScript types (and only types) from the OpenAPI spec.
    - [ ] Keep generated types in a dedicated internal package and treat them as generated artifacts.
    - [ ] Add an import boundary so only the handwritten adapter layer imports the generated types.
- [ ] Implement a typed twitterapi.io client module.
  - [ ] define request/response types for the required endpoints (user lookup, followers, followings, posts search).
  - [ ] implement error mapping:
    - [ ] rate-limit detection and retry-after parsing,
    - [ ] transient vs terminal errors.
  - [ ] capture HTTP metadata needed for auditability (status, headers, request id if available).
- [ ] Add a test harness for the client.
  - [ ] unit tests for error mapping and pagination.
  - [ ] optionally: fixture-based tests for parsing (no live network calls in CI).

### Phase 6: Ingest Jobs (Followers/Followings/Posts)

- [ ] Implement followers and followings sync jobs with parity semantics.
  - [ ] inputs (target user id / handle, mode incremental/full, pagination cursor options).
  - [ ] create an ingest run record at start and update it through completion/failure.
  - [ ] fetch pages with backoff/rate-limit handling.
  - [ ] upsert users discovered during traversal.
  - [ ] upsert follow edges and revive on re-seen.
  - [ ] for full refresh:
    - [ ] compute removals and soft-delete missing edges.
  - [ ] for incremental:
    - [ ] stop conditions based on encountering existing relationships (parity with current behavior).
- [ ] Implement posts sync job(s) with parity semantics.
  - [ ] design the query/windowing strategy (respect upstream max query length and result window limits).
  - [ ] persist posts upserted by X post ID (`posts.id`) and revive on re-seen.
  - [ ] persist per-run metadata and “synced since” semantics for later planning.
  - [ ] implement batching logic consistent with the planner’s needs (chunk sizes, overlap windows).
- [ ] Ensure every ingest write is traceable to a run/event record.

### Phase 7: Asset Definitions (Segments + Post Corpora)

- [ ] Implement the code-defined asset registry.
  - [ ] define a stable “asset slug” convention and registry lookup.
  - [ ] define params types per asset slug and deterministic params hashing.
  - [ ] define dependency specs (other assets) and ingest dependency specs (required ingests + staleness policy).
- [ ] Implement segment assets with parity semantics.
  - [ ] specified users segment:
    - [ ] params shape (identity),
    - [ ] mutable input table for the user set (affects inputs hash),
    - [ ] materialization logic producing membership (user IDs).
  - [ ] followers segment / mutuals segment (and any other required segment types):
    - [ ] params shape,
    - [ ] dependencies on ingested graph state,
    - [ ] materialization logic.
- [ ] Implement post-corpus assets with parity semantics.
  - [ ] SegmentPostCorpus (posts authored by members of a segment instance):
    - [ ] resolve membership “as-of” a dependency segment materialization,
    - [ ] produce membership (post IDs),
    - [ ] implement “first appearance” semantics if required.

### Phase 8: Asset Instance Execution Engine (Planner + Runner)

- [ ] Implement the planner core loop.
  - [ ] load enabled roots and fanout roots.
  - [ ] validate roots and record planner events on invalid configuration.
  - [ ] expand dependency closure deterministically (create missing dependency instances when safe/deterministic).
  - [ ] resolve ingest prerequisites from instance params and dependency materializations.
  - [ ] determine staleness/recency and trigger ingest inline as needed.
  - [ ] select dependency materializations and compute:
    - [ ] `inputs_hash`,
    - [ ] dependency revisions hash equivalent,
    - [ ] “no-op” decision when nothing changed.
  - [ ] record planner decisions for:
    - [ ] lock contention/timeouts,
    - [ ] ingest failures,
    - [ ] missing materializations,
    - [ ] validation errors.
- [ ] Implement materialization execution with advisory locks.
  - [ ] per-instance lock acquisition (with timeout) to avoid concurrent runs.
  - [ ] insert `asset_materialization` record at start and transition status on completion/failure.
  - [ ] compute membership diff vs prior snapshot and insert enter/exit events.
  - [ ] update membership snapshot atomically on success.
- [ ] Implement membership “as-of” reads.
  - [ ] define ordering semantics for the `(target, checkpoint]` window (materialization time + stable tie-breakers).
  - [ ] implement rewind algorithm per “Membership “As-Of” Reads (Decision)” (toggle parity over events).
  - [ ] add indexes to keep rewind queries performant (by instance + materialization time + item).
- [ ] Implement checkpoint repair.
  - [ ] detect invalid/missing snapshots for an instance.
  - [ ] rebuild snapshot from a known good baseline (or from scratch) using event history.
  - [ ] record planner events when repair occurs.

### Phase 9: Worker Service (Long-Running Engine Runner)

- [ ] Harden the worker service to run continuously.
  - [ ] migrations-on-start controlled by env var and guarded by advisory lock.
  - [ ] graceful shutdown and signal handling.
  - [ ] configurable tick cadence and a “single tick then exit” mode for ops.
  - [ ] structured logging and correlation fields.
- [ ] Add worker health reporting.
  - [ ] process-level heartbeat (log + DB marker) for “worker is alive”.
  - [ ] optional HTTP `/healthz` endpoint for the worker if the deploy platform benefits from it.

### Phase 10: HTTP API Service (Webhook + Operator Read APIs)

- [ ] Use explicit dependency injection for DB access (no `fastify-kysely` decoration) and standardize route patterns accordingly.
  - [ ] Keep routes thin: validate → call repositories/services → map errors → respond.
  - [ ] Ensure DB lifecycle is tied to server lifecycle (auto-destroy/close on server close).
- [ ] Generate OpenAPI docs from runtime validation schemas (Zod-first).
  - [ ] Pick and document the Zod→OpenAPI approach and keep it consistent across routes.
  - [ ] Serve an OpenAPI JSON document (e.g., `/openapi.json`) for agent/client consumption.
  - [ ] Document API/OpenAPI conventions in `docs/runbooks/api.md` (ID formats, error shapes, pagination, auth).
- [ ] Implement webhook ingestion endpoint(s).
  - [ ] token-based auth (query param or header).
  - [ ] runtime validation (Zod).
  - [ ] persist webhook event record with traceability fields.
  - [ ] upsert relevant graph records (users/follows) as part of webhook handling.
  - [ ] error mapping:
    - [ ] 4xx for invalid input/auth,
    - [ ] 503 with retry hints for upstream rate-limit errors (if enrichment occurs inline).
- [ ] Add minimal operator read APIs (optional, but useful).
  - [ ] endpoint(s) to inspect recent ingest runs and materializations by ID.
  - [ ] endpoint(s) to list enabled roots/fanout roots and their current materialization status.

### Phase 11: CLI (Operator Tools)

- [ ] Decide final CLI framework (oclif as default) and migrate the CLI package to it.
  - [ ] `db:migrate` (run migrations with lock).
  - [ ] `ingest:followers`, `ingest:followings`, `ingest:posts` (ad-hoc ingest runs).
  - [ ] `assets:roots` management:
    - [ ] enable/disable root instances,
    - [ ] create instances deterministically from params.
  - [ ] `assets:materialize` / `worker:tick` (force a single planner tick).
  - [ ] ergonomic output: IDs, statuses, and “where to look in logs”.

### Phase 12: Observability + Operational Hardening

- [ ] Add correlation IDs and structured logging conventions.
  - [ ] standard fields: `service`, `env`, `run_id`, `materialization_id`, `asset_instance_id`, `asset_slug`.
  - [ ] propagate IDs through service layers without `any` escape hatches.
- [ ] Add Postgres-level safety controls.
  - [ ] statement timeouts for long queries.
  - [ ] idempotent “upsert” patterns to tolerate retries.
- [ ] Audit persisted provenance volume and add retention policies once logging/tracing is verified.
  - [ ] avoid storing large request/response bodies unless we can demonstrate they are queried/useful.
  - [ ] add DB-level retention (time-based deletes) for high-volume event/run tables where safe.

### Phase 13: Testing + Validation (Parity Focus)

- [ ] Build a layered test strategy.
  - [ ] unit tests for hashing, params identity, and core planner decisions.
  - [ ] repository tests using a real Postgres instance via testcontainers.
  - [ ] ingest job tests with mocked upstream responses (fixture-based).
  - [ ] engine/materialization integration tests:
    - [ ] membership diff/event insertion,
    - [ ] snapshot updates and as-of reads,
    - [ ] lock contention handling.
  - [ ] webhook API tests (auth, validation, DB writes).
- [ ] Create a parity checklist and keep it green.
  - [ ] for each “Must port” bullet, add at least one test (or an explicit manual verification step with instructions).

### Phase 14: Local Dev + Deployment (Railway Staging/Prod)

- [ ] Local dev UX.
  - [ ] `docker-compose` Postgres with documented config:
    - [ ] secrets/env vars (`.env.example` + `.env.local`),
    - [ ] non-secret YAML overlays (`config/*.yaml`).
  - [ ] one-command local run for API + worker (document exact commands).
  - [ ] migration workflow for local dev (worker auto-migrate vs explicit CLI migrate).
- [ ] Railway deployment shape.
  - [ ] `api` service (Fastify) and `worker` service (engine runner), same repo, different entrypoints.
  - [ ] Postgres (Railway-managed).
  - [ ] avoid Railway cron jobs for the engine loop (use a long-running worker); reserve cron only for bounded maintenance tasks or “one tick then exit”.
  - [ ] ensure migrations run only from `worker` with advisory lock and a kill switch (`RUN_MIGRATIONS=false`).
  - [ ] staging environment first; promote to prod when stable.
  - [ ] document how to run operator commands in staging/prod via Railway SSH against the `worker` service (optional dedicated `ops` service later if needed).

## Work to Consider Post-Migration

If the single engine runner becomes too coupled/slow (parallelism, isolation, durable retries, or multi-worker scaling), consider introducing a job execution substrate:

- Prefer Postgres-backed jobs first (`graphile-worker` or `pg-boss`) to keep infra minimal.
- Consider a Redis-backed queue (`bullmq`) if we need higher queue throughput or want to protect OLTP load.
- Consider Temporal only if we need durable workflow semantics that justify the operational overhead.

If logs + DB provenance aren’t sufficient in staging/prod, consider adding Datadog tracing as an opt-in:

- Adopt `dd-trace` only once we have a staging environment and recurring debugging/perf needs that structured logs + persisted run/materialization provenance aren’t solving.
- If adopted:
  - run a `datadog-agent` Railway service and point `DD_AGENT_HOST` at its private domain,
  - ensure `dd-trace` initialization happens first (ESM load order), with service tagging + log correlation enabled,
  - keep local dev tracing opt-in with low sampling.
