# 25. Understand Evolving Types

## Guidance

- Be careful with empty initializers (`[]`, `{}`): they can produce overly-broad types (often `any[]` or `{}`) that “evolve” in surprising ways.
- Prefer giving collections an explicit element type up front, especially when starting empty.
- When a value legitimately changes “shape” over time, model that with an explicit union and narrow deliberately.

## Examples

```ts
// Good: the array’s element type is fixed from the start.
const ids: string[] = [];
ids.push("u1");
// ids.push(123); // error

// Explicitly model evolution when it’s real:
let result: { ok: true; value: number } | { ok: false; error: string } = {
  ok: false,
  error: "not started",
};
result = { ok: true, value: 42 };
```

