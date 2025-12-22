# 83. Don't Consider Migration Complete Until You Enable `noImplicitAny`

## Guidance

- `noImplicitAny` is a key milestone: it prevents silent “unknown-any” creep and forces you to name types.
- Treat remaining implicit any errors as migration tasks; don’t paper over them with blanket `any`.
- Prefer `unknown` + narrowing for uncertain values, and add types at module boundaries to stop propagation.

## Examples

```ts
// With `noImplicitAny: true`, this is an error (parameter implicitly has 'any'):
// function greet(who) { return `Hello ${who}`; }

function greet(who: string) {
  return `Hello ${who}`;
}
```

