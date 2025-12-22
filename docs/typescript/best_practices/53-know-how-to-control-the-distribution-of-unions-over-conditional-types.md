# 53. Know How to Control the Distribution of Unions over Conditional Types

## Guidance

- Conditional types distribute over unions when the checked type is a “naked” type parameter (`T extends ... ? ... : ...`).
- Wrap the type parameter in a tuple to prevent distribution (`[T] extends [...] ? ... : ...`).
- Use distribution intentionally for utilities like `Exclude`/`Extract`, and disable it when you want to treat a union as a whole.

## Examples

```ts
type ToArray<T> = T extends unknown ? T[] : never; // distributive
type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never; // non-distributive

type A = ToArray<string | number>; // string[] | number[]
type B = ToArrayNonDist<string | number>; // (string | number)[]
```

