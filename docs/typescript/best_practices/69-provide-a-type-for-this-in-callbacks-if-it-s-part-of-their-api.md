# 69. Provide a Type for `this` in Callbacks if It's Part of Their API

## Guidance

- If callers are expected to use `this` inside a callback, model it explicitly with a `this:` parameter.
- Avoid relying on implicit `this` typing; it’s easy to lose in refactors and arrow functions.
- Prefer passing context as an explicit argument when possible; reserve `this:` for established callback APIs.

## Examples

```ts
type Handler = (this: { requestId: string }, message: string) => void;

function onMessage(handler: Handler) {
  handler.call({ requestId: "r1" }, "hello");
}

onMessage(function (message) {
  console.log(this.requestId, message); // `this` is typed
});
```

