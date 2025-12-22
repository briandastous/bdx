# Railway deploy shape

This is the intended Railway layout for the rewrite (staging/prod). The old system was never put into production, so there’s no fixed timeline.

## Services

- `api` (Fastify): webhook ingestion + operator read APIs.
- `worker` (long-running): engine runner; owns ingest prerequisites + materializations.
- `postgres` (Railway-managed).
- Optional (staging/prod only): `datadog-agent` (tracing/log correlation), per plan.

## Environment variables

Secrets must be provided via Railway environment variables (not YAML):

- `DATABASE_URL`
- `WEBHOOK_TOKEN`

Config profile selection:

- `NODE_ENV` (`development|test|production`)
- `DEPLOY_ENV` (`development|staging|production`)

Operational controls:

- `RUN_MIGRATIONS` (default `true`; set `false` to disable auto-migrate)

## Migrations

- Worker is the only service that should auto-run migrations in staging/prod.
- Migrations are guarded by an advisory lock (`bdx:migrations`) to prevent concurrent execution.
- For high-risk migrations (drops/renames/backfills), disable auto-migrate and run a one-off command via Railway SSH against the worker.

See: `docs/runbooks/migrations.md`.

## Ops / CLI

Run operator commands via Railway SSH against the `worker` service so they execute close to Postgres with the correct env:

- `railway ssh --service worker -- <command>`

(Exact CLI commands will evolve; see `plans/NODE_POSTGRES_REWRITE_PLAN.md`.)

