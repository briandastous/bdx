# Refactor-Friendly TypeScript Plan

This document turns the refactor-friendly TypeScript checklist into an executable plan for this
repository. The goal is to increase refactor safety with minimal disruption and clear guardrails.

## References

- `docs/typescript/best_practices/README.md` (current best practices index)
- New checklist doc to be captured in Phase 1 (see Work Plan)

## Goals / Non-Goals

### Goals

- Make identity, ownership, and closed sets explicit so refactors are compiler-guided.
- Introduce branded types for IDs and other high-risk primitives, with single-module constructors.
- Separate external DTO types from internal domain types at boundaries (HTTP, CLI, config, DB).
- Use closed discriminated unions with exhaustiveness checks for state machines.
- Push `readonly` to boundaries and encapsulate mutation in owned modules.
- Keep module APIs small and stable to minimize blast radius of changes.
- Add tooling guardrails (lint rules, type tests) to prevent regressions.

### Non-Goals

- No large-scale architectural rewrite of the repo structure in one pass.
- No requirement to retrofit every existing module immediately; adopt incrementally.
- No change to runtime behavior or external API semantics unless required for correctness.
- No re-generation of DB codegen types unless a boundary change requires it.

## Acceptance Criteria

### Documentation

- A refactor-friendly checklist is documented in `docs/typescript/best_practices/` and linked from
  `docs/typescript/best_practices/README.md`.
- The checklist defines:
  - which primitives are branded and where they are constructed,
  - where DTO validation happens and how DTOs map to domain types,
  - the `assertNever` pattern for exhaustiveness,
  - `readonly` boundary rules,
  - explicit return type rules for exported APIs.

### Tooling

- ESLint enforces:
  - no `any`,
  - consistent type assertions,
  - explicit return types for exported APIs (scoped to agreed packages/modules).
- A type test mechanism exists (either `tsd`/`expect-type` or a `tsc`-only type test project).

### Codebase

- Branded IDs exist for core domain identifiers (users, posts, asset instances, materializations,
  ingest runs) and are constructed in a single module.
- DTOs are validated at boundaries (HTTP, CLI, config, DB) and converted to domain types before use.
- Closed unions with `assertNever` are used for key state machines and variant switches.
- Public module boundaries use explicit return types.
- New code follows the checklist by default; existing modules are updated as they are touched.

## Work Plan

### Phase 1: Scope + Decisions

- [ ] Capture the refactor-friendly checklist as a new best-practices item and link it from the
      index.
  - [ ] Choose a doc filename and number (append to the current list).
  - [ ] Include examples that match repo patterns (BigInt IDs, Zod parsing, Kysely boundaries).
- [ ] Decide the branding strategy and scope.
  - [ ] List which IDs are branded (users, posts, asset instances, materializations, ingest runs).
  - [ ] Decide the module that owns constructors and conversions.
  - [ ] Decide the boundary where raw values become branded values.
- [ ] Define DTO vs domain rules.
  - [ ] Identify boundary modules (HTTP handlers, CLI parsers, config loader, DB repositories).
  - [ ] Document where DTO validation occurs and how domain types are created.
- [ ] Define explicit return type policy for exported APIs (which packages must comply).

### Phase 2: Tooling Guardrails

- [ ] Update ESLint rules to align with the checklist.
  - [ ] Add `@typescript-eslint/consistent-type-assertions`.
  - [ ] Add `@typescript-eslint/explicit-module-boundary-types` and scope it to agreed packages.
  - [ ] Decide whether to add a restricted-assertion rule for non-boundary modules.
- [ ] Add a type-test harness.
  - [ ] Pick the approach (`tsd`, `expect-type`, or a dedicated `tsc` project).
  - [ ] Add initial type tests for branded IDs and union exhaustiveness.

### Phase 3: Core Refactors (Incremental)

- [ ] Introduce branded ID types and constructors.
  - [ ] Implement brand utilities in the chosen module.
  - [ ] Add safe parsing/normalization helpers for inbound IDs.
- [ ] Convert key boundaries to DTO -> domain flows.
  - [ ] API request params/bodies: validate and map to domain types.
  - [ ] CLI inputs: validate and map to domain types.
  - [ ] Config loader: validate and map to domain types.
- [ ] Add `assertNever` helper and update key union switches to use it.
- [ ] Apply `readonly` to boundary inputs/outputs for core utilities.

### Phase 4: Adoption + Verification

- [ ] Update best practices docs with examples from the refactored code.
- [ ] Add type tests for any new branded IDs, DTO mappings, and unions.
- [ ] Document an incremental adoption policy (new code must comply; existing code updated when
      touched).
      \*\*\* End Patch]}）
