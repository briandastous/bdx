# Kysely Runbook

This repo pins the currently installed Kysely version as the source of truth.

- Installed version: `kysely@0.28.9` (see `pnpm-lock.yaml`)
- Vendored upstream docs snapshot: `docs/vendor/kysely/0.28.9/` (MIT; see `docs/vendor/kysely/0.28.9/LICENSE`)

## How to use this runbook

1. Follow **BDX conventions** below (repo-specific rules and defaults).
2. When you need authoritative Kysely behavior/typing details, read the vendored docs:
   - start at `docs/vendor/kysely/0.28.9/README.md`
   - then navigate by topic under `docs/vendor/kysely/0.28.9/docs/`
3. Prefer encoding repeatable patterns as reusable helpers in `packages/db` rather than re-deriving
   them per call site.

## BDX conventions (repo-specific)

### DB access boundaries

- Keep SQL usage in `packages/db`:
  - apps/services call repositories/helpers, not raw Kysely queries.
- Accept `Db` (or `Transaction<Database>`) as a parameter to repositories/helpers so they compose
  cleanly inside transactions.

### Postgres + BigInt

- Postgres `bigint` is parsed as JS `bigint` (configured in `packages/db/src/db.ts`).
- JSON is a boundary format that cannot carry `bigint`:
  - accept IDs as strings at HTTP boundaries and normalize to `bigint`,
  - emit IDs as strings in API responses,
  - document IDs in OpenAPI as `type: string` + `format: int64`.

### Transactions

- Prefer explicit transaction boundaries for multi-step writes:
  - use `db.transaction().execute(async (trx) => { ... })` and pass `trx` through.
- Do not hide implicit transactions inside helpers that are commonly composed together (avoid
  accidental nested transactions and unclear atomicity).

### Migrations

- Use Kysely file migrations via `Migrator` + `FileMigrationProvider` (see `packages/db/src/migrate.ts`).
- Keep migrations “frozen in time”:
  - do not import app code or evolving `Database` types,
  - use only `kysely` schema builder and `sql` where needed.
- Baseline reset policy: before real schema work begins, rewrite `packages/db/src/migrations/0001_init.ts`
  into the true foundation migration for the rewrite; after that, treat migrations as immutable.

### Raw SQL (`sql`) usage

- Prefer Kysely’s schema builder/query builder; use `sql` only for:
  - Postgres-specific features that don’t have a first-class builder API,
  - performance-critical expressions where the builder becomes unwieldy,
  - advisory locks and small utility queries.
- Keep `sql` usage localized and covered by tests when it encodes business-critical invariants.

### Reuse-first query design

- Prefer reusable query utilities over 1:1 translations from legacy EdgeQL:
  - shared projections (stable “select shapes”),
  - shared filters (soft-delete semantics, status predicates),
  - shared joins (common relationships expressed once).

### Cursor pagination

- Prefer cursor pagination over offset pagination for list endpoints.
- If using `kysely-cursor`:
  - treat cursor tokens as opaque and short-lived (token invalidation across deploys is acceptable),
  - avoid homegrown token encode/decode logic.

## Vendored Kysely docs (comprehensive index)

The Kysely project’s documentation (for this pinned version) is vendored under:

- `docs/vendor/kysely/0.28.9/docs/`

### Key entry points

- Intro: `docs/vendor/kysely/0.28.9/docs/intro.mdx`
- Getting started: `docs/vendor/kysely/0.28.9/docs/getting-started.mdx` and `docs/vendor/kysely/0.28.9/docs/getting-started/`
- Query execution + transactions: `docs/vendor/kysely/0.28.9/docs/execution.mdx` and `docs/vendor/kysely/0.28.9/docs/examples/transactions/`
- Migrations: `docs/vendor/kysely/0.28.9/docs/migrations.mdx`
- Dialects: `docs/vendor/kysely/0.28.9/docs/dialects.md`
- Plugins: `docs/vendor/kysely/0.28.9/docs/plugins.md`
- Generating types: `docs/vendor/kysely/0.28.9/docs/generating-types.md`
- Recipes (patterns and best practices): `docs/vendor/kysely/0.28.9/docs/recipes/`
- Examples (task-oriented cookbook): `docs/vendor/kysely/0.28.9/docs/examples/`
- Integrations: `docs/vendor/kysely/0.28.9/docs/integrations/`
- Runtime notes: `docs/vendor/kysely/0.28.9/docs/runtimes/`

### Search tips

- Search vendored docs by keyword:
  - `rg -n \"<keyword>\" docs/vendor/kysely/0.28.9/docs`
- Find recipes quickly:
  - `ls docs/vendor/kysely/0.28.9/docs/recipes`
- Note: many pages are MDX that import `.mdx` fragments and `.tsx` components (Docusaurus). When a page looks like a thin wrapper, follow its `import` statements to the referenced files under the same directory tree.

## Updating the snapshot (when upgrading Kysely)

When `kysely` is upgraded:

1. Vendor the matching upstream docs snapshot under `docs/vendor/kysely/<version>/`.
2. Update this runbook to point at the new version.
3. Update the `kysely-workflows` skill to reference the new runbook/version.
