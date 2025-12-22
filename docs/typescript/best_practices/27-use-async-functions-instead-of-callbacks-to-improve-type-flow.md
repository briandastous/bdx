# 27. Use `async` Functions Instead of Callbacks to Improve Type Flow

## Guidance

- Prefer `Promise` + `async/await` APIs; they compose better and keep types flowing through control flow.
- Use `Promise.all`/`Promise.allSettled` for parallel work; keep result types explicit when order matters.
- If you must consume callback-style APIs, wrap them once in a typed Promise helper and use the Promise version everywhere else.

## Examples

```ts
function readJson(path: string): Promise<unknown> {
  return import("node:fs/promises")
    .then((fs) => fs.readFile(path, "utf8"))
    .then((text) => JSON.parse(text) as unknown);
}

async function main() {
  const config = await readJson("./config.json");
  console.log(config);
}
```

