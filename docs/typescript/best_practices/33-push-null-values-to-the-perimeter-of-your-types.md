# 33. Push Null Values to the Perimeter of Your Types

## Guidance

- Keep core domain types non-nullable; handle nullable/optional inputs at I/O boundaries.
- Narrow once, early, and then pass safe types inward (avoids “`T | null` everywhere”).
- Use small helpers to convert nullable APIs into non-nullable results (or throw/return a `Result`).

## Examples

```ts
function requireValue<T>(value: T | null | undefined, msg: string): T {
  if (value == null) throw new Error(msg);
  return value;
}

const maybeEnv: string | undefined = process.env.API_URL;
const apiUrl = requireValue(maybeEnv, "Missing API_URL"); // string
```

