# 11. Distinguish Excess Property Checking from Type Checking

## Guidance

- Know that “excess property” errors are a *special check* that mostly applies to object literals.
- Expect different behavior for object literals vs variables: structural typing allows extra properties when the value is not a fresh literal.
- Don’t “work around” excess property checks by assigning to an intermediate variable; instead, model the type you actually accept.
  - Add optional properties when they’re genuinely allowed.
  - Use a “rest” pattern (or an index signature) when arbitrary extras are expected.

## Examples

```ts
type User = { name: string };

function greet(user: User) {
  return `Hello, ${user.name}`;
}

// Fresh object literal: excess property checking catches likely typos.
// greet({ name: "Ada", age: 36 }); // error: 'age' does not exist in type 'User'

// Non-literal value: assignability is purely structural (extra fields are OK).
const userWithExtras = { name: "Ada", age: 36 };
greet(userWithExtras); // OK

// If extras are actually allowed, express that:
type UserWithUnknownExtras = User & Record<string, unknown>;
```

