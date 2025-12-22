# 21. Create Objects All at Once

## Guidance

- Prefer building an object in a single expression so TypeScript can infer a precise shape.
- Avoid “start with `{}` then assign properties” patterns; they often force `any` or unsafe assertions.
- If construction is conditional, use spreads and helper functions rather than mutation.

## Examples

```ts
type User = {
  id: string;
  name: string;
  isAdmin: boolean;
};

function makeUser(id: string, name: string, isAdmin: boolean): User {
  return { id, name, isAdmin };
}

const user = makeUser("u1", "Ada", false);

const flags = { beta: true };
const config = {
  env: "prod",
  ...flags,
  ...(process.env.DEBUG ? { debug: true } : {}),
};
```

