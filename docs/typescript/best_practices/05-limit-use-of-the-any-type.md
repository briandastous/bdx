# 05. Limit Use of the `any` Type

## Guidance

- Avoid `any` in application code: it disables type checking, breaks inference, and hides refactor errors.
- Prefer `unknown` for untrusted values; narrow or validate before use.
- If `any` is unavoidable (legacy libs, dynamic patterns), constrain it to the smallest surface area and convert to safe types immediately.

## Examples

```ts
// Prefer wrapping `JSON.parse` to avoid leaking `any`.
function parseJson(value: string): unknown {
  return JSON.parse(value);
}

const data = parseJson('{"count": 3}');

function isCountPayload(v: unknown): v is { count: number } {
  return typeof v === "object" && v !== null && typeof (v as any).count === "number";
}

if (isCountPayload(data)) {
  console.log(data.count.toFixed(0));
}
```

