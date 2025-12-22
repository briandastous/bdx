# 20. Understand How a Variable Gets Its Type

## Guidance

- `const` preserves literal types more often than `let` (e.g., `"ok"` vs `string`).
- Use `as const` to preserve deep literal structure (readonly tuples, literal object property values).
- When you want checking without widening, prefer `satisfies` to a broad annotation.

## Examples

```ts
let status1 = "ok"; // string (widened)
const status2 = "ok"; // "ok" (literal)

const roles = ["admin", "user"] as const; // readonly ["admin", "user"]
type Role = (typeof roles)[number]; // "admin" | "user"

const config = { retries: 3, mode: "safe" } satisfies { retries: number; mode: "safe" | "fast" };
```

