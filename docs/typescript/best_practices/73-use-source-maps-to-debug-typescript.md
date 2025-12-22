# 73. Use Source Maps to Debug TypeScript

## Guidance

- Enable source maps in builds where you debug (`"sourceMap": true`) so stack traces point to `.ts` lines.
- Ensure your runtime (Node/bundler) is configured to load source maps (varies by toolchain).
- Treat source maps as part of the developer experience; verify them during CI smoke runs.

## Examples

```ts
export function explode() {
  // With source maps enabled, runtime stack traces can point here (TypeScript),
  // not the transpiled JavaScript output.
  throw new Error("boom");
}
```

