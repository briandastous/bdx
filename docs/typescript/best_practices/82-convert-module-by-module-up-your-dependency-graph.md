# 82. Convert Module by Module Up Your Dependency Graph

## Guidance

- Start with leaf modules (fewest dependents) to minimize churn and keep the build green.
- Convert “pure” utility modules early; convert complex integration modules later.
- Prefer small, frequent conversions over a big-bang rewrite; keep interfaces stable between TS and JS modules.

## Examples

```ts
// Example: convert a leaf utility first.
export function isDefined<T>(v: T | null | undefined): v is T {
  return v != null;
}

// Then dependents can take advantage of narrowing immediately.
const values = [1, null, 2].filter(isDefined); // number[]
```

