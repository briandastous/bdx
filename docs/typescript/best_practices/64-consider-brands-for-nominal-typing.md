# 64. Consider Brands for Nominal Typing

## Guidance

- TypeScript is structural; use brands when two values share a representation (often `string`) but must not be interchangeable.
- Brand at the boundary (parsing/validation) and keep branded values inside the domain layer.
- Avoid over-branding: brands add friction; use them for truly dangerous mix-ups (IDs, units, tokens).

## Examples

```ts
type UserId = string & { readonly __brand: "UserId" };
type OrgId = string & { readonly __brand: "OrgId" };

function asUserId(id: string): UserId {
  return id as UserId;
}

function loadUser(userId: UserId) {
  return userId;
}

const userId = asUserId("u1");
// loadUser("u1"); // error
loadUser(userId);
```

