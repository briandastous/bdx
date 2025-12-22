# 01. Understand the Relationship Between TypeScript and JavaScript

## Guidance

- Treat TypeScript as JavaScript plus a static analysis step; the emitted program is still JavaScript.
- Use types to encode intent and catch mistakes early (wrong argument counts, misspelled properties, invalid refactors).
- Remember type safety is not the same as runtime safety: code can type-check and still throw when inputs are unexpected.
- Add runtime validation/narrowing at system boundaries (JSON, HTTP, env vars) so your “typed” assumptions stay true.

## Examples

```ts
function greet(who: string) {
  console.log(`Hello, ${who.toUpperCase()}!`);
}

greet("world");
// greet(42); // Type error: number is not assignable to string

// Types don’t exist at runtime, so validate unknown inputs explicitly.
const payload: unknown = JSON.parse('{"who":42}');

function hasStringWho(v: unknown): v is { who: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "who" in v &&
    typeof (v as any).who === "string"
  );
}

if (hasStringWho(payload)) {
  greet(payload.who);
}
```

