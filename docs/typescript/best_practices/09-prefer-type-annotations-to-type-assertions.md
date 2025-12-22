# 09. Prefer Type Annotations to Type Assertions

## Guidance

- Prefer `: T` (or `satisfies T`) so TypeScript can *verify* your claim; avoid `as T` which can silently lie.
- Use assertions when you have an external guarantee the compiler cannot see (e.g., validated data), and keep them narrow (`as const`, `as SomeSpecificType`).
- When you must assert, isolate it behind a well-typed function so the rest of the codebase stays safe.

## Examples

```ts
type Point = { x: number; y: number };

// Checked: errors if the object doesn’t match.
const p1: Point = { x: 1, y: 2 };

// const p2: Point = { x: 1, y: 2, z: 3 }; // error: extra property 'z'

// Unchecked claim: compiles, but your program may now be wrong.
const p3 = { x: 1, y: 2, z: 3 } as unknown as Point;

// Prefer `satisfies` when you want checking without changing the expression type:
const p4 = { x: 1, y: 2 } satisfies Point;
```

