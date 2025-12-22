# 79. Write Modern JavaScript

## Guidance

- Prefer modern JS syntax/features (const/let, destructuring, optional chaining, nullish coalescing, `async/await`).
- Use ES modules where possible; they compose better with TS tooling and bundlers.
- Write idiomatic JS first; let TypeScript add safety rather than forcing unnatural patterns.

## Examples

```ts
type User = { id: string; profile?: { displayName?: string } };

function label(user: User) {
  const name = user.profile?.displayName ?? user.id;
  return `@${name}`;
}
```

