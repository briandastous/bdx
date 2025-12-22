# 44. Prefer More Precise Variants of `any` to Plain `any`

## Guidance

- If you must use `any`, make it as specific as possible so misuse is still caught:
  - `any[]` vs `any`,
  - `Record<string, any>` vs `any`,
  - `(...args: any[]) => unknown` vs `Function`.
- Prefer `unknown` when you can; use `any` only when you truly need unchecked operations.

## Examples

```ts
function getLengthBad(value: any) {
  return value.length; // accepts RegExp/null/etc. without complaint
}

function getLength(value: any[]) {
  return value.length; // at least requires an array-like value
}

getLength([1, 2, 3]);
// getLength(/re/); // error
```

