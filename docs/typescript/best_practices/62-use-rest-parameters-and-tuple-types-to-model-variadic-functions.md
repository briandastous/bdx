# 62. Use Rest Parameters and Tuple Types to Model Variadic Functions

## Guidance

- Use variadic tuple types to preserve the relationship between a callable and its arguments.
- Prefer `Args extends unknown[]` + `...args: Args` patterns over `...args: any[]`.
- Use these techniques to build helpers like `call`, `curry`, `pipe`, and typed wrappers around existing functions.

## Examples

```ts
function call<Args extends unknown[], R>(fn: (...args: Args) => R, ...args: Args): R {
  return fn(...args);
}

call(Math.max, 1, 2, 3);
// call(Math.max, "1"); // error

call((a: string, b: number) => `${a}:${b}`, "x", 42);
```

