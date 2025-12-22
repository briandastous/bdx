# 35. Prefer More Precise Alternatives to `string` Types

## Guidance

- Use `string` only when *any* string is valid; otherwise, constrain the domain.
- Prefer string literal unions for finite sets (`"GET" | "POST"`).
- Use template literal types to model structured strings (IDs, CSS sizes, hex colors) when it improves correctness.

## Examples

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type HexColor = `#${string}`;

function request(method: HttpMethod, path: `/${string}`) {
  return { method, path };
}

request("GET", "/users");
// request("FETCH", "/users"); // error
```

