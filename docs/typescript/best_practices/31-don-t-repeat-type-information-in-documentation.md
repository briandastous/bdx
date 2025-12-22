# 31. Don’t Repeat Type Information in Documentation

## Guidance

- Let types carry type information; use comments to capture *behavioral* details types can’t express (units, invariants, edge cases).
- Avoid JSDoc that restates the signature (it drifts out of date and adds noise).
- Prefer documenting “why” and “what it guarantees” over “what it accepts” when types already say that.

## Examples

```ts
/**
 * Convert a `Date` to milliseconds since epoch.
 * - Throws if the date is invalid (`NaN`).
 * - Always returns an integer.
 */
export function toEpochMs(date: Date): number {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new Error("Invalid date");
  return Math.trunc(ms);
}
```

