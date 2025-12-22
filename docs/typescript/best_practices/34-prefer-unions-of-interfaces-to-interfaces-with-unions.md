# 34. Prefer Unions of Interfaces to Interfaces with Unions

## Guidance

- Prefer discriminated unions (`A | B`) over a single interface with lots of optional/union-typed fields.
- Put fields that only exist together in the same union member.
- Use a discriminant (`kind`, `type`, `status`) to make narrowing reliable and ergonomic.

## Examples

```ts
type Upload =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

function render(u: Upload) {
  if (u.status === "uploading") return `${u.progress}%`;
  if (u.status === "done") return u.url;
  return u.status;
}
```

