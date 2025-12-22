# 76. Create an Accurate Model of Your Environment

## Guidance

- Ensure TypeScript knows which runtime you’re targeting (browser vs Node vs workers) via `lib`, `types`, and ambient declarations.
- Prefer installing the right type packages (e.g., `@types/node`) over ad-hoc `declare var` patches.
- If your environment provides custom globals, model them in a single, well-scoped `.d.ts`.

## Examples

```ts
// If your runtime injects globals, model them explicitly:
declare global {
  const APP_VERSION: string;
}

export function versionBanner() {
  return `v${APP_VERSION}`;
}
```

