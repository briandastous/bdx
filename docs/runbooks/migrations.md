# Migrations (Kysely)

This repo uses Kysely’s built-in migration system (file migrations).

Authoritative upstream docs are vendored:

- `docs/vendor/kysely/0.28.9/docs/migrations.mdx`

## Where migrations live

- Source: `packages/db/src/migrations/`
- Built output: `packages/db/dist/migrations/`

Naming:
- Use a zero-padded numeric prefix so alphanumeric order matches execution order (e.g. `0002_create_users.ts`).

## How to write a migration

Each file exports:

- `up(db: Kysely<any>): Promise<void>`
- `down(db: Kysely<any>): Promise<void>`

Guidelines:
- Use `Kysely<any>` (migrations are “frozen in time” and must not depend on the evolving `Database` type).
- Prefer Kysely’s schema builder; use `sql` only when needed for Postgres-specific features.
- Avoid importing application code into migrations.

## How migrations are executed

This repo provides:

- `packages/db/src/migrate.ts` (`migrateToLatest`, `migrateToLatestWithLock`)

Policy:
- Local dev: migrations may be run via CLI or automatically by the worker.
- Staging/prod: migrations should run from the worker only (guarded by an advisory lock), with `RUN_MIGRATIONS=false` as a kill switch.

## Commands

Run migrations once:

- `(set -a; source .env.local; set +a; pnpm db:migrate)`

Auto-migrate on worker start:

- Set `RUN_MIGRATIONS=true` (default is `true`).

## Baseline reset

This is a new repo with a fresh Postgres database. Before Phase 2/3 schema work begins, we will rewrite `packages/db/src/migrations/0001_init.ts` to be the true foundation migration for the rewrite. After that, migrations are append-only and should not be edited.

