---
name: typescript-best-practices
description: Apply this repository’s TypeScript best practices when writing, refactoring, or reviewing TypeScript (especially for the Node+Postgres rewrite). Use when designing types, dealing with strictness (exactOptionalPropertyTypes/noUncheckedIndexedAccess), handling unknown inputs, avoiding any, building APIs, or creating migrations/DB code.
---

# TypeScript Best Practices (Repo)

Use the repo’s curated best practices as the default standard for TypeScript implementation and review.

## Find the right guidance (progressive disclosure)

1. Open the index:
   - `docs/typescript/best_practices/README.md`
2. Locate relevant items by searching titles and/or content:
   - Search titles: `rg -n "<keyword>" docs/typescript/best_practices/README.md`
   - Search full text: `rg -n "<keyword>" docs/typescript/best_practices`
3. Read only the few items that match the change you’re making (usually 1–4 files).
4. Apply the guidance and include TypeScript examples in the final output when helpful.

## Default rules (apply unless there’s a strong reason not to)

- Prefer `unknown` at boundaries (JSON, HTTP, env vars) and narrow with runtime checks; avoid leaking `any`.
- Prefer type annotations/safe constructs (`satisfies`, type guards) over broad assertions (`as`), and localize unavoidable assertions.
- Prefer types that represent valid states (discriminated unions over “bag of optionals”).
- Prefer precise types (string unions, brands, `Record<Union, …>`) when domains are finite or mix-ups are costly.
- Keep API and DB layers strongly typed; don’t export dependency types accidentally.

## High-signal item shortcuts

When you see these situations, consult these topics in `docs/typescript/best_practices/README.md` and open the matching item doc(s):

- Runtime vs type system / boundary validation: Items 1–3, 74
- `any` / `unknown` / unsafe assertions: Items 5, 9, 43–46
- Type modeling and invalid states: Items 29–37, 40
- Generics and advanced typing: Items 50–58
- Exhaustiveness and recipe patterns: Items 59–64
- Public API comments + declaration hygiene: Items 67–71, 68

