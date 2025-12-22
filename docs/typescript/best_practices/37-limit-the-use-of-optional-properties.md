# 37. Limit the Use of Optional Properties

## Guidance

- Use optional properties when “the property may be absent” is truly part of the model.
- Prefer discriminated unions when optionality encodes a state (e.g., `success` vs `error`), not just “maybe present”.
- Be explicit about the difference between “missing” and “present with `undefined`” (especially with `exactOptionalPropertyTypes`).

## Examples

```ts
// Instead of an interface full of optionals…
// type Response = { data?: string; error?: string };

type Response = { ok: true; data: string } | { ok: false; error: string };

function unwrap(r: Response) {
  return r.ok ? r.data : `ERR: ${r.error}`;
}
```

