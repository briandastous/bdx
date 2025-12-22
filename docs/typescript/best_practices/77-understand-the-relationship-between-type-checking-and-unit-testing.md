# 77. Understand the Relationship Between Type Checking and Unit Testing

## Guidance

- Types prevent many classes of misuse (wrong shapes, impossible states), but they don’t prove runtime correctness.
- Unit tests cover behavior, side effects, boundary cases, and integration assumptions types can’t express.
- Use both: types for *static guarantees*, tests for *runtime truth*.

## Examples

```ts
// Type-correct but potentially buggy logic:
export function clamp(n: number, min: number, max: number) {
  // bug: swapped min/max would still type-check
  return Math.max(min, Math.min(n, max));
}

// A unit test would catch behavior regressions and edge cases.
```

