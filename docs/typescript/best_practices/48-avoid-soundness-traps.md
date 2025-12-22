# 48. Avoid Soundness Traps

## Guidance

- Watch for places where runtime values can diverge from static types: `any`, assertions, unchecked indexing, inaccurate third-party types.
- Prefer narrowing/validation over assertions (`as`) when handling uncertain values.
- Avoid mutating inputs you’re narrowing; use `readonly` parameters to reduce accidental unsoundness.

## Examples

```ts
const xs = [0, 1, 2];
const maybe = xs[3]; // number (by default), but runtime is undefined

// Prefer defensive code (or enable `noUncheckedIndexedAccess`):
if (maybe !== undefined) {
  console.log(maybe.toFixed(1));
}
```

