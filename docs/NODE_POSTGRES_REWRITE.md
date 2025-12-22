## Node + Postgres rewrite research (not a plan)

This document captures early research to inform a later concrete rewrite plan for moving the system
from Python + Gel to Node.js + Postgres (with TypeScript + Kysely).

This is intentionally not prescriptive; it enumerates:

1. What functionality should and should not be ported (initially and ever).
2. Which tools/libraries/frameworks we might use, and what they replace in today’s stack.

---

## 1) Porting scope: what to keep vs drop

### Must port (core product behavior)

**Ingest + persistence**

- Persist X/Twitter graph data: users, follows, posts.
- Preserve ingest run metadata and traceability (run IDs, timestamps, status, last API error/status).
- Preserve key write semantics currently relied on by services/tests:
  - Follow edges are upserted and soft-deleted (revived on re-seen).
  - Posts are upserted by `external_id` and revived on re-seen.
  - Handle history is recorded on change (and handle uniqueness is enforced).

**Asset system (core model, full-fidelity)**

The asset system is the heart of the product. The rewrite should port the full model (not a “subset
first”), while translating Gel concepts into explicit Postgres schema + application invariants.

- Port the complete model surface area (unless explicitly deprecated after a “zombie” audit), with
  one explicit exception for the initial rewrite pass: do **not** migrate the hook execution DB
  artifacts (e.g., `*ActionRun` tables/queries and claim/retry machinery) or the Python hook APIs
  (`handles_*_hooks`, `on_item_*`, scheduled action definitions). Those are intentionally deferred
  and will be rebuilt later on the TypeScript foundation (see “Defer” below).
  - Asset instances, roots, fanout roots, closure planning, dependency resolution.
  - Ingest prerequisites (recency + locks) and the “engine drives ingest via dependencies” behavior.
  - Materializations, events/provenance, membership projection, checkpoint repair.
- Expect implementation changes to account for Gel→Postgres modeling differences (tables/joins,
  constraints, transactions, advisory locks), but preserve the behavior/invariants.

**Long-running engine runner (single worker role)**

- In normal operation, run a single “asset engine” process (continuously or on a cadence) that:
  - Evaluates enabled roots/fanout roots, resolves ingest dependencies, and materializes as needed.
  - Triggers followers/followings/posts ingest as _prerequisites_ (not as separately scheduled workers).
- Keep CLI entry points for ad-hoc syncs, but treat them as operator tools rather than the primary
  orchestration mechanism.
- Initial migration: focus on materialization + ingest + provenance; deliberately scope out enter/exit/
  scheduled hook execution and rebuild later with clearer semantics.

**Operator interfaces**

- CLI(s) to run ad-hoc syncs and manage asset instances/roots (or an equivalent operator surface).
- Basic local/dev stack orchestration (at least “run API + worker + DB”).

**Webhook API**

- A webhook endpoint to accept “new follower” events (or whichever webhooks you actually need).
- AuthN/authZ equivalent to the current shared-secret token approach.

**Observability**

- Structured logs, correlated by run IDs and job IDs.
- Error reporting and enough provenance to debug “why did this run happen / what did it touch”.

### Defer (rebuild later on the TypeScript foundation)

- Enter/exit/scheduled hooks: do not port the existing `*ActionRun` schema artifacts, claim/retry
  machinery, or Python asset APIs (`handles_*_hooks`, `on_item_*`, scheduled action definitions).
- Keep the foundational data needed to rebuild triggers later (materializations + membership snapshots
  - membership diffs/events + run/provenance metadata).
- When reintroducing triggers, make semantics explicit (bootstrap vs “enter from empty”, `on_first_enter`
  with an explicit epoch/reset boundary, scheduled triggers in batch vs per-item modes).

### Do not port (Gel/Python-specific mechanics)

- `workspace-gel`, `gel-codegen`, `gel-rewrite`, and the entire EdgeQL binding/codegen workflow.
- Gel-specific schema constructs (Gel enums/scalars, links semantics, etc.)—replace with SQL types,
  constraints, and application-level invariants.
- Prefect Cloud deployment model (keep the _concept_ of scheduled runs, but not Prefect itself).

### Actively reconsider / probably drop (unless there’s a clear need)

- Pruning “rich” provenance (large request/response payloads, verbose history tables): defer until
  after the migration, once replacement logging/tracing is verified, then keep only what you
  actually query/use and add retention policies as needed.

---

## 2) Tooling/library options (and what they replace)

### Runtime + language

- **Decision: Node.js (Active LTS only)**: long-running services (engine runner) + broad ecosystem support.
  - As of 2025-12, Node v24 is Active LTS; Node v22 is Maintenance LTS.
  - Do not target Node “Current” for any environment.
- **TypeScript**: primary language; prefer strict mode.

**TypeScript strictness policy (recommended)**

- `tsconfig.json`: enable `"strict": true`, plus:
  - `"noUncheckedIndexedAccess": true`
  - `"exactOptionalPropertyTypes": true`
  - `"useUnknownInCatchVariables": true`
  - `"noImplicitOverride": true`
  - `"noImplicitReturns": true`
  - `"noFallthroughCasesInSwitch": true`
  - `"noPropertyAccessFromIndexSignature": true`
- ESLint: use `@typescript-eslint` with type-aware linting (the “type-checked” configs) and enforce:
  - No escape hatches: `no-explicit-any`, `ban-ts-comment` (allow `@ts-expect-error` only with a description).
  - No unsafe typing: the `no-unsafe-*` rule family.
  - Async correctness: `no-floating-promises`, `no-misused-promises`, `await-thenable`.
  - Reduce null/undefined footguns: `no-non-null-assertion`, `no-unnecessary-condition`.
  - Hygiene: `consistent-type-imports`.

### Database access

**Query builder**

- **Decision: Kysely**: type-safe SQL query builder; good fit for “we want control over SQL”.
  - Replaces: Gel schema + EdgeQL + generated query bindings.
  - Strategy: avoid 1:1 “port every EdgeQL query” translations. Prefer well-factored Kysely query
    utilities (shared projections, joins, filters, `kysely-cursor` pagination) so cross-query reuse is a
    first-class benefit of the rewrite.

**Driver**

- Decision: `postgres` (porsager/postgres) + `kysely-postgres-js` dialect.

**Type generation**

Decision: `kysely-codegen` (introspect DB schema → generate Kysely `Database` types).

**Pagination**

- Decision: `kysely-cursor` for cursor-based (keyset) pagination with Kysely.
  - Use it directly (not an internal wrapper) to keep pagination behavior consistent across queries.
  - Note: the project warns about cross-version cursor token compatibility; mitigate by pinning versions
    and treating cursors as opaque and short-lived (token invalidation across deploys is acceptable).

### Migrations

Kysely includes a migrations API, but teams often prefer a dedicated migration tool.

Decisions:

- Use **Kysely migrations** (TypeScript + schema builder-first).
- Run migrations **automatically on deploy** from the `worker` service only (never from `api`).
  - Guard with a Postgres advisory lock so only one migrator runs at a time (even across restarts).
  - Include a kill switch env var (e.g. `RUN_MIGRATIONS=0`) to disable auto-migrate quickly if needed.
  - Prefer expand/contract migrations by default; for destructive/high-risk migrations (drops/renames,
    big rewrites/backfills), temporarily disable auto-migrate and run a one-off command via Railway SSH.

Reasoning:

- Keeps a single Postgres access stack (`postgres` + `kysely-postgres-js`) and avoids introducing `pg`
  “just for migrations”.
- Minimizes operational footguns for a solo developer while retaining an escape hatch for risky changes.

### Web framework (HTTP API)

Replaces `FastAPI`.

Decisions:

- **Fastify** for the HTTP API.
- **`fastify-kysely`** to register the Kysely instance(s) on the Fastify server lifecycle and share them
  across routes/plugins via `fastify.kysely.<namespace>` (auto-destroy on server close).
- Validation + OpenAPI: use Zod-powered schemas for runtime validation and consistent typing (exact
  Fastify plugin choices TBD).

### CLI framework

Replaces `Typer` CLIs:

- Decision: `oclif` (structured CLI framework).

Reasoning:

- We expect multiple operator-facing commands (ad-hoc syncs, asset instance/root management, admin
  utilities), and `oclif` provides consistent structure, help output, and command organization as the
  CLI surface grows.

### Job queue + scheduling (critical for long-running engine operation)

Replaces Prefect Cloud + local Prefect worker container.

Your current architecture is already “engine-driven”: the asset engine triggers upstream syncs via
ingest dependencies. That means you can start the rewrite with **one engine runner** and no separate
queue, and only introduce a queue later if you need more isolation/parallelism.

**0) Single engine runner (no queue)**

- Decision: run a single long-lived “worker” service with an internal loop/tick cadence.
- Use Postgres advisory locks + “recency” tables as your coordination + idempotency layer.
- Treat followers/followings/posts as _units of work invoked by the engine_, not separate workers.
- Recommendation: ship the initial rewrite with **no job runner/queue**. The engine executes ingest +
  materialization inline; only add a queue later if you have concrete pressure for isolation,
  parallelism, or durable retries.

**Railway note (cron vs worker)**

- Railway supports cron jobs, but they’re designed for short-lived tasks that run and exit.
- Constraints: min 5-minute interval, schedule drift (minutes), overlapping executions are skipped if
  a prior run is still running.
- Conclusion: use an always-on worker service for the engine runner; treat Railway cron as an option
  only for bounded maintenance tasks (or an explicit “one tick then exit” command).

**Existing Prefect flows/deployments that need no 1:1 replacement**

- There are no Prefect flows/deployments for followers/followings/posts today; those sync functions are invoked by the planner flow as ingest prerequisites.
- `config/job_registry.yaml` currently defines only `x_segments.plan`, which points at
  `scheduler/segments-plan` (the assets planner).

**Prefect deployments today (and rewrite mapping)**

- `scheduler/segments-plan` (`assets-planner` / `segments_planner_flow`): replace with the Node engine
  runner as a long-lived worker service (daemon). No separate sync workers required.
- Note: the legacy Prefect deployments for hook draining/scheduled hooks have been removed in a
  pre-rewrite “zombie audit” cleanup. Hook execution remains intentionally out of scope for the first
  rewrite pass and will be rebuilt later.

If we later decide to split out work from the engine loop (parallelism, isolation, durable retries,
multi-worker scaling), see “Work to Consider Post-Migration” for queue/workflow options.

### Configuration + secrets

Replaces Pydantic Settings + 1Password env overlays + `enable-env`.

Decision:

- Keep “base + environment overlays” for **non-secret** configuration (like today’s
  `config/base.yaml` + `config/env/*.yaml`), validated at startup with a typed schema (e.g. Zod).
- Avoid `enable-env`-style wrappers in the rewrite; use standard environment variables and fail-fast
  validation instead.
- Treat “base + env-specific env files” as **templates/documentation**, not as runtime injection:
  - Maintain `.env.example` (and optional `.env.staging.example` / `.env.prod.example` if the key set
    differs) to enumerate required keys.
  - Local development uses a single `.env.local` (gitignored) for secrets when needed.
  - Railway staging/prod use Railway-managed environment variables/secrets as the source of truth.
  - Optional: use `op run … -- <cmd>` locally if you still want 1Password, but keep it explicit.

Reasoning:

- Separating config overlays from secrets reduces precedence confusion and avoids wrapper-coupled CLI
  behavior.
- `.env.example` + typed validation catches missing/misnamed variables without requiring external
  tooling to be “working” at dev time.

### Logging + observability

Replaces Loguru + Datadog container logging assumptions.

Decisions:

- Logs: `pino` for structured JSON logs (Fastify-native).
- Railway staging/prod: run a Datadog Agent as a separate Railway service and use `dd-trace` in the
  API + engine worker to send traces to it (Datadog-native APM).
  - Apps point `DD_AGENT_HOST` at the Agent’s Railway private domain; configure the Agent to accept
    non-local APM intake.
  - Use unified service tagging (`DD_SERVICE`, `DD_ENV`, `DD_VERSION`) and enable log correlation
    (`DD_LOGS_INJECTION=true`).
  - Initialize the tracer first (ESM load order) so auto-instrumentation works reliably.
  - Forward logs to Datadog via the Agent using syslog intake (per Railway’s Datadog Agent tutorial),
    so logs and traces correlate in Datadog.
- Local dev: tracing/log shipping to Datadog is opt-in (env flag + low sampling) to keep the local
  edit/run/debug loop fast.
- Note: Railway enforces a per-replica log throughput limit (500 log lines/sec); keep logs minimal,
  structured/minified, and consider sampling for high-frequency events.

### Testing + linting

Replaces `pytest`, `ruff`, `pyright`.

- Tests: `vitest` (Vitest tends to be faster than `jest` + TS-friendly).
- Lint: `eslint` + `typescript-eslint` (+ `prettier`).
- Typecheck: `tsc --noEmit`.

---

## Deployment targets: implications for Node

You likely need at least one long-running engine runner; that strongly favors **containers/VMs** over
serverless/edge.

### Environments (recommended for Railway)

Decision: use **local dev** + **Railway staging** + **Railway prod** (no separate Railway “dev”).

Reasoning:

- Solo developer + no inbound webhooks needed during development → local is the lowest-friction
  edit/run/debug loop (no deploy step).
- Staging is the first always-on “integration” environment to validate deploys, migrations, and
  engine-runner cadence against real infrastructure.
- Prod stays clean and stable; promote from staging when ready.

### Containers (VM, ECS/Fargate, Fly.io, Render, Railway, Kubernetes)

- Best fit for a long-running engine runner (and any auxiliary workers, if introduced later).
- Best compatibility with Postgres drivers and connection pooling.
- Note: explore Railway as a production hosting option (service + Postgres in the same region).
- Railway shape (recommended): **two always-on app services** (same repo/codebase, different
  entrypoints/commands):
  - `api`: Fastify HTTP API (webhooks and future HTTP surface).
  - `worker`: the long-running engine runner loop (materialization + ingest).
  - Supporting Railway components/services:
    - Postgres (Railway-managed).
    - `datadog-agent` (staging/prod only): receives traces/logs from `api` and `worker`.
  - Do not use Railway cron jobs for the engine loop.
- Ops/CLI commands on Railway:
  - Principle: split services by workload class/SLOs (API latency vs engine throughput), not by “has
    a CLI”.
  - Default: run operator commands on-demand via Railway SSH (for example, `railway ssh -- <cmd>`)
    against the `worker` service so they run close to Postgres with the real staging/prod env vars.
  - If ops commands become frequent/heavy or you want stricter access control, add a dedicated `ops`
    service later; keep it optional to avoid introducing a third always-on failure domain too early.

### Application structure (reflect the `api` + `worker` split)

Make the service split “real” in the codebase by having separate entrypoints and a shared core.

**Recommended layout**

```
apps/
  api/          # Fastify server entrypoint + routes
  worker/       # engine loop/tick entrypoint
packages/
  db/           # Kysely setup, migrations, kysely-codegen types
  engine/       # planner/materialization/ingest orchestration (no Fastify imports)
  config/       # env schema + validation + shared defaults
  observability/ # dd-trace init + pino base logger + shared log fields
  cli/          # oclif commands (import db/engine/config; runs via Railway SSH)
```

**Boundaries (keep coupling low)**

- `packages/engine` is “pure” business logic (no HTTP concerns); `apps/api` stays thin (validate →
  persist intent/state → return).
- Prefer Postgres as the cross-service integration boundary early:
  - `api` writes webhook events / “work requested” markers / recency state.
  - `worker` consumes that state in its loop, using advisory locks + idempotency to avoid duplicates.
- Observability/config should be shared, but *tagged per service* (`DD_SERVICE=api` vs
  `DD_SERVICE=worker`, distinct log levels/concurrency knobs).

### Serverless functions (Lambda/Vercel Functions/etc.)

- Fine for the webhook API if you want, but a poor fit for the engine runner.
- You’d still need a separate container/VM target for the engine, which reduces the value of
  choosing a serverless-first runtime/deployment model.

### Edge runtimes (Cloudflare Workers/Vercel Edge/etc.)

- Great for low-latency HTTP, generally not for long-running work.
- Often incompatible with direct Postgres TCP drivers; pushes you toward HTTP-based DB access.

Practical implication: if we assume a container target for the engine runner, **choosing Node is
primarily an ecosystem/ergonomics decision** (and Node is the safer default).

---

## Open decisions to resolve before writing the concrete plan

- Asset system “zombie audit”: identify any features that can be intentionally deprecated instead of
  ported.

---

## Work to Consider Post-Migration

### Optional job execution substrate

If the single engine runner becomes too coupled or too slow (parallelism, isolation, durable retries,
or multi-worker scaling), consider introducing one of the following:

**A) Postgres-backed jobs (fewer dependencies)**

- `graphile-worker` (npm: `graphile-worker`)
- `pg-boss` (npm: `pg-boss`)

Pros:

- Runs on Postgres (no Redis).
- Good fit for “one DB to operate” + long-running engine runners.

Cons:

- You must be deliberate about DB load and job table growth.
- Some patterns (high-volume queues, delayed jobs at scale) may still prefer Redis.

**B) Redis-backed queue (separates concerns)**

- `bullmq` (npm: `bullmq`)

Pros:

- Very mature for background jobs, retries, rate limits, concurrency control.
- Redis can absorb high queue throughput without stressing Postgres.

Cons:

- Adds Redis as a required infra component.

**C) Workflow engine (highest reliability, highest complexity)**

- Temporal

Pros:

- Best-in-class durability and workflow semantics (retries, idempotency, long workflows).

Cons:

- Large operational + conceptual overhead for an early-stage system.

Recommendation if/when needed: start with **Postgres-backed jobs** to keep infra minimal; prefer
`graphile-worker` first (evaluate `pg-boss` if you want a different feature set/ergonomics). If you
need very high queue throughput or want to protect OLTP load, revisit a Redis-backed queue.
