# 49. Track Your Type Coverage to Prevent Regressions in Type Safety

## Guidance

- `any` can sneak in through explicit annotations *and* through dependencies (`@types`, ambient module declarations).
- Track and trend “type coverage” (e.g., fail CI if `any` grows) to prevent type-safety regressions over time.
- Treat newly introduced `any` as technical debt: either justify it at the boundary or replace with `unknown` + validation.

## Examples

```ts
// `any` can leak in through an untyped boundary:
declare function legacyParse(input: string): any;

const v = legacyParse("...");
v.thisCouldBeAnything(); // no error, no safety

// Prefer wrapping the boundary once:
function safeLegacyParse(input: string): unknown {
  return legacyParse(input) as unknown;
}
```

