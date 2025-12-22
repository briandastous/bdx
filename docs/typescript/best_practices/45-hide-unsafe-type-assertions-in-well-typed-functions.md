# 45. Hide Unsafe Type Assertions in Well-Typed Functions

## Guidance

- When you need an assertion, hide it behind a function whose signature is correct and safe for callers.
- Don’t “fix” an implementation error by widening the function’s public type (that just exports the bug).
- Treat assertions like `unsafe`: add rationale (in docs) and unit tests that cover failure modes.

## Examples

```ts
type Peak = { name: string; elevationMeters: number };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function isPeak(v: unknown): v is Peak {
  return typeof v === "object" && v !== null && typeof (v as any).name === "string" && typeof (v as any).elevationMeters === "number";
}

export async function fetchPeak(url: string): Promise<Peak> {
  const data = await fetchJson(url);
  if (!isPeak(data)) throw new Error("Invalid peak payload");
  return data;
}
```

