# 03. Understand That Code Generation Is Independent of Types

## Guidance

- Assume all types are erased: interfaces, type aliases, and annotations do not create runtime checks.
- Don’t “trust” types coming from the outside world (API responses, `JSON.parse`, env vars); verify them.
- When you need runtime reflection, build it explicitly (schemas, codecs, type guards), not implicitly via types.

## Examples

```ts
type User = { id: string; isAdmin: boolean };

// This function is purely a compile-time aid — it does no validation at runtime.
function greetUser(user: User) {
  return `Hello ${user.id}`;
}

// Treat untyped data as `unknown` until you prove otherwise.
const raw: unknown = JSON.parse('{"id":"u1","isAdmin":"nope"}');

function isUser(v: unknown): v is User {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as any).id === "string" &&
    typeof (v as any).isAdmin === "boolean"
  );
}

if (isUser(raw)) {
  greetUser(raw);
}
```

