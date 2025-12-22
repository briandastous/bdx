# 58. Consider Codegen as an Alternative to Complex Types

## Guidance

- If types become extremely complex (hard to read, hard to maintain, slow to compile), consider generating code/types instead.
- Codegen can be a better fit for large schemas (OpenAPI/GraphQL), route tables, translation keys, etc.
- Prefer a simple, stable source of truth (schema/config) and generate both runtime code and types from it.

## Examples

```ts
// “Codegen-like” pattern using `as const` to derive types from data.
const routes = {
  "/users": { method: "GET" },
  "/orders": { method: "POST" },
} as const;

type Route = keyof typeof routes;
type MethodFor<R extends Route> = (typeof routes)[R]["method"];

type UsersMethod = MethodFor<"/users">; // "GET"
```

