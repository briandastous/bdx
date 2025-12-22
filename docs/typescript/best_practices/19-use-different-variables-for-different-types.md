# 19. Use Different Variables for Different Types

## Guidance

- Avoid reusing a variable for multiple unrelated types; it forces unions and makes later code harder to reason about.
- Prefer introducing a new variable at each “type transition” (string → number, nullable → non-null, unknown → validated).
- If a value can legitimately be multiple shapes, model it as a union and narrow deliberately.

## Examples

```ts
// Harder to use: type becomes string | number.
let id = "42";
// id = 42;

// Clearer: each variable has a single, stable type.
const idText = "42";
const idNumber = Number(idText);
```

