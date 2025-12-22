# 59. Use `never` Types to Perform Exhaustiveness Checking

## Guidance

- Use `never` to ensure `switch`/`if` chains over unions are exhaustive.
- Centralize the pattern in an `assertNever` helper so missing cases fail at compile time (and loudly at runtime).
- Prefer discriminated unions so exhaustiveness is reliable and clear.

## Examples

```ts
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function area(s: Shape) {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.r ** 2;
    case "square":
      return s.s ** 2;
    default:
      return assertNever(s);
  }
}
```

