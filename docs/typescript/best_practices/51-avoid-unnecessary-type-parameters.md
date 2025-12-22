# 51. Avoid Unnecessary Type Parameters

## Guidance

- Add a type parameter only when it connects inputs to outputs (or multiple inputs to each other).
- Avoid “return-only” generics (`function f<T>(): T`) unless the caller truly supplies `T` intentionally (often a smell).
- Prefer concrete types (`unknown`, unions) or overloads/conditionals when a generic can’t be inferred.

## Examples

```ts
// Good: T is inferred from the argument and preserved in the return type.
function wrap<T>(value: T): { value: T } {
  return { value };
}

// Suspicious: caller must provide T, but there’s no evidence it’s correct.
function parseJsonBad<T>(json: string): T {
  return JSON.parse(json) as T;
}

// Safer: return unknown and narrow/validate.
function parseJson(json: string): unknown {
  return JSON.parse(json);
}
```

