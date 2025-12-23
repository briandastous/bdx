# Local development

This runbook covers local setup and common workflows for the Node + Postgres rewrite.

## Prereqs

- Node 24 (see `.nvmrc`)
- `pnpm`
- Docker (for Postgres)

## Env setup

- `cp .env.example .env.local`
- Edit `.env.local` to set secrets and `DEPLOY_ENV`.
- Keep non-secret config in `config/*.yaml`.

Required env vars in `.env.local`:

- `DATABASE_URL`
- `WEBHOOK_TOKEN`
- `TWITTERAPI_IO_TOKEN`
- `DEPLOY_ENV`
- `X_SELF_USER_ID` and `X_SELF_HANDLE` (or set `x.self.*` in YAML)

If port 5432 is already in use, set both:

- `DB_PORT=5433`
- `DATABASE_URL=postgres://bdx:bdx@localhost:5433/bdx`

## Quickstart

1. Install dependencies:
   - `pnpm install`
2. Start Postgres:
   - `pnpm db:up`
3. Run migrations:
   - `(set -a; source .env.local; set +a; pnpm db:migrate)`
4. Run API + worker:
   - `(set -a; source .env.local; set +a; pnpm dev)`

## Common commands

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm lint:fix`

## Pre-commit hooks

This repo uses Husky + lint-staged to run:

- formatting (Prettier),
- linting with auto-fix (ESLint),
- full TypeScript typecheck (`pnpm typecheck`).

Hooks install on `pnpm install` (via `prepare`). To skip hooks temporarily:

- `HUSKY=0 git commit ...`

To verify hooks are active:

- `git config --local core.hooksPath`

## CLI examples (full commands)

Build the CLI:

- `(set -a; source .env.local; set +a; pnpm --filter @bdx/cli build)`

Seed users for specified-users segments (needed for the example below):

- `docker compose exec -T db psql -U bdx -d bdx -c "insert into users (id, is_deleted) values (111, false), (222, false) on conflict (id) do update set is_deleted = false;"`

Enable a root instance:

- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js assets:roots:enable --slug segment_specified_users --params '{"stableKey":"manual-1","fanoutSourceParamsHash":null}' --specified-user-ids "111,222")`

Trigger one tick:

- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js worker:tick)`

Disable the root:

- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js assets:roots:disable --slug segment_specified_users --params '{"stableKey":"manual-1","fanoutSourceParamsHash":null}')`

Fanout roots (optional):

- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js assets:fanout-roots:enable --source-slug segment_specified_users --source-params '{"stableKey":"manual-1","fanoutSourceParamsHash":null}' --target-slug segment_followers --fanout-mode global_per_item)`
- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js assets:fanout-roots:disable --source-slug segment_specified_users --source-params '{"stableKey":"manual-1","fanoutSourceParamsHash":null}' --target-slug segment_followers --fanout-mode global_per_item)`

Ingest CLI (requires a real token):

- `(set -a; source .env.local; set +a; node packages/cli/dist/bin.js ingest:followers --user-id 123 --mode incremental)`

Inspect the latest materializations:

- `docker compose exec -T db psql -U bdx -d bdx -c "select id, asset_slug, status, started_at, completed_at from asset_materializations order by id desc limit 5;"`

## Known gotchas

- **DB_PORT vs DATABASE_URL**: `pnpm db:up` validates that the host port matches the port in
  `DATABASE_URL`. If they disagree, fix both.
- **Host Postgres conflicts**: if your machine has Postgres on 5432, use a different port
  (for example, `DB_PORT=5433` and `DATABASE_URL=postgres://bdx:bdx@localhost:5433/bdx`).
- **Docker env scope**: Docker Compose reads `.env` by default, not `.env.local`. The `pnpm db:up`
  helper loads `.env.local` and sets `DB_PORT` for you.
- **Postgres 18 volumes**: the Compose file mounts `/var/lib/postgresql`. If you change it to
  `/var/lib/postgresql/data`, Postgres 18 will refuse to start with a data directory error.
- **CLI command IDs**: use `assets:roots:enable` (not `assets:roots enable`) and similar `:` commands.
- **Specified users**: `segment_specified_users` requires the referenced `users` rows to exist. Seed
  the users before running `worker:tick` to avoid transaction errors.
- **Ingest tokens**: `ingest:*` commands require a real `TWITTERAPI_IO_TOKEN` to hit the API.
- **Env pollution**: wrap commands with `(set -a; source .env.local; set +a; ...)` to avoid leaking
  variables into your parent shell.
