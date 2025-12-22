# 43. Use the Narrowest Possible Scope for `any` Types

## Guidance

- Keep `any` localized: don’t let it “infect” return types or exported APIs.
- Prefer `as any` on the smallest expression that truly needs it (often a single property), not entire objects.
- Never return `any` from helper functions—callers will silently lose type safety.

## Examples

```ts
type Salad = { kind: "salad" };
type Pizza = { slice(): void };

declare function getPizza(): Pizza;
declare function eatSalad(s: Salad): void;

function eatDinner() {
  const pizza = getPizza();

  // Localize the escape hatch:
  eatSalad(pizza as any);

  // Keep the rest of the function type-safe.
  pizza.slice();
}
```

