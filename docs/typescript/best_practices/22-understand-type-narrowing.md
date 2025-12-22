# 22. Understand Type Narrowing

## Guidance

- Model uncertainty with unions (`A | B`) and then narrow with runtime checks (`typeof`, `instanceof`, `"key" in obj`, discriminants).
- Prefer discriminated unions for state machines and APIs (a `kind`/`type` field makes narrowing ergonomic).
- Use user-defined type guards (`value is T`) when narrowing logic is reused.

## Examples

```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; size: number };

function area(s: Shape) {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "square":
      return s.size ** 2;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
```

