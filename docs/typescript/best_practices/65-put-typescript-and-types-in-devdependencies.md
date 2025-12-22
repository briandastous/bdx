# 65. Put TypeScript and `@types` in `devDependencies`

## Guidance

- Treat TypeScript and type packages (`@types/*`) as build-time tooling for most libraries/apps, not runtime dependencies.
- Keep production dependencies focused on code that runs in production; keep typechecking/build in dev tooling.
- In monorepos, ensure each package’s dependency graph matches how it’s built and published.

## Examples

```ts
// Runtime code should not depend on TypeScript itself.
// This file compiles to JavaScript and runs without TypeScript installed at runtime.
export function add(a: number, b: number) {
  return a + b;
}
```

