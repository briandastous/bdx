# 50. Think of Generics as Functions Between Types

## Guidance

- Treat generics like type-level functions: inputs (`T`) determine outputs (`T[]`, `Promise<T>`, `Pick<T, K>`, etc.).
- Write generics that preserve relationships between inputs and outputs; avoid “generic in name only.”
- Add constraints (`extends`) when you need structure, and keep them as loose as correctness allows.

## Examples

```ts
function first<T>(xs: readonly T[]): T | undefined {
  return xs[0];
}

function pluck<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const n = first([1, 2, 3]); // number | undefined
const id = pluck({ id: "u1", name: "Ada" }, "id"); // string
```

