# 42. Avoid Types Based on Anecdotal Data

## Guidance

- Don’t hand-author types based on “a few responses you saw”; it’s easy to miss edge cases and nullability.
- Prefer types from authoritative sources:
  - official SDKs,
  - community-maintained typings,
  - generated types from JSON Schema/OpenAPI/GraphQL.
- If you can’t get authoritative types, treat data as `unknown` and validate/narrow at runtime.

## Examples

```ts
// Example of “schema-sourced” types (in real code, import this from generated output).
type OpenApiComponents = {
  schemas: {
    User: { id: string; email: string; isAdmin?: boolean };
  };
};
type ApiUser = OpenApiComponents["schemas"]["User"];

function renderUser(u: ApiUser) {
  return u.isAdmin ? `Admin: ${u.email}` : u.email;
}
```

