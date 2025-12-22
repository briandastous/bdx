# 02. Know Which TypeScript Options You're Using

## Guidance

- Treat `tsconfig.json` as part of your API: review it, version it, and keep it consistent across packages.
- Prefer `strict: true` for new code; if migrating, ratchet toward strictness over time rather than living in an ambiguous middle.
- Understand which checks are enabled (e.g., `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`) and how they change everyday code.
- Align “what your editor says” with “what CI/build runs” by ensuring they point at the same `tsconfig`.

## Examples

```ts
// With `strictNullChecks: true`, model optional/nullable values explicitly.
function displayName(input?: string) {
  // return input.toUpperCase(); // error: input may be undefined
  return input?.toUpperCase() ?? "ANONYMOUS";
}

// With `noUncheckedIndexedAccess: true`, indexed access is safer by default.
const names = ["Ada", "Grace"];
const maybeThird = names[2]; // string | undefined
const upper = (maybeThird ?? "unknown").toUpperCase();
```

