# 56. Pay Attention to How Types Display

## Guidance

- Optimize types for humans, not just the compiler: readable hover/IDE output improves correctness and velocity.
- Use helper types to “prettify” intersections and mapped types when they become unreadable.
- Prefer naming intermediate types over inlining huge conditional/mapped expressions everywhere.

## Examples

```ts
type Prettify<T> = { [K in keyof T]: T[K] } & {};

type A = { a: string } & { b: number };
type PrettyA = Prettify<A>; // shows as { a: string; b: number }

type WithId<T> = Prettify<T & { id: string }>;
```

