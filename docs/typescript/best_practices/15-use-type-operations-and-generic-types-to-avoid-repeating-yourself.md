# 15. Use Type Operations and Generics to Avoid Repeating Yourself

## Guidance

- Derive related types with operations like `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, and mapped types.
- Use `keyof` and indexed access types (`T[K]`) to keep types aligned with actual object shapes.
- Prefer deriving types from values (`typeof`, `ReturnType`) when you need a single source of truth.

## Examples

```ts
type User = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

type UserPreview = Pick<User, "id" | "name">;

function toPreview(user: User): UserPreview {
  return { id: user.id, name: user.name };
}

function fetchUser(id: string) {
  return { id, name: "Ada", email: "ada@example.com", createdAt: new Date() } satisfies User;
}

type FetchUserResult = ReturnType<typeof fetchUser>; // stays in sync with implementation
```

