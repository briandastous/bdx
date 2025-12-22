# 66. Understand the Three Versions Involved in Type Declarations

## Guidance

- Type declarations involve:
  - the library version,
  - the type definitions version (`@types/*` or bundled `.d.ts`),
  - the TypeScript compiler version.
- Newer TS features in typings (e.g., `satisfies`) require consumers to use a compatible TS version.
- Keep these versions aligned in CI and release processes to avoid breaking downstream users.

## Examples

```ts
// Example of a typing that requires TS 4.9+ (`satisfies`):
const headers = {
  accept: "application/json",
  "content-type": "application/json",
} satisfies Record<string, string>;
```

