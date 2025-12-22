# 16. Prefer More Precise Alternatives to Index Signatures

## Guidance

- Avoid broad index signatures like `{ [k: string]: any }`; they erase information and hide typos.
- Prefer:
  - `Record<K, V>` when keys are known (or can be modeled as a union).
  - `Partial<Record<K, V>>` when keys are optional.
  - `Map<K, V>` when keys are truly dynamic and not limited to strings.
- If you must accept arbitrary keys, keep the value type as narrow as possible (`unknown` is safer than `any`).

## Examples

```ts
type Header = "accept" | "content-type" | "user-agent";
type Headers = Partial<Record<Header, string>>;

const headers: Headers = {
  accept: "application/json",
  "content-type": "application/json",
  // "contentType": "nope", // error: not a valid Header key
};
```

