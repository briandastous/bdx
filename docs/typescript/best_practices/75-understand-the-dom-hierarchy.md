# 75. Understand the DOM Hierarchy

## Guidance

- DOM types are layered: `EventTarget` → `Node` → `Element` → `HTMLElement` (and many specific element types).
- Narrow `event.target` and query results (`querySelector`, `getElementById`) before using element-specific APIs.
- Prefer `instanceof` checks (or `as` only after a check) to keep runtime and types aligned.

## Examples

```ts
document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // Now safe: HTMLElement APIs exist.
  target.style.outline = "2px solid red";
});
```

