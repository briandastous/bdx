# 70. Mirror Types to Sever Dependencies

## Guidance

- Avoid exposing dependency types directly in your public API; it forces consumers to align versions and can bloat their typecheck graph.
- Mirror only what you need: define a local “request-like” or “logger-like” shape and use structural typing.
- Re-export dependency types only when your library is intentionally coupled to that dependency.

## Examples

```ts
// Instead of exposing a deep dependency type, define a minimal local shape:
export type HttpRequestLike = {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
};

export function logRequest(req: HttpRequestLike) {
  return `${req.method} ${req.url}`;
}
```

