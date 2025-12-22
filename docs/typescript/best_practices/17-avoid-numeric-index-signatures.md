# 17. Avoid Numeric Index Signatures

## Guidance

- Prefer arrays/tuples for sequential numeric indices; reserve “index signatures” for maps/dictionaries.
- Avoid `interface X { [n: number]: T }` for general maps: JavaScript object keys are strings at runtime and numeric indexing can be misleading.
- For “map by number”, prefer `Map<number, T>` (or normalize keys to strings explicitly).

## Examples

```ts
// Prefer arrays/tuples for positional data.
type Rgb = readonly [red: number, green: number, blue: number];
const teal: Rgb = [0, 128, 128];

// Prefer Map for truly numeric keys.
const byId = new Map<number, string>();
byId.set(1, "Ada");
byId.set(2, "Grace");
```

