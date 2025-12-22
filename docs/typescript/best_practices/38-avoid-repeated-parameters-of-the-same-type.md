# 38. Avoid Repeated Parameters of the Same Type

## Guidance

- When multiple parameters share the same type, prefer a single object parameter with named fields.
- Consider distinct types/brands when values are easily swapped (e.g., `UserId` vs `OrgId`, `Lat` vs `Lng`).
- Optimize for call-site readability, not just terseness.

## Examples

```ts
type Email = string & { readonly __brand: "Email" };
type UserId = string & { readonly __brand: "UserId" };

function invite(params: { inviterId: UserId; inviteeEmail: Email }) {
  return params;
}

// invite(inviteeEmail, inviterId) can’t happen: the parameter names and brands prevent swapping.
```

