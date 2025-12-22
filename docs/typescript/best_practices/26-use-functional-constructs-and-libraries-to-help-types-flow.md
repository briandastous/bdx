# 26. Use Functional Constructs and Libraries to Help Types Flow

## Guidance

- Prefer `map`/`filter`/`flatMap`/`reduce` over manual loops when it improves readability and type inference.
- Use type-guard predicates in filters to refine array element types.
- Keep transformations small and composable; it’s easier for TypeScript to infer types across smaller pure functions.

## Examples

```ts
const raw: Array<string | null | undefined> = ["a", null, "b", undefined];

function isString(v: unknown): v is string {
  return typeof v === "string";
}

const upper = raw
  .filter(isString) // string[]
  .map((s) => s.toUpperCase());
```

