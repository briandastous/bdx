# 32. Avoid Including `null` or `undefined` in Type Aliases

## Guidance

- Prefer one “absence” representation internally (usually `undefined` via optional properties).
- Avoid `T | undefined` when an optional property communicates intent better (`prop?: T`).
- Avoid mixing `null` and `undefined` unless you’re matching an external API; normalize at the boundary.

## Examples

```ts
// Prefer optional over a union with undefined for object properties.
type User = {
  id: string;
  displayName?: string;
};

function label(user: User) {
  return user.displayName ?? user.id;
}
```

