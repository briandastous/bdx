# 63. Use Optional `never` Properties to Model Exclusive Or

## Guidance

- Use XOR types when two sets of properties are mutually exclusive.
- Model XOR by making the “other side” properties optional `never` so they can’t be provided.
- Prefer XOR over “bag of optionals” for public APIs (clearer call sites, better narrowing).

## Examples

```ts
type LinkProps =
  | { href: string; to?: never }
  | { to: { route: string }; href?: never };

function Link(props: LinkProps) {
  return props;
}

Link({ href: "https://example.com" });
Link({ to: { route: "/users" } });
// Link({ href: "x", to: { route: "/y" } }); // error
```

