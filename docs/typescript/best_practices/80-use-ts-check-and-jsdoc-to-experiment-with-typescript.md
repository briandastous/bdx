# 80. Use `@ts-check` and JSDoc to Experiment with TypeScript

## Guidance

- Use `@ts-check` in JavaScript files to get type checking without a full TS migration.
- Add JSDoc annotations incrementally to tighten types around key modules.
- When code stabilizes, consider converting the file to `.ts` to unlock stronger tooling and refactors.

## Examples

```ts
// The “end state” once you convert to TypeScript is usually simpler than heavy JSDoc:
export type User = { id: string; email: string };

export function isUser(v: unknown): v is User {
  return typeof v === "object" && v !== null && typeof (v as any).id === "string" && typeof (v as any).email === "string";
}
```

