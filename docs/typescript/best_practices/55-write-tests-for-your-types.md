# 55. Write Tests for Your Types

## Guidance

- Treat complex types like code: they can regress, get slower, or stop matching reality.
- Add compile-time assertions for key relationships (assignability, inferred return types, discriminant behavior).
- Consider dedicated tooling (`tsd`, `expect-type`) in larger codebases, but simple “type-level tests” also work.

## Examples

```ts
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

type _ = Assert<Equal<ApiResult<number>["ok"], true | false>>;
```

