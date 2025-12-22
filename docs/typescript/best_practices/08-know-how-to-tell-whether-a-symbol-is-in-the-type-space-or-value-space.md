# 08. Know How to Tell Whether a Symbol Is in the Type Space or Value Space

## Guidance

- Distinguish runtime values (usable in expressions) from compile-time-only types (erased at runtime).
- Use `typeof` to *derive* a type from a value (`type T = typeof value`), and `import type` to avoid runtime imports.
- Remember some constructs introduce both a value and a type (e.g., `class`); others exist only in type space (e.g., `interface`).

## Examples

```ts
const DEFAULTS = { timeoutMs: 1_000, retries: 3 } as const;
type Defaults = typeof DEFAULTS; // { readonly timeoutMs: 1000; readonly retries: 3 }

interface User {
  id: string;
}

// console.log(User); // Error: 'User' only refers to a type, but is being used as a value.

class Widget {
  static version = "1.0";
  constructor(public id: string) {}
}
type WidgetId = Widget["id"]; // type space, derived from a value-space class
```

