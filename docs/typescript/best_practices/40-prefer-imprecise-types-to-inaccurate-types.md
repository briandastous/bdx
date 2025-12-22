# 40. Prefer Imprecise Types to Inaccurate Types

## Guidance

- Avoid “uncanny valley” typings: a complex type that’s *wrong* is often worse than a simpler, more honest type.
- If you can’t model something accurately, acknowledge the gap (often with `unknown`) and validate/narrow where needed.
- As types become more complex, invest in tests and examples to keep them correct and usable.

## Examples

```ts
// If you don’t know the shape, admit it up front:
function parseUnknown(json: string): unknown {
  return JSON.parse(json);
}

const expr = parseUnknown('["rgb", 255, 128, 64]');

// Narrow precisely where it matters.
function isRgbCall(v: unknown): v is ["rgb", number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v[0] === "rgb" &&
    v.slice(1).every((x) => typeof x === "number")
  );
}
```

