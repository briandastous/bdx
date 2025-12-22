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
- **retain** `apps/http_api/tests/test_ifttt_webhook.py` — webhook token validation + error mapping; port to Fastify (paths/payloads may change).
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
- **abandon** `libs/shared/src/shared/db/tests/test_advisory_locks.py` — Gel-based TTL locks; rewrite uses Postgres advisory locks (different semantics).
- **retain** `libs/shared/src/shared/db/tests/test_asset_events_repository.py` — asset events persistence/invariants; port to Postgres tables + repositories.
- **retain** `libs/shared/src/shared/db/tests/test_followers_repository_gel.py` — follow-edge persistence semantics (upsert/soft-delete/revive); rewrite as Postgres repository tests.
- **abandon** `libs/shared/src/shared/db/tests/test_gel_client.py` — Gel client integration; not ported.
- **retain** `libs/shared/src/shared/db/tests/test_ingest_repository.py` — ingest run/event persistence and status transitions; rewrite as Postgres repository tests.
- **abandon** `libs/shared/src/shared/db/tests/test_migration_contracts_gel_semantics.py` — Gel migration contracts; rewrite will have new Postgres-native contracts/tests.
- **retain** `libs/shared/src/shared/db/tests/test_posts_repository_gel.py` — post persistence semantics (upsert/revive/meta); rewrite as Postgres repository tests.
- **retain** `libs/shared/src/shared/segments/tests/test_derived_segments_dependency_snapshots.py` — dependency snapshot semantics; port to the new membership/materialization model.
- **retain** `libs/shared/src/shared/segments/tests/test_ingest_behaviors.py` — ingest prerequisite behaviors; port to worker/engine planning tests.
- **retain** `libs/shared/src/shared/segments/tests/test_materialization.py` — materialization invariants and outputs; port to Postgres-backed materializations/events tests.
- **retain** `libs/shared/src/shared/segments/tests/test_user_sources.py` — segment user-source behavior; port to TypeScript segment implementations.
- **retain** `libs/shared/src/shared/tests/test_asset_instance_engine.py` — engine loop semantics (closure, prereqs, materialization gating); port to TypeScript engine tests (use Postgres testcontainers for integration).
- **retain** `libs/shared/src/shared/tests/test_asset_instance_fanout.py` — fanout root expansion semantics; port to TypeScript engine/closure tests.
- **retain** `libs/shared/src/shared/tests/test_asset_instance_validation.py` — params/instance validation; port to TypeScript validation layer (Zod + domain rules).
- **retain** `libs/shared/src/shared/tests/test_asset_params_log_params.py` — stable logging/rendering of params; rewrite should keep deterministic log keys (even if formatting differs).
- **retain** `libs/shared/src/shared/tests/test_assets_abstractions.py` — asset abstraction invariants; port to TypeScript asset definition interfaces.
- **retain** `libs/shared/src/shared/tests/test_assets_schema.py` — asset slug/shape consistency checks; port to TypeScript compile-time/runtime checks.
- **abandon** `libs/shared/src/shared/tests/test_compose_cli.py` — legacy compose CLI; not ported.
- **abandon** `libs/shared/src/shared/tests/test_compose_config.py` — legacy compose config (includes Letta); not ported.
- **abandon** `libs/shared/src/shared/tests/test_compose.py` — legacy compose orchestration; not ported.
- **retain** `libs/shared/src/shared/tests/test_db_repositories.py` — repository behavior/invariants (as a suite concept); rewrite should have equivalent Postgres repository integration tests.
- **retain** `libs/shared/src/shared/tests/test_dependency_revisions_hash_v1.py` — dependency revision hashing; port to TypeScript hashing utilities + tests.
- **abandon** `libs/shared/src/shared/tests/test_gel_health.py` — Gel health checks; not ported.
- **retain** `libs/shared/src/shared/tests/test_instance_aware_ingest_planning.py` — ingest planning with instance context; port to worker/engine planner tests.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_checkpoints.py` — membership checkpoint/snapshot correctness; port to Postgres snapshot+events model tests.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_closure_builder.py` — deterministic closure building; port to TypeScript closure planner tests.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_dependency_resolution.py` — dependency resolution semantics; port to TypeScript resolution + DB-backed integration tests.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_fanout_expander.py` — fanout expansion correctness; port to TypeScript.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_guardrails.py` — guardrails (skip reasons, validation failures, lock contention); port to TypeScript planner/runner tests.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_ingest_prereqs_planner.py` — prereq selection rules (“full once then incremental”, recency); port to TypeScript.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_materialization_runner.py` — materialization runner semantics; port to TypeScript with Postgres transactions.
- **retain** `libs/shared/src/shared/tests/test_instance_engine_planner_events.py` — planner decision/event logging; port to TypeScript (structured logs + optional DB event table).
- **retain** `libs/shared/src/shared/tests/test_params_hash_v1.py` — params hashing rules; port to TypeScript asset params hashing with `hash_version`.
- **retain** `libs/shared/src/shared/tests/test_segment_post_corpus_materialization.py` — post corpus asset semantics; port to TypeScript.
- **retain** `libs/shared/src/shared/tests/test_segments.py` — segment behaviors; port to TypeScript segment suite.
- **retain** `libs/shared/src/shared/tests/test_twitterapi_io_client_boundary.py` — API client boundary/typing expectations; port to TypeScript HTTP client boundary rules.
- **abandon** `libs/shared/src/shared/tests/test_typing_guardrails.py` — Python typing guardrails; superseded by TypeScript strict + ESLint rules in this repo.
- **retain** `libs/shared/src/shared/twitterapi_io/tests/test_followers.py` — followers client behavior; port to TypeScript HTTP client tests/stubs.

## tests/

- **abandon** `tests/monitoring/test_stack_datadog.py` — legacy stack + Datadog integration; tracing is post-migration/opt-in.
- **retain** `tests/test_cli.py` — CLI wiring smoke tests; rewrite should keep basic CLI command coverage (paths/outputs may change).
- **abandon** `tests/test_console_scripts.py` — Python packaging entrypoints; not ported.
- **abandon** `tests/test_datadog_config.py` — legacy Datadog config; tracing is post-migration/opt-in.
- **abandon** `tests/test_docker_compose.py` — legacy compose surface; rewrite uses a simpler `docker-compose.yml` + docs.
- **abandon** `tests/test_enable_env.py` — `enable-env` is explicitly not ported.
- **retain** `tests/test_followers_sync_service.py` — followers sync semantics; rewrite should keep equivalent service-level tests.
- **retain** `tests/test_followings_sync_service.py` — followings sync semantics; rewrite should keep equivalent service-level tests.
- **abandon** `tests/test_job_api.py` — legacy job wrapper API (Prefect-oriented); rewrite uses explicit worker/engine orchestration.
- **abandon** `tests/test_lint_guardrails.py` — Python lint guardrails; superseded by TS/ESLint config.
- **abandon** `tests/test_logging.py` — legacy loguru logging; rewrite uses pino; Datadog formatting is optional later.
- **abandon** `tests/test_migration_contracts_end_to_end_gel.py` — Gel migration contracts; rewrite will have Postgres-native migration tests.
- **abandon** `tests/test_no_any_in_segments_generics.py` — Python “no Any” enforcement; superseded by TS strict + ESLint.
- **retain** `tests/test_posts_sync_service.py` — posts sync semantics (windowing, handle requirements, cursor exhaustion semantics); port to TypeScript service tests.
- **retain** `tests/test_recording_repositories.py` — test doubles for repositories; rewrite should maintain equivalents (in TS) for service/engine tests.
- **abandon** `tests/test_unique_class_names.py` — Python-only guardrail; not relevant in TS.
- **retain** `tests/test_x_sync_assets_cli.py` — asset CLI behaviors as a reference; rewrite should keep equivalent operator CLI coverage (may differ in shape).

## tools/

- **abandon** `tools/devtools/tests/test_enable_env.py` — `enable-env` is not ported.
- **abandon** `tools/devtools/tests/test_gel_codegen.py` — Gel codegen workflows are not ported.
- **abandon** `tools/devtools/tests/test_gel_rewrite.py` — Gel rewrite tooling; not ported.
- **abandon** `tools/devtools/tests/test_generate_cli_reference.py` — legacy CLI reference generation; rewrite docs are maintained directly in repo.
- **abandon** `tools/devtools/tests/test_query_params_codegen.py` — Gel query params codegen; not ported.

