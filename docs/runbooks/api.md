# API conventions

This runbook captures the repo’s HTTP API conventions (Fastify).

## Validation + typing

- Treat all external inputs as `unknown` until validated:
  - request bodies, query params, path params, webhook payloads.
- Use Zod (or equivalent) to parse/validate inputs and produce typed domain objects.
- Avoid `any` and broad `as` assertions in application code.

## BigInt at the HTTP boundary

- Postgres `bigint` is TypeScript `bigint` in-process.
- JSON cannot represent `bigint`:
  - accept IDs as strings and normalize to `bigint`,
  - return IDs as strings,
  - document IDs in OpenAPI as `type: string` + `format: int64`.

## DB access

- Routes should call repositories/helpers in `packages/db` and avoid ad hoc SQL/query logic in `apps/api`.
- Prefer explicit transaction boundaries for multi-step writes.

## OpenAPI

OpenAPI should be generated from runtime validation schemas (Zod-first) so the spec stays accurate and is consumable by AI agents and typed clients.

The exact Zod→OpenAPI integration will be selected and documented during Phase 10.

