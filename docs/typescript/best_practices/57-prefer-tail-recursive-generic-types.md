# 57. Prefer Tail-Recursive Generic Types

## Guidance

- Deeply recursive conditional types can hit instantiation depth limits and slow the compiler.
- Prefer tail-recursive forms with an accumulator when writing recursive type-level algorithms.
- If the type-level solution becomes too complex, consider runtime helpers or codegen.

## Examples

```ts
// Reverse a tuple using a tail-recursive accumulator.
type Reverse<T extends readonly unknown[], Acc extends readonly unknown[] = []> =
  T extends readonly [infer Head, ...infer Tail]
    ? Reverse<Tail, readonly [Head, ...Acc]>
    : Acc;

type R = Reverse<[1, 2, 3]>; // [3, 2, 1]
```

