# 72. Prefer ECMAScript Features to TypeScript Features

## Guidance

- Prefer JavaScript/ECMAScript features that exist at runtime over TypeScript-only constructs.
- Avoid TS features that add runtime artifacts or non-standard patterns (e.g., `enum`, `namespace`) unless you need them.
- Use modern JS alternatives:
  - string unions + `as const` objects instead of enums,
  - `#private` fields instead of `private` when you need true runtime privacy.

## Examples

```ts
// Prefer a union + const object to an enum when runtime values are simple.
const HttpMethod = {
  GET: "GET",
  POST: "POST",
} as const;
type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

class Counter {
  #count = 0; // runtime-private (ECMAScript)
  inc() {
    this.#count++;
  }
}
```

