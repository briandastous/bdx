# 78. Pay Attention to Compiler Performance

## Guidance

- Complex types can slow down `tsc` (especially deeply nested conditional/mapped types and huge unions).
- Prefer simpler types with clear boundaries; consider codegen when types become too slow or too complex.
- Measure and track: `tsc --diagnostics` / `--extendedDiagnostics`, project references, incremental builds.

## Examples

```ts
// Example of a potentially expensive type in large codebases:
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

// Use sparingly; prefer shallower helpers or explicit domain types when possible.
```

