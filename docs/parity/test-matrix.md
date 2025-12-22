# Parity test matrix (Phase 1 seed)

This matrix maps “Must port (core product behavior)” from `docs/archive/NODE_POSTGRES_REWRITE_RESEARCH.md` to the tests and/or manual verification we will use to confirm parity.

Guiding principles:
- Prefer behavior parity over interface parity (endpoint paths/CLI flags may change).
- Prefer DB-backed integration tests for invariants and state transitions.
- Use unit tests for pure logic (hashing, pagination, planners).

Legacy repo (local checkout): `/Volumes/bjd_external/Projects/bdastous_monorepo/`

## Legacy test inventory (retain vs abandon)

In addition to mapping “Must port” features to new tests, we maintain an inventory of the legacy test suite and decide which tests’ *coverage* we will retain (rewritten in TypeScript/Postgres) vs abandon (non-goals or Gel/Python-specific mechanics).

See: `docs/parity/legacy-tests.md`.

## Ingest + persistence

- [ ] Persist X/Twitter graph data: users, follows, posts.
  - Legacy reference: `docs/ANALYSIS.md`, `dbschema/default.gel` (`x_core::*`)
  - Rewrite tests:
    - [ ] integration: migrations create the expected tables + constraints.
    - [ ] integration: repository upserts create users/follows/posts and revive soft-deleted rows.
- [ ] Preserve ingest run metadata and traceability (run IDs, timestamps, status, last API error/status).
  - Legacy reference: `dbschema/default.gel` (`x_ops::*`), `_graph_sync_base.py`, `posts_sync.py`
  - Rewrite tests:
    - [ ] integration: status/completed_at constraints enforced.
    - [ ] integration: failure paths persist `last_api_status`, `last_api_error`, and HTTP snapshots when present.
- [ ] Preserve key write semantics currently relied on by services/tests.
  - Follow edges: upsert + soft-delete + revive.
    - Legacy reference: `edgeql/followers/upsert_follow.edgeql`, `_graph_sync_base.py` (full refresh soft-deletes missing).
    - Rewrite tests: [ ] integration: full refresh marks removals soft-deleted; incremental never deletes.
  - Posts: upsert by external id + revive.
    - Legacy reference: `edgeql/posts/upsert_post.edgeql`
    - Rewrite tests: [ ] integration: re-upsert does not duplicate and clears `is_deleted`.
  - Handle history recorded on change + handle uniqueness enforced.
    - Legacy reference: `edgeql/common/upsert_user_profile.edgeql`
    - Rewrite tests: [ ] integration: handle steal clears previous owner and inserts `user_handle_history`.

## Asset system (full fidelity)

- [ ] Asset instances, roots, fanout roots, closure planning, dependency resolution.
  - Legacy reference: `docs/ANALYSIS.md` (asset overview), `libs/shared/src/shared/assets/instance_engine/*`
  - Rewrite tests:
    - [ ] integration: instance identity is structural (params hashing + uniqueness).
    - [ ] integration: root enable/disable and fanout root enable/disable behave correctly.
    - [ ] integration: closure expansion produces deterministic instance sets and surfaces validation issues.
- [ ] Ingest prerequisites (recency + locks) and “engine drives ingest via dependencies”.
  - Legacy reference: `libs/shared/src/shared/assets/instance_engine/ingest_prereqs.py`
  - Rewrite tests:
    - [ ] integration: stale prereq triggers ingest runner call under advisory lock.
    - [ ] integration: “full once, then incremental” selection rule for follows prereqs is preserved.
- [ ] Materializations, events/provenance, membership projection, checkpoint repair.
  - Legacy reference:
    - Segments: `libs/shared/src/shared/segments/base.py`, `.../definitions/*`
    - Post corpora: `libs/shared/src/shared/assets/post_corpus.py`
    - Checkpoints: `libs/shared/src/shared/assets/instance_engine/checkpoints.py`
  - Rewrite tests:
    - [ ] integration: materialization status transitions and completed_at constraints.
    - [ ] integration: enter/exit events are written and `UNIQUE(materialization_id, item_id)` enforced.
    - [ ] integration: membership snapshot updates and checkpoint pointer updates on success.
    - [ ] integration: membership-as-of reads are correct for multi-toggle cases (explicit regression vs legacy behavior).
    - [ ] integration: checkpoint repair restores invariants when snapshots/events are inconsistent.

## Long-running engine runner (worker)

- [ ] Run a single engine process that evaluates roots/fanout roots and materializes as needed.
  - Legacy reference: `docs/ANALYSIS.md` + Prefect flow description; `instance_engine/engine.py`
  - Rewrite tests:
    - [ ] integration: one “tick” runs end-to-end using a controlled DB fixture and deterministic clocks.
    - [ ] manual: local `pnpm dev` runs worker loop and produces expected logs/DB rows.
- [ ] Triggers ingest as prerequisites (not separate scheduled workers).
  - Legacy reference: `instance_engine/ingest_prereqs.py`
  - Rewrite tests: covered by “Ingest prerequisites” tests above.

## Operator interfaces

- [ ] CLI(s) to run ad-hoc syncs and manage asset instances/roots.
  - Legacy reference: `docs/CLI_REFERENCE.md` (`x-sync jobs ...`, `x-sync assets ...`)
  - Rewrite tests:
    - [ ] integration: CLI commands call repositories correctly (smoke tests).
    - [ ] manual: local CLI can create/track/untrack instances and roots against local Postgres.
- [ ] Local/dev stack orchestration (API + worker + DB).
  - Legacy reference: `docs/ANALYSIS.md` (stack CLI; includes non-goals like Letta).
  - Rewrite verification:
    - [ ] manual: `docker compose up -d db` + `pnpm db:migrate` + `pnpm dev` starts API+worker with a fresh DB.

## Webhook API

- [ ] Webhook endpoint for “new follower” events with token-based auth.
  - Legacy reference: `x_ops::IFTTTFollowEvent` in `dbschema/default.gel`, `docs/ANALYSIS.md` webhook flow.
  - Rewrite tests:
    - [ ] integration: request validation + auth; rejects missing/invalid token.
    - [ ] integration: successful webhook persists an event row and upserts graph state with traceability.
- [ ] OpenAPI doc is generated from runtime validation schemas.
  - Legacy reference: research doc requires this for agent/client consumption.
  - Rewrite tests:
    - [ ] integration: OpenAPI endpoint exists and includes webhook schemas.

## Observability

- [ ] Structured logs correlated by run IDs and materialization IDs.
  - Legacy reference: `docs/ANALYSIS.md` (traceability emphasis)
  - Rewrite verification:
    - [ ] integration: logger emits required fields for key workflows (ingest runs, materializations).
    - [ ] manual: `pnpm dev` logs are readable and correlate to DB rows.
- [ ] Enough provenance to debug “why did this run happen / what did it touch”.
  - Legacy reference: `x_ops::*` metadata tables and asset materialization provenance links in `dbschema/default.gel`.
  - Rewrite tests:
    - [ ] integration: materialization rows link dependency materializations + requested_by provenance.
    - [ ] integration: ingest runs link to the rows they wrote (or equivalent traceability model).
