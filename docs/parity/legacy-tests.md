# Legacy test inventory (retain vs abandon)

This doc enumerates first-party tests in the legacy repo and classifies each as:

- **retain**: keep equivalent coverage in the rewrite (tests will be rewritten in TypeScript/Postgres and may change shape),
- **abandon**: do not port (non-goal, Gel/Python-specific mechanics, or superseded by new architecture).

Legacy repo (local checkout): `/Volumes/bjd_external/Projects/bdastous_monorepo/`

## Scope notes

Included:
- `apps/**/tests/*.py` (excluding any nested `*/.venv/*`),
- `libs/**/tests/*.py`,
- `tests/*.py`,
- `tools/**/tests/*.py`.

Excluded:
- nested virtualenvs (`*/.venv/*`) and other vendored/test-data trees (`read_only_agent_resources/`, `.gel-test-data/`), which contain third-party tests and fixtures not relevant to parity decisions.

## apps/

- **abandon** `apps/gel/tests/test_cli_workflow.py` — Gel CLI workflows; Gel is not ported.
- **abandon** `apps/gel/tests/test_env_overrides.py` — Gel env overrides; `enable-env` + Gel DSN wrappers are not ported.
- **abandon** `apps/http_api/tests/test_cli_compose.py` — legacy Docker-compose CLI wiring; rewrite uses `pnpm dev` + `docker compose` directly.
- **retain** `apps/http_api/tests/test_followers_service.py` — webhook ingest service behavior; port to Fastify handler/service and Postgres-backed repository.
  - Rewrite coverage: `apps/api/src/server.test.ts` (webhook ingestion persists follows + users).
- **retain** `apps/http_api/tests/test_ifttt_webhook.py` — webhook token validation + error mapping; port to Fastify (paths/payloads may change).
  - Rewrite coverage: `apps/api/src/server.test.ts` (token auth + payload validation).
- **abandon** `apps/letta/tests/test_cli_compose.py` — Letta app is not ported.
- **abandon** `apps/scheduler/tests/test_flows_assets.py` — Prefect flows; scheduler is not ported.
- **abandon** `apps/scheduler/tests/test_job_registry.py` — Prefect job registry; not ported.
- **abandon** `apps/scheduler/tests/test_planner_logic.py` — legacy scheduler planner; superseded by the new worker/engine planner.
- **abandon** `apps/scheduler/tests/test_prefect_manifest.py` — Prefect manifests; not ported.
- **abandon** `apps/scheduler/tests/test_settings.py` — scheduler-specific settings; not ported.
- **abandon** `apps/stack/tests/test_cli_compose.py` — legacy stack CLI; superseded by repo-local dev docs + scripts.
- **abandon** `apps/stack/tests/test_cli_scheduler.py` — scheduler orchestration; not ported.
- **abandon** `apps/stack/tests/test_runtime.py` — legacy stack runtime; superseded by the new API+worker local stack.

## libs/

- **retain** `libs/shared/src/shared/config/tests/test_settings.py` — config overlay/override semantics; rewrite tests should validate YAML overlay selection, precedence, and required secrets (with the simplified config model).
  - Rewrite coverage: `packages/config/src/env.test.ts` (defaults + env overrides); YAML overlay behavior is encoded in `packages/config/src/env.ts` (manual spot-check via `docs/parity/test-matrix.md` if needed).
- **abandon** `libs/shared/src/shared/db/tests/test_advisory_locks.py` — Gel-based TTL locks; rewrite uses Postgres advisory locks (different semantics).
- **retain** `libs/shared/src/shared/db/tests/test_asset_events_repository.py` — asset events persistence/invariants; port to Postgres tables + repositories.
  - Rewrite coverage: `packages/db/src/repositories/assets/membership.test.ts` (events/snapshots) + `packages/db/src/repositories/assets/materializations.test.ts` (materialization invariants).
- **retain** `libs/shared/src/shared/db/tests/test_followers_repository_gel.py` — follow-edge persistence semantics (upsert/soft-delete/revive); rewrite as Postgres repository tests.
  - Rewrite coverage: `packages/db/src/repositories/graph.test.ts` + `packages/ingest/src/ingest.test.ts` (full refresh vs incremental semantics).
- **abandon** `libs/shared/src/shared/db/tests/test_gel_client.py` — Gel client integration; not ported.
- **retain** `libs/shared/src/shared/db/tests/test_ingest_repository.py` — ingest run/event persistence and status transitions; rewrite as Postgres repository tests.
  - Rewrite coverage: `packages/ingest/src/ingest.test.ts` (run metadata, status transitions, traceability).
- **abandon** `libs/shared/src/shared/db/tests/test_migration_contracts_gel_semantics.py` — Gel migration contracts; rewrite will have new Postgres-native contracts/tests.
- **retain** `libs/shared/src/shared/db/tests/test_posts_repository_gel.py` — post persistence semantics (upsert/revive/meta); rewrite as Postgres repository tests.
  - Rewrite coverage: `packages/db/src/repositories/graph.test.ts` + `packages/ingest/src/ingest.test.ts` (post upsert + run metadata).
- **retain** `libs/shared/src/shared/segments/tests/test_derived_segments_dependency_snapshots.py` — dependency snapshot semantics; port to the new membership/materialization model.
  - Rewrite coverage: `packages/db/src/repositories/assets/membership.test.ts` (as-of reads) + `packages/engine/src/engine.test.ts` (dependency closure).
- **retain** `libs/shared/src/shared/segments/tests/test_ingest_behaviors.py` — ingest prerequisite behaviors; port to worker/engine planning tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (ingest prereqs, full-once/incremental selection, lock timeouts).
- **retain** `libs/shared/src/shared/segments/tests/test_materialization.py` — materialization invariants and outputs; port to Postgres-backed materializations/events tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` + `packages/db/src/repositories/assets/materializations.test.ts`.
- **retain** `libs/shared/src/shared/segments/tests/test_user_sources.py` — segment user-source behavior; port to TypeScript segment implementations.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (specified users + mutuals segments).
- **retain** `libs/shared/src/shared/tests/test_asset_instance_engine.py` — engine loop semantics (closure, prereqs, materialization gating); port to TypeScript engine tests (use Postgres testcontainers for integration).
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (planner loop + materialization outcomes).
- **retain** `libs/shared/src/shared/tests/test_asset_instance_fanout.py` — fanout root expansion semantics; port to TypeScript engine/closure tests.
  - Rewrite coverage: `packages/db/src/repositories/assets/roots.test.ts` (fanout roots enable/disable).
- **retain** `libs/shared/src/shared/tests/test_asset_instance_validation.py` — params/instance validation; port to TypeScript validation layer (Zod + domain rules).
  - Rewrite coverage: `packages/engine/src/assets/params.test.ts` (params validation) + `packages/engine/src/engine.test.ts` (planner validation warnings).
- **retain** `libs/shared/src/shared/tests/test_asset_params_log_params.py` — stable logging/rendering of params; rewrite should keep deterministic log keys (even if formatting differs).
  - Rewrite coverage: `packages/engine/src/assets/params.test.ts` (formatAssetParams).
- **retain** `libs/shared/src/shared/tests/test_assets_abstractions.py` — asset abstraction invariants; port to TypeScript asset definition interfaces.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (registry-driven materialization paths).
- **retain** `libs/shared/src/shared/tests/test_assets_schema.py` — asset slug/shape consistency checks; port to TypeScript compile-time/runtime checks.
  - Rewrite coverage: `packages/engine/src/assets/params.test.ts` (slug/params shapes) + `packages/db/src/database.ts` (asset_slug enum).
- **abandon** `libs/shared/src/shared/tests/test_compose_cli.py` — legacy compose CLI; not ported.
- **abandon** `libs/shared/src/shared/tests/test_compose_config.py` — legacy compose config (includes Letta); not ported.
- **abandon** `libs/shared/src/shared/tests/test_compose.py` — legacy compose orchestration; not ported.
- **retain** `libs/shared/src/shared/tests/test_db_repositories.py` — repository behavior/invariants (as a suite concept); rewrite should have equivalent Postgres repository integration tests.
  - Rewrite coverage: `packages/db/src/repositories/graph.test.ts`, `packages/db/src/repositories/assets/membership.test.ts`, `packages/db/src/repositories/assets/materializations.test.ts`, `packages/db/src/repositories/assets/roots.test.ts`, `packages/db/src/pagination.test.ts`, `packages/ingest/src/ingest.test.ts`.
- **retain** `libs/shared/src/shared/tests/test_dependency_revisions_hash_v1.py` — dependency revision hashing; port to TypeScript hashing utilities + tests.
  - Rewrite coverage: `packages/engine/src/hashing.test.ts`.
- **abandon** `libs/shared/src/shared/tests/test_gel_health.py` — Gel health checks; not ported.
- **retain** `libs/shared/src/shared/tests/test_instance_aware_ingest_planning.py` — ingest planning with instance context; port to worker/engine planner tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (ingest prereqs + planner decisions).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_checkpoints.py` — membership checkpoint/snapshot correctness; port to Postgres snapshot+events model tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (checkpoint repair) + `packages/db/src/repositories/assets/membership.test.ts` (membership snapshots).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_closure_builder.py` — deterministic closure building; port to TypeScript closure planner tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (dependency closure for mutuals).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_dependency_resolution.py` — dependency resolution semantics; port to TypeScript resolution + DB-backed integration tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (dependency materialization links).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_fanout_expander.py` — fanout expansion correctness; port to TypeScript.
  - Rewrite coverage: `packages/db/src/repositories/assets/roots.test.ts` (fanout root configuration).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_guardrails.py` — guardrails (skip reasons, validation failures, lock contention); port to TypeScript planner/runner tests.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (instance missing, lock timeouts, validation warnings).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_ingest_prereqs_planner.py` — prereq selection rules (“full once then incremental”, recency); port to TypeScript.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (ingest prereqs selection rules).
- **retain** `libs/shared/src/shared/tests/test_instance_engine_materialization_runner.py` — materialization runner semantics; port to TypeScript with Postgres transactions.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` + `packages/db/src/repositories/assets/materializations.test.ts`.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_planner_events.py` — planner decision/event logging; port to TypeScript (structured logs + optional DB event table).
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (planner decision records).
- **retain** `libs/shared/src/shared/tests/test_params_hash_v1.py` — params hashing rules; port to TypeScript asset params hashing with `hash_version`.
  - Rewrite coverage: `packages/engine/src/hashing.test.ts` + `packages/engine/src/assets/params.test.ts`.
- **retain** `libs/shared/src/shared/tests/test_segment_post_corpus_materialization.py` — post corpus asset semantics; port to TypeScript.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (post corpus materialization).
- **retain** `libs/shared/src/shared/tests/test_segments.py` — segment behaviors; port to TypeScript segment suite.
  - Rewrite coverage: `packages/engine/src/engine.test.ts` (specified users, mutuals, follower segments).
- **retain** `libs/shared/src/shared/tests/test_twitterapi_io_client_boundary.py` — API client boundary/typing expectations; port to TypeScript HTTP client boundary rules.
  - Rewrite coverage: `packages/twitterapi-io/src/client.test.ts`.
- **abandon** `libs/shared/src/shared/tests/test_typing_guardrails.py` — Python typing guardrails; superseded by TypeScript strict + ESLint rules in this repo.
- **retain** `libs/shared/src/shared/twitterapi_io/tests/test_followers.py` — followers client behavior; port to TypeScript HTTP client tests/stubs.
  - Rewrite coverage: `packages/twitterapi-io/src/client.test.ts`.

## tests/

- **abandon** `tests/monitoring/test_stack_datadog.py` — legacy stack + Datadog integration; tracing is post-migration/opt-in.
- **retain** `tests/test_cli.py` — CLI wiring smoke tests; rewrite should keep basic CLI command coverage (paths/outputs may change).
  - Rewrite coverage: manual CLI verification in `docs/parity/test-matrix.md` (CLI smoke + local runs).
- **abandon** `tests/test_console_scripts.py` — Python packaging entrypoints; not ported.
- **abandon** `tests/test_datadog_config.py` — legacy Datadog config; tracing is post-migration/opt-in.
- **abandon** `tests/test_docker_compose.py` — legacy compose surface; rewrite uses a simpler `docker-compose.yml` + docs.
- **abandon** `tests/test_enable_env.py` — `enable-env` is explicitly not ported.
- **retain** `tests/test_followers_sync_service.py` — followers sync semantics; rewrite should keep equivalent service-level tests.
  - Rewrite coverage: `packages/ingest/src/ingest.test.ts` (full refresh semantics + run metadata).
- **retain** `tests/test_followings_sync_service.py` — followings sync semantics; rewrite should keep equivalent service-level tests.
  - Rewrite coverage: `packages/ingest/src/ingest.test.ts` (incremental semantics + run metadata).
- **abandon** `tests/test_job_api.py` — legacy job wrapper API (Prefect-oriented); rewrite uses explicit worker/engine orchestration.
- **abandon** `tests/test_lint_guardrails.py` — Python lint guardrails; superseded by TS/ESLint config.
- **abandon** `tests/test_logging.py` — legacy loguru logging; rewrite uses pino; Datadog formatting is optional later.
- **abandon** `tests/test_migration_contracts_end_to_end_gel.py` — Gel migration contracts; rewrite will have Postgres-native migration tests.
- **abandon** `tests/test_no_any_in_segments_generics.py` — Python “no Any” enforcement; superseded by TS strict + ESLint.
- **retain** `tests/test_posts_sync_service.py` — posts sync semantics (windowing, handle requirements, cursor exhaustion semantics); port to TypeScript service tests.
  - Rewrite coverage: `packages/ingest/src/ingest.test.ts` (posts sync run + metadata).
- **retain** `tests/test_recording_repositories.py` — test doubles for repositories; rewrite should maintain equivalents (in TS) for service/engine tests.
  - Rewrite coverage: integration tests using Postgres testcontainers in `packages/db/src/repositories/*.test.ts` + `packages/engine/src/engine.test.ts`.
- **abandon** `tests/test_unique_class_names.py` — Python-only guardrail; not relevant in TS.
- **retain** `tests/test_x_sync_assets_cli.py` — asset CLI behaviors as a reference; rewrite should keep equivalent operator CLI coverage (may differ in shape).
  - Rewrite coverage: manual CLI verification in `docs/parity/test-matrix.md` (assets roots/materialize).

## tools/

- **abandon** `tools/devtools/tests/test_enable_env.py` — `enable-env` is not ported.
- **abandon** `tools/devtools/tests/test_gel_codegen.py` — Gel codegen workflows are not ported.
- **abandon** `tools/devtools/tests/test_gel_rewrite.py` — Gel rewrite tooling; not ported.
- **abandon** `tools/devtools/tests/test_generate_cli_reference.py` — legacy CLI reference generation; rewrite docs are maintained directly in repo.
- **abandon** `tools/devtools/tests/test_query_params_codegen.py` — Gel query params codegen; not ported.
