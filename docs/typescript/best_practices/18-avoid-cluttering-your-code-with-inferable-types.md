# 18. Avoid Cluttering Your Code with Inferable Types

## Guidance

- Let TypeScript infer obvious local types from initializers; it reduces noise and keeps code flexible.
- Add annotations where they provide value:
  - exported/public APIs,
  - places inference would widen too much,
  - intentional constraints (e.g., accept only a subset).
- Prefer `satisfies` when you want conformance checks without losing inferred literal types.

## Examples

```ts
// No need to repeat what’s already obvious:
const port = 8080; // number
const baseUrl = "https://api.example.com"; // string

// Annotation can still be useful when it communicates intent:
const retryDelaysMs: readonly number[] = [50, 100, 200];
```

