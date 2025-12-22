# 60. Know How to Iterate Over Objects

## Guidance

- `Object.keys`/`Object.entries` erase key types (`string[]`), so add typed helpers when you need `keyof T`.
- Prefer iterating via known key unions (`keyof T`) when possible; it prevents typos and keeps indexing safe.
- Be explicit about enumeration semantics (own vs inherited props, string vs symbol keys).

## Examples

```ts
function typedEntries<T extends object>(obj: T): Array<[keyof T, T[keyof T]]> {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}

const flags = { beta: true, darkMode: false };
for (const [key, value] of typedEntries(flags)) {
  // key: "beta" | "darkMode"
  // value: boolean
  console.log(key, value);
}
```

