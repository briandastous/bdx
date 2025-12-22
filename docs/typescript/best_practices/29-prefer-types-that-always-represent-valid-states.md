# 29. Prefer Types That Always Represent Valid States

## Guidance

- Encode invariants in types so invalid states are unrepresentable (or at least hard to construct).
- Prefer discriminated unions for state machines over “bag of optionals” interfaces.
- Keep related fields together in the same union member (e.g., `data` exists only when `status: "success"`).

## Examples

```ts
type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; data: T };

function render(state: LoadState<{ name: string }>) {
  if (state.status === "success") {
    return state.data.name; // safe: data only exists in this state
  }
  return state.status;
}
```

