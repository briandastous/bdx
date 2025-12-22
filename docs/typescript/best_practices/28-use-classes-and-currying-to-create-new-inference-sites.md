# 28. Use Classes and Currying to Create New Inference Sites

## Guidance

- If generic inference is awkward, restructure APIs to create clearer inference sites (often by splitting arguments).
- Currying can let you “lock in” one part of a generic relationship and infer the rest later.
- Classes (or factory functions) can capture a generic parameter once and reuse it across methods.

## Examples

```ts
// Curried helper: choose a key once, then infer object type at the call site.
const prop =
  <K extends PropertyKey>(key: K) =>
  <T extends Record<K, unknown>>(obj: T): T[K] =>
    obj[key];

const getId = prop("id");
const id = getId({ id: "u1", name: "Ada" }); // id: string

// Class-based variant: capture K once, reuse it with many Ts.
class KeyGetter<K extends PropertyKey> {
  constructor(private key: K) {}
  get<T extends Record<K, unknown>>(obj: T): T[K] {
    return obj[this.key];
  }
}

const getter = new KeyGetter("name");
const name = getter.get({ id: "u1", name: "Ada" }); // name: string
```
