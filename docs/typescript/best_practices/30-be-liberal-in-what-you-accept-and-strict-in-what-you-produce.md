# 30. Be Liberal in What You Accept and Strict in What You Produce

## Guidance

- Accept broader inputs to make APIs easy to use (e.g., `readonly` arrays, `Iterable<T>`, unions for common variants).
- Normalize early and return a strict, predictable output type.
- Document/encode the normalization boundary so the rest of the codebase can rely on strong types.

## Examples

```ts
function toNumber(input: string | number): number {
  return typeof input === "number" ? input : Number(input);
}

function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

const ids = unique(["a", "b", "a"]); // string[]
```

