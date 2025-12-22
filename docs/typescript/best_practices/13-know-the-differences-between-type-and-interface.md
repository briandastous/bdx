# 13. Know the Differences Between `type` and `interface`

## Guidance

- Use `interface` for object shapes you expect to extend, implement, or merge (especially in public/library APIs).
- Use `type` when you need unions, intersections, primitives, mapped/conditional types, or other type-level composition.
- Be consistent within a codebase: pick a default for “plain object shapes” and deviate only when needed.

## Examples

```ts
interface ApiError {
  message: string;
  status: number;
}

// `type` shines for unions and composition.
type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
```

