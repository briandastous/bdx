# 61. Use `Record` Types to Keep Values in Sync

## Guidance

- Use `Record<K, V>` when you have a fixed set of keys and want the compiler to enforce completeness.
- Prefer `Record<Union, ...>` over `{ [k: string]: ... }` to catch typos and missing entries.
- Use `satisfies` when you want conformance checks without widening away literal types.

## Examples

```ts
type Status = "idle" | "loading" | "error";

const statusLabel = {
  idle: "Ready",
  loading: "Loading…",
  error: "Something went wrong",
} satisfies Record<Status, string>;

function label(status: Status) {
  return statusLabel[status];
}
```

