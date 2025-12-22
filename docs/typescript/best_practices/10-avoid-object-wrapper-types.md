# 10. Avoid Object Wrapper Types (String, Number, Boolean, Symbol, BigInt)

## Guidance

- Use primitive types (`string`, `number`, `boolean`, `symbol`, `bigint`) in annotations.
- Avoid wrapper object types (`String`, `Number`, `Boolean`, `Symbol`, `BigInt`) and constructions like `new String("x")`.
- Prefer primitive values for predictable runtime behavior and better compatibility with standard library APIs.

## Examples

```ts
function takesString(s: string) {
  return s.toUpperCase();
}

const primitive = "hello";
takesString(primitive);

const boxed = new String("hello");
// takesString(boxed); // error: 'String' is not assignable to 'string'
```

