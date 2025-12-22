---
name: kysely-workflows
description: Use Kysely correctly in this repo (bdx) for Postgres queries, schema building, and migrations. Use when writing repositories/query utilities, authoring migrations, designing transactions, handling bigint/JSON boundaries, or using Kysely plugins/recipes.
---

# Kysely Workflows (bdx)

## Start here (progressive disclosure)

1. Read the repo runbook (bdx conventions + vendored docs index):
   - `docs/runbooks/kysely.md`
2. For authoritative upstream semantics/examples, read the vendored snapshot for the pinned version:
   - `docs/vendor/kysely/0.28.9/README.md`
   - `docs/vendor/kysely/0.28.9/docs/`

## Default rules (apply unless explicitly justified)

- Keep SQL usage in `packages/db` (apps/services should call repositories/helpers).
- Prefer reusable query utilities over ad hoc queries:
  - shared projections (stable select shapes),
  - shared filters (soft-delete/status semantics),
  - shared joins (common relationships expressed once).
- Prefer explicit transaction boundaries for multi-step writes:
  - use `db.transaction().execute(async (trx) => { ... })` and pass `trx` down.
- Postgres `bigint` is JS `bigint` in-process, but JSON is a boundary format:
  - accept IDs as strings and normalize to `bigint`,
  - emit IDs as strings,
  - document IDs in OpenAPI as `type: string` + `format: int64`.
- Prefer Kysely builders; use `sql` only for Postgres-specific features or tight performance needs.
- When introducing a new Kysely pattern (upserts, pagination, JSONB, etc.):
  - update `docs/runbooks/kysely.md`,
  - prefer encoding the pattern as a helper in `packages/db`.

## Find relevant upstream docs quickly

- Search by keyword:
  - `rg -n "<keyword>" docs/vendor/kysely/0.28.9/docs`
- Entry points:
  - Migrations: `docs/vendor/kysely/0.28.9/docs/migrations.mdx`
  - Execution/transactions: `docs/vendor/kysely/0.28.9/docs/execution.mdx`
  - Recipes: `docs/vendor/kysely/0.28.9/docs/recipes/`
  - Examples: `docs/vendor/kysely/0.28.9/docs/examples/`

## Common workflows

### Author a migration

- Follow the repo policy in `docs/runbooks/kysely.md` and `plans/NODE_POSTGRES_REWRITE_PLAN.md`.
- Keep migrations “frozen in time”:
  - no imports from app code,
  - avoid depending on the evolving `Database` type,
  - prefer the schema builder and small `sql` fragments when required.

### Implement a repository/query helper

- Accept `Db` or `Transaction<Database>` as an argument to support composition.
- Keep API-layer validation/normalization at the boundary; assume typed domain inputs inside repositories.
- If adding cursor pagination, use the repo’s chosen approach and keep cursor tokens opaque.
