# 52. Prefer Conditional Types to Overload Signatures

## Guidance

- Prefer conditional types when the relationship between input and output is systematic and type-level.
- Use overloads when runtime behavior differs in ways that can’t be expressed cleanly with a conditional.
- Keep signatures in sync with implementation; avoid overload lists that drift from reality.

## Examples

```ts
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

async function maybeAwait<T>(value: T): Promise<UnwrapPromise<T>> {
  return (await value) as UnwrapPromise<T>;
}

const a = maybeAwait(Promise.resolve(123)); // Promise<number>
const b = maybeAwait("x"); // Promise<string>
```

