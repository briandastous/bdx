# 81. Use `allowJs` to Mix TypeScript and JavaScript

## Guidance

- Use `allowJs` (and optionally `checkJs`) to incrementally adopt TypeScript without converting everything at once.
- Add types at boundaries first: declarations for JS modules, JSDoc annotations, and TS wrappers.
- Keep TS and JS builds aligned so imports resolve consistently across the mixed codebase.

## Examples

```ts
// A TypeScript “boundary” wrapper around an untyped JS module:
// (In real code, this would import from a .js file allowed by `allowJs`.)
declare function legacyCompute(input: string): unknown;

export function compute(input: string): number {
  const v = legacyCompute(input);
  if (typeof v !== "number") throw new Error("legacyCompute returned non-number");
  return v;
}
```

