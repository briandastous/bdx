# 12. Apply Types to Entire Function Expressions When Possible

## Guidance

- Prefer typing the whole function expression (`const fn: FnType = (...) => ...`) over annotating each parameter.
- Reuse function types for consistency across implementations (handlers, callbacks, reducers).
- Derive function types from existing values with `typeof` to keep signatures in sync.

## Examples

```ts
type Comparator<T> = (a: T, b: T) => number;

const byLength: Comparator<string> = (a, b) => a.length - b.length;

function sortBy<T>(items: readonly T[], cmp: Comparator<T>) {
  return [...items].sort(cmp);
}

sortBy(["bbb", "a", "cc"], byLength);
```

