# R01. Refactor-Friendly TypeScript Checklist

This repo adds a small set of rules that make refactors safer by making identity, ownership, and
closed sets explicit. These rules complement the Effective TypeScript items and apply to new and
touched code.

## Checklist

- **Brand all DB identifiers.**
  - Use `@bdx/ids` to brand IDs (bigint and string identifiers).
  - Apply brands at boundaries (repo mappers, API/CLI/config parsing), not inside every query.
- **Boundary parsing only.**
  - Boundary modules parse DTOs into domain types; core logic never accepts boundary-shaped data.
  - Boundary list: `apps/api/src/**`, `packages/cli/src/commands/**`, `packages/config/src/**`,
    `packages/db/src/repositories/**`, `packages/twitterapi-io/src/**`.
- **Closed unions + exhaustiveness.**
  - Prefer discriminated unions and use `assertNever` for exhaustive `switch` statements.
- **Readonly at boundaries.**
  - Inputs/outputs across module boundaries should be `readonly` to avoid aliasing bugs.
- **Explicit return types for exports.**
  - All exported functions/classes should declare return types explicitly.
- **Null/undefined are a single absence concept (for APIs we control).**
  - Use `x == null` for absence and `x != null` for presence.
  - Avoid truthiness checks for nullable values (`if (x)`).
  - External API surfaces may require exact `=== null`/`=== undefined` checks; use those only at the
    boundary where the external contract requires it.
  - `==` and `!=` are only valid when used as `== null` and `!= null`. In all other scenarios, use `===` and `!==`.
- **Avoid `any`.**
  - Use `unknown` and narrow at boundaries.

## Examples

### Branded IDs at a repository boundary

```ts
import { IngestEventId, UserId, type IngestEventId } from "@bdx/ids";
import type { Db } from "@bdx/db";

type UserRow = {
  id: bigint;
  handle: string | null;
  last_ingest_event_id: bigint | null;
};

type User = {
  readonly id: UserId;
  readonly handle: string | null;
  readonly lastIngestEventId: IngestEventId | null;
};

function toUser(row: UserRow): User {
  return {
    id: UserId(row.id),
    handle: row.handle,
    lastIngestEventId: row.last_ingest_event_id ? IngestEventId(row.last_ingest_event_id) : null,
  };
}

export async function getUser(db: Db, id: UserId): Promise<User | null> {
  const row = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? toUser(row) : null;
}
```

### Boundary parsing (DTO -> domain)

```ts
import { z } from "zod";
import { UserId, parseUserId } from "@bdx/ids";

const ParamsSchema = z.object({ id: z.string() });
type UserParams = { readonly id: UserId };

function parseUserParams(input: unknown): UserParams {
  const parsed = ParamsSchema.parse(input);
  return { id: parseUserId(parsed.id) };
}
```

### Exhaustiveness

```ts
type Status = { kind: "ready" } | { kind: "error"; reason: string };

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

export function describeStatus(status: Status): string {
  switch (status.kind) {
    case "ready":
      return "ready";
    case "error":
      return status.reason;
    default:
      return assertNever(status);
  }
}
```
