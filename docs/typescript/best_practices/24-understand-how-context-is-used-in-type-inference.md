# 24. Understand How Context Is Used in Type Inference

## Guidance

- Many expressions are typed “from the outside in” (contextual typing), especially function expressions.
- Preserve context when you want better inference:
  - assign to a typed variable,
  - provide a generic parameter at the call site,
  - avoid extracting callbacks in ways that lose their expected signature.
- If inference becomes `any`/`unknown`, add just enough context to recover it (don’t blanket-annotate everything).

## Examples

```ts
type Mapper = (n: number) => string;

// Context provides the parameter type.
const toLabel: Mapper = (n) => `#${n.toFixed(0)}`;

// Without context, this parameter may become `any` (depending on compiler options).
const mappers = [
  // (n) => `#${n.toFixed(0)}`,
] satisfies Mapper[]; // restores contextual typing while keeping inference
```

