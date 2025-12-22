# 71. Use Module Augmentation to Improve Types

## Guidance

- Use module augmentation when a library’s types are incomplete and you can safely extend them.
- Keep augmentations narrow, documented, and version-aware (they can break when the upstream library changes).
- Prefer `import type` and put augmentations in a `.d.ts` (or a clearly-scoped module) so they’re applied consistently.

## Examples

```ts
// Example: augment a module’s exported interface (hypothetical module name).
declare module "my-lib" {
  interface Options {
    /** Enable extra logging in our app */
    debug?: boolean;
  }
}

// After augmentation, this type is now visible to the compiler:
import type { Options } from "my-lib";
const opts: Options = { debug: true };
```

