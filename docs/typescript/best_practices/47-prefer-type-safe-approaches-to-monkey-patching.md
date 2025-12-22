# 47. Prefer Type-Safe Approaches to Monkey Patching

## Guidance

- Prefer structured data flow over attaching ad-hoc data to globals, DOM nodes, or built-in prototypes.
- If you must extend built-in types, use declaration merging/module augmentation so the added fields are typed.
- Include `undefined` in the augmented type when it can be missing at runtime.

## Examples

```ts
type CurrentUser = { id: string; email: string };

declare global {
  interface Window {
    currentUser?: CurrentUser;
  }
}

export function greetCurrentUser() {
  const user = window.currentUser;
  if (!user) return "Hello!";
  return `Hello, ${user.email}!`;
}
```

