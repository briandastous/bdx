# 46. Use `unknown` Instead of `any` for Values with an Unknown Type

## Guidance

- Use `unknown` when you have a value but don’t know its type; it forces narrowing and prevents accidental misuse.
- Narrow with runtime checks or user-defined type guards before accessing properties or calling values.
- Know the distinctions:
  - `unknown` (safe top type),
  - `object` (non-primitive objects),
  - `{}` (non-nullish values, including primitives).

## Examples

```ts
function safeParseJson(json: string): unknown {
  return JSON.parse(json);
}

const value = safeParseJson('{"name":"Ada"}');

if (typeof value === "object" && value !== null && "name" in value) {
  const name = (value as any).name;
  if (typeof name === "string") {
    console.log(name.toUpperCase());
  }
}
```

