# 67. Export All Types That Appear in Public APIs

## Guidance

- If a type appears in an exported function/class signature, export it (or re-export it) so consumers can name it.
- Avoid leaking private/internal types through public APIs; it complicates `.d.ts` generation and versioning.
- Prefer `import type` for type-only imports to avoid runtime dependencies.

## Examples

```ts
// Good: the public API surface is fully nameable by consumers.
export type ClientOptions = { baseUrl: string; timeoutMs?: number };

export class Client {
  constructor(private opts: ClientOptions) {}
}

export function createClient(opts: ClientOptions) {
  return new Client(opts);
}
```

