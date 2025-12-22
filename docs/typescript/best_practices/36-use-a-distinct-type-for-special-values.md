# 36. Use a Distinct Type for Special Values

## Guidance

- Avoid “magic” sentinel values like `-1`, `""`, or `"UNKNOWN"` hidden inside otherwise-normal types.
- Model special cases explicitly with unions (`Found | NotFound`) or branded types for stronger separation.
- Normalize external sentinel values at the boundary so internal code stays honest.

## Examples

```ts
type FindResult =
  | { kind: "found"; index: number }
  | { kind: "not-found" };

function findUserId(ids: readonly string[], id: string): FindResult {
  const index = ids.indexOf(id);
  return index === -1 ? { kind: "not-found" } : { kind: "found", index };
}
```

