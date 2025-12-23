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
  the repo-specific additions section in `docs/typescript/best_practices/README.md` (with an `Rxx-`
  filename).
- The checklist defines:
  - which primitives are branded (including all DB identifiers) and where they are constructed,
  - the DTO boundary (localized parsing) and how DTOs map to domain types,
  - the `assertNever` pattern for exhaustiveness,
  - `readonly` boundary rules,
  - explicit return type rules for exported APIs.

### Tooling

- ESLint enforces:
  - no `any`,
  - consistent type assertions,
  - explicit return types for exported APIs (repo-wide; add test/script overrides only if needed).
- A type test mechanism exists (expect-type with Vitest).

### Codebase

- Branded IDs exist for core domain identifiers (users, posts, asset instances, materializations,
  ingest runs) and all DB identifiers, and are constructed in a single module.
- DTOs are validated at boundaries (HTTP, CLI, config, DB) and converted to domain types before use.
- Closed unions with `assertNever` are used for key state machines and variant switches.
- Public module boundaries use explicit return types (repo-wide; add test/script overrides only if
  needed).
- New code follows the checklist by default; existing modules are updated as they are touched.

## Work Plan

### Phase 1: Scope + Decisions

- [ ] Capture the refactor-friendly checklist as a repo-specific best-practices item and link it
      from a dedicated "Repo-specific additions" section in the index.
  - [ ] Use the `Rxx-` prefix (e.g., `R01-refactor-friendly-typescript-checklist.md`) to distinguish
        repo-specific items from the Effective TypeScript list.
  - [ ] Include examples that match repo patterns (BigInt IDs, Zod parsing, Kysely boundaries).
- [ ] Decide the branding strategy and scope.
  - [ ] List which IDs are branded (users, posts, asset instances, materializations, ingest runs).
  - [ ] Decision: adopt Option 2 (brand core IDs plus all DB identifiers; avoid branding slugs/handles
        unless ambiguity shows up).
- [ ] Decide the module that owns constructors and conversions.
  - [ ] Decision: adopt Option 1 (create a small leaf `packages/ids` package exported as `@bdx/ids`
        that owns all brands and constructors; it imports nothing and is safe for every layer to
        depend on) and convert at boundaries (HTTP/CLI/config/DB reads) so internal code only sees
        branded values.
  - [ ] Decide the boundary where raw values become branded values.
- [ ] Define DTO vs domain rules.
  - [ ] Identify boundary modules:
    - [ ] `apps/api/src/**` (HTTP handlers, webhooks, query/params parsing).
    - [ ] `packages/cli/src/commands/**` (CLI flags/args parsing).
    - [ ] `packages/config/src/**` (env + YAML parsing).
    - [ ] `packages/db/src/repositories/**` (DB row DTOs -> domain types).
    - [ ] `packages/twitterapi-io/src/**` (external API JSON -> DTO -> domain).
    - [ ] Any new external client packages (same DTO -> domain rule).
  - [ ] Decision: use localized parsing in boundary modules for now, with a hard rule that boundary
        functions return domain types and no boundary-shaped data crosses into core logic.
  - [ ] Note: branding does not require changes to every Kysely query; apply brands in repository
        mappers (row DTO -> domain) so callers only see branded types.
  - [ ] Document where DTO validation occurs and how domain types are created.
  - [ ] Revisit: if parsing starts to duplicate, extract shared DTOs into a `schemas/` package.
- [ ] Define explicit return type policy for exported APIs (which packages must comply).
  - [ ] Decision: enforce explicit return types for exported APIs repo-wide; only add test/script
        overrides if lint becomes too noisy.

### Phase 2: Tooling Guardrails

- [ ] Update ESLint rules to align with the checklist.
  - [ ] Adopt `tseslint.configs.strictTypeChecked` and `tseslint.configs.stylisticTypeChecked`.
  - [ ] Keep `@typescript-eslint/consistent-type-assertions`.
  - [ ] Keep `@typescript-eslint/consistent-type-definitions` **off** (avoid forcing `type` vs
        `interface`).
  - [ ] Add `@typescript-eslint/explicit-module-boundary-types` and enforce it repo-wide.
  - [ ] Decide whether to add a restricted-assertion rule for non-boundary modules.
- [ ] Add a type-test harness.
  - [ ] Decision: use `expect-type` with Vitest (already in use).
  - [ ] Add initial type tests for branded IDs and union exhaustiveness.

### Phase 3: Core Refactors (Incremental)

- [ ] Introduce branded ID types and constructors.
  - [ ] Implement brand utilities in the chosen module.
  - [ ] Define brands for all DB identifiers (primary keys, join tables, run IDs, etc.).
  - [ ] Add safe parsing/normalization helpers for inbound IDs.
- [ ] Convert key boundaries to DTO -> domain flows.
  - [ ] Implement localized DTO parsing in boundary modules.
  - [ ] API request params/bodies: validate and map to domain types.
  - [ ] CLI inputs: validate and map to domain types.
  - [ ] Config loader: validate and map to domain types.
  - [ ] DB repositories: map row DTOs to domain types before returning.
- [ ] Add `assertNever` helper and update key union switches to use it.
- [ ] Apply `readonly` to boundary inputs/outputs for core utilities.

### Phase 4: Adoption + Verification

- [ ] Update best practices docs with examples from the refactored code.
- [ ] Add type tests for any new branded IDs, DTO mappings, and unions.
- [ ] Document an incremental adoption policy (new code must comply; existing code updated when
      touched).
