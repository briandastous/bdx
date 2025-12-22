# 07. Think of Types as Sets of Values

## Guidance

- Model “more possible values” with unions (`A | B`) and “must satisfy both” with intersections (`A & B`).
- Treat assignability as a subset relation: if `T` is assignable to `U`, then values of `T` are a subset of values of `U`.
- Use `never` to represent the empty set and drive exhaustiveness checks; use `unknown` to represent the widest possible set.

## Examples

```ts
type Cat = { kind: "cat"; meows: true };
type Dog = { kind: "dog"; barks: true };

type Pet = Cat | Dog; // set of all cats and dogs
type Tracked = Pet & { id: string }; // cats/dogs that also have an id

function describe(p: Pet) {
  if (p.kind === "cat") return "meow";
  return "woof";
}
```

