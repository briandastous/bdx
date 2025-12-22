# 14. Use `readonly` to Avoid Errors Associated with Mutation

## Guidance

- Use `readonly` properties and `readonly T[]` parameters to prevent accidental mutation across function boundaries.
- Prefer immutable update patterns (copy + change) for shared data structures.
- Remember `readonly` is shallow: nested objects can still be mutated unless they’re also readonly.

## Examples

```ts
function total(xs: readonly number[]) {
  // xs.push(1); // error: Property 'push' does not exist on type 'readonly number[]'
  return xs.reduce((sum, x) => sum + x, 0);
}

type Settings = { readonly theme: "light" | "dark"; readonly flags: Readonly<Record<string, boolean>> };

const settings: Settings = { theme: "dark", flags: { beta: true } };
// settings.theme = "light"; // error
```

