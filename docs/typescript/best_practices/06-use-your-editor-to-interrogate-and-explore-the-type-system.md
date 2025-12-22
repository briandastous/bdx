# 06. Use Your Editor to Interrogate and Explore the Type System

## Guidance

- Use hover/“go to type definition”/quick fixes as part of normal development; they often reveal surprises in inferred types.
- Create “type checkpoints” with `satisfies`, helper types, or `// @ts-expect-error` to document intent and lock in behavior.
- Prefer constructs that preserve useful inference for the editor (e.g., `as const`, `satisfies`) instead of erasing types with broad annotations.

## Examples

```ts
// `satisfies` checks conformance *without* widening away useful literal types.
const statusToCode = {
  ok: 200,
  notFound: 404,
  serverError: 500,
} satisfies Record<string, number>;

type Status = keyof typeof statusToCode; // "ok" | "notFound" | "serverError"

function toHttpStatus(s: Status) {
  return statusToCode[s];
}
```

