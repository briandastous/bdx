# 74. Know How to Reconstruct Types at Runtime

## Guidance

- Types are erased; if you need runtime checks, build them explicitly (schemas/codecs/type guards).
- Keep runtime representations close to types (e.g., a discriminant field, a list of allowed strings) to reduce drift.
- Validate early at boundaries, then pass safe types inward.

## Examples

```ts
type Role = "admin" | "user";
const roles: readonly Role[] = ["admin", "user"];

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (roles as readonly string[]).includes(v);
}

function parseRole(v: unknown): Role {
  if (!isRole(v)) throw new Error("Invalid role");
  return v;
}
```

