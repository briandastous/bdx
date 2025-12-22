# 54. Use Template Literal Types to Model DSLs and Relationships Between Strings

## Guidance

- Use template literal types to constrain structured strings (routes, event names, CSS sizes, IDs).
- Combine with unions to model a small DSL: `\`${Domain}:${Action}\``.
- Prefer compile-time constraints over runtime string parsing when the format is stable and central to correctness.

## Examples

```ts
type Entity = "user" | "order";
type Action = "created" | "deleted";
type EventName = `${Entity}:${Action}`;

function emit(event: EventName) {
  return event;
}

emit("user:created");
// emit("user:updated"); // error
```

