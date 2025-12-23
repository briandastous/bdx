# bdx (rewrite)

This repo is a planned rewrite of the legacy Python+Gel system (local reference: `/Volumes/bjd_external/Projects/bdastous_monorepo/`) to **Node 24 LTS + TypeScript (strict) + Postgres + Kysely**.

- Plan: `plans/NODE_POSTGRES_REWRITE_PLAN.md`
- Runbooks:
  - `docs/runbooks/migrations.md`
  - `docs/runbooks/kysely.md`
  - `docs/runbooks/api.md`
  - `docs/runbooks/local-dev.md`
  - `docs/runbooks/deploy-railway.md`

## Local development

### Prereqs

- Node `24` (`.nvmrc`)
- `pnpm`
- Docker (for Postgres)

### Quickstart

1. Install deps:
   - `pnpm install`
2. Configure secrets + `DEPLOY_ENV`:
   - `cp .env.example .env.local`
   - Edit `.env.local` with your editor (e.g. `code .env.local` / `vim .env.local`).
   - Ensure `TWITTERAPI_IO_TOKEN`, `X_SELF_USER_ID`, and `X_SELF_HANDLE` are set (or set the X self values in YAML).
3. Configure non-secret settings (optional):
   - Edit `config/base.yaml` and/or `config/env/development.yaml`.
4. Start Postgres:
   - `pnpm db:up`
   - If port 5432 is already in use, set `DB_PORT` and update `DATABASE_URL` accordingly
     (e.g. `DB_PORT=5433`, `DATABASE_URL=postgres://bdx:bdx@localhost:5433/bdx`).
5. Run migrations:
   - `(set -a; source .env.local; set +a; pnpm db:migrate)`
6. Run API + worker:
   - `(set -a; source .env.local; set +a; pnpm dev)`

Notes:
- Using `( … )` runs in a subshell so `.env.local` variables don’t persist in your parent shell session.
- `.env.local` is gitignored and should contain secrets (and `DEPLOY_ENV`) only; keep non-secret config in `config/*.yaml`.

## Common commands

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## CLI quick reference

- Asset roots:
  - `bdx assets:roots:enable`
  - `bdx assets:roots:disable`
- Fanout roots:
  - `bdx assets:fanout-roots:enable`
  - `bdx assets:fanout-roots:disable`
- Worker tick:
  - `bdx worker:tick`
