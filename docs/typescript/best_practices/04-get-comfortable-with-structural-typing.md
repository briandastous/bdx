# 04. Get Comfortable with Structural Typing

## Guidance

- In TypeScript, compatibility is based on *shape*, not explicit declarations (“if it quacks like a duck…”).
- Design APIs around the minimal required shape (e.g., `{ id: string }`), not concrete classes, to improve flexibility.
- Use nominal techniques (brands, private fields) only when you truly need non-interchangeable types with the same shape.

## Examples

```ts
type Point2D = { x: number; y: number };

function length(p: Point2D) {
  return Math.hypot(p.x, p.y);
}

const p3d = { x: 3, y: 4, z: 5 };
length(p3d); // OK: p3d has at least the required shape

// Nominal-ish pattern when you need stronger separation:
type UserId = string & { readonly __brand: "UserId" };
declare function asUserId(id: string): UserId;
```

