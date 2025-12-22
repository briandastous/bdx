# 68. Use TSDoc for API Comments

## Guidance

- Use TSDoc-style comments for exported APIs so documentation tooling can parse them consistently.
- Document behavior, constraints, and examples; avoid restating types already expressed in the signature.
- Keep docs close to the API surface (types/functions/classes) so they evolve together.

## Examples

```ts
/**
 * Create a URL-safe slug.
 *
 * @example
 * slugify("Hello, World!") // "hello-world"
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
```

