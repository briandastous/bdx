# Invariant Register (Phase 1 seed)

This register tracks invariants expressed in the legacy system (Gel constraints/required fields and application logic) and records how the rewrite will enforce them (DB constraints/schema/trigger/repository) and how we will test them.

Legacy repo (local checkout): `/Volumes/bjd_external/Projects/bdastous_monorepo/`

Policy reference (rewrite): `plans/NODE_POSTGRES_REWRITE_PLAN.md` (“Constraints (Policy)”).

## Core graph + ingest

### Users

- **Invariant:** X user ID is the canonical identity for users.
  - Legacy source: `dbschema/default.gel` (`x_core::User.external_id` required + exclusive).
  - Rewrite enforcement: `users.id bigint primary key` (X user ID); no separate surrogate key.
  - Test strategy: DB constraint tests + repository upsert tests.
- **Invariant:** Handle (username) uniqueness is enforced and handle reassignment “steals” the handle.
  - Legacy source:
    - Schema: `dbschema/default.gel` (`x_core::User.user_name` exclusive).
    - Logic: `libs/shared/src/shared/edgeql/common/upsert_user_profile.edgeql` clears `user_name` from any other user holding it before upsert.
  - Rewrite enforcement:
    - DB: `users.handle_norm text generated always as (lower(handle)) stored` + unique index where `handle is not null`.
    - Repository: in the same transaction, clear `handle` from any other user holding `handle_norm` and insert `user_handle_history` when changed.
  - Test strategy: integration tests asserting (1) conflicting handle is cleared, (2) history rows are written once per transition.
- **Invariant:** Upserting a user “revives” a soft-deleted user.
  - Legacy source: `libs/shared/src/shared/edgeql/common/upsert_user_profile.edgeql` sets `is_deleted := false` for both insert and update paths.
  - Rewrite enforcement: repository upserts set `is_deleted=false` on conflict.
  - Test strategy: repository tests covering delete→revive.

### Follows

- **Invariant:** A follow edge is unique by `(target, follower)` and is soft-deletable.
  - Legacy source:
    - Schema: `dbschema/default.gel` (`x_core::Follow` exclusive on `(.target, .follower)` and `is_deleted` default `false`).
    - Upsert: `libs/shared/src/shared/edgeql/followers/upsert_follow.edgeql` sets `is_deleted := false` (revive on re-seen).
  - Rewrite enforcement:
    - DB: composite primary key or unique index on `(target_id, follower_id)`.
    - DB: `is_deleted boolean not null default false`.
    - Repository:
      - upsert sets `is_deleted=false` and updates meta,
      - full refresh computes removals and sets `is_deleted=true` for missing edges.
  - Test strategy: repository tests for uniqueness + revive + full refresh removal semantics.

### Posts

- **Invariant:** X post ID is the canonical identity for posts, and post upsert revives soft-deletes.
  - Legacy source: `dbschema/default.gel` (`x_core::Post.external_id` required + exclusive; `is_deleted` default false) and `libs/shared/src/shared/edgeql/posts/upsert_post.edgeql`.
  - Rewrite enforcement: `posts.id bigint primary key` (X post ID) + `is_deleted boolean not null default false`; upsert sets `is_deleted=false`.
  - Test strategy: repository tests for upsert + revive.
- **Invariant:** Posts have a stable `(author_id, posted_at)` and are queryable by author/time.
  - Legacy source: `dbschema/default.gel` indexes on `(.external_id)` and `(.author, .posted_at)`; upsert query does not mutate `author`/`posted_at` on conflict.
  - Rewrite enforcement:
    - DB: `posts.author_id bigint not null references users(id)`; `posted_at timestamptz not null`.
    - DB: index `(author_id, posted_at desc)` (or equivalent) for timeline queries.
    - Repository: do not update `author_id`/`posted_at` on conflict unless explicitly justified.
  - Test strategy: repository tests asserting author/timestamp immutability on re-upsert.

### Ingest runs (events)

- **Invariant:** Run status implies `completed_at` semantics.
  - Legacy source: `dbschema/default.gel` constraint on `x_ops::UserFollowsSyncRun` and `x_ops::UserPostsSyncRun`: status is `in_progress` OR `completed_at` exists.
  - Rewrite enforcement: `CHECK ((status = 'in_progress') = (completed_at is null))` (or equivalent check) on run tables.
  - Test strategy: DB constraint tests + repository status transition tests.
- **Invariant:** Runs capture traceability metadata (last API status/error and last HTTP snapshots when available).
  - Legacy source: `dbschema/default.gel` fields on sync run types; implementation in `_graph_sync_base.py` and `posts_sync.py` updates on success/failure.
  - Rewrite enforcement: columns for last HTTP request/response (JSONB) + last_api_status/error; set/clear consistently in repositories.
  - Test strategy: integration tests verifying “failure writes last_http_* when available”.

### Ingest prerequisites (engine-driven)

- **Invariant:** Asset materializations may require ingest prerequisites, satisfied by the engine via recency + advisory locks.
  - Legacy source: `libs/shared/src/shared/assets/instance_engine/ingest_prereqs.py`.
  - Rewrite enforcement: engine runner consults per-target recency tables, acquires locks, and runs ingest inline as prerequisites (per plan).
  - Test strategy: engine integration tests with deterministic fake runners + lock assertions.
- **Invariant:** Followers/followings prereqs run full refresh at least once; subsequent refreshes may run incremental.
  - Legacy source: `libs/shared/src/shared/assets/instance_engine/ingest_prereqs.py` chooses `incremental` based on whether `last_full_success_at` is present.
  - Rewrite enforcement: store `last_full_success_at` (or equivalent) and replicate the selection rule.
  - Test strategy: planner tests: “no full success → full refresh”, “has full success → incremental”.

## Asset system

### Params + instances

- **Invariant:** Params are unique by `(asset_slug, params_hash)`.
  - Legacy source: `dbschema/default.gel` (`x_assets::AssetParams` exclusive on `(.asset_slug, .params_hash)`).
  - Rewrite enforcement: DB unique constraint on `(asset_slug, params_hash)`, typed params tables per slug.
  - Test strategy: DB constraint test.
- **Invariant:** Params hashing is deterministic and uses only identity fields (plus `fanout_source_params_hash` when present).
  - Legacy source: `libs/shared/src/shared/assets/params.py` + tests `libs/shared/src/shared/tests/test_params_hash_v1.py`.
  - Rewrite enforcement: central hash function + tests mirroring the legacy cases (identity vs non-identity fields, nested params hashing, fanout_source_params_hash inclusion rules).
  - Test strategy: unit tests (pure hashing) + integration tests (DB uniqueness by hash).
- **Invariant:** Exactly one instance exists per params row.
  - Legacy source: `dbschema/default.gel` (`x_assets::AssetInstance.params` exclusive).
  - Rewrite enforcement: `asset_instances.params_id` has a unique constraint (or `asset_instances` keyed by params row).
  - Test strategy: DB constraint test + repo create semantics.

### Roots + fanout roots

- **Invariant:** An instance root is unique per instance and can be disabled.
  - Legacy source: `dbschema/default.gel` (`x_assets::AssetInstanceRoot.instance` exclusive; `disabled_at` nullable).
  - Rewrite enforcement: `asset_instance_roots.instance_id unique` + `disabled_at timestamptz null`.
  - Test strategy: integration tests for enable/disable.
- **Invariant:** Fanout roots are unique by `(source_instance, target_asset_slug, fanout_mode)` and can be disabled.
  - Legacy source: `dbschema/default.gel` (`x_assets::AssetInstanceFanoutRoot` exclusive constraint).
  - Rewrite enforcement: DB unique constraint on `(source_instance_id, target_asset_slug, fanout_mode)` + `disabled_at`.
  - Test strategy: integration tests for enable/disable + dedupe.

### Materializations

- **Invariant:** A materialization’s status implies `completed_at` semantics.
  - Legacy source: `dbschema/default.gel` constraint on `x_assets::AssetMaterialization`.
  - Rewrite enforcement: DB `CHECK` constraint on `status/completed_at`.
  - Test strategy: DB constraint tests + materialization runner tests.
- **Invariant:** `output_revision` increases by 1 iff membership changed for the materialization.
  - Legacy source:
    - Segments: `libs/shared/src/shared/segments/base.py` computes `output_revision = prev + (1 if enter+exit>0 else 0)`.
    - Post corpora: `libs/shared/src/shared/assets/post_corpus.py` same pattern.
  - Rewrite enforcement: repository logic that computes enter/exit counts and updates `output_revision` accordingly.
  - Test strategy: integration tests covering “no membership change” and “membership change” cases.

### Events + membership snapshots

- **Invariant:** At most one enter/exit event exists per `(materialization, item)` across enter+exit.
  - Legacy source: `dbschema/default.gel` exclusive constraint on `SegmentEvent` and `PostCorpusEvent` (applies across enter+exit subtypes).
  - Rewrite enforcement: typed `*_events` tables with `event_type ('enter'|'exit')` and `UNIQUE(materialization_id, item_id)`.
  - Test strategy: DB constraint test.
- **Invariant:** `is_first_appearance` exists only for enter events.
  - Legacy source: `dbschema/default.gel` (`AssetEnterEvent.is_first_appearance` required; exit events have no field).
  - Rewrite enforcement: nullable column with `CHECK` constraints:
    - `event_type='enter'` ⇒ `is_first_appearance is not null`
    - `event_type='exit'` ⇒ `is_first_appearance is null`
  - Test strategy: DB constraint tests + repository tests.
- **Invariant:** “Current membership” is stored as a snapshot keyed by instance + item and a pointer to a checkpoint materialization.
  - Legacy source: `dbschema/default.gel` (`x_assets::AssetInstanceMembership` + `AssetInstance.current_membership_materialization`).
  - Rewrite enforcement: typed membership snapshot tables per item kind, storing:
    - `(instance_id, item_id)` membership rows,
    - `checkpoint_materialization_id` per instance (or equivalent pointer).
  - Test strategy: integration tests for materialize→snapshot update and checkpoint repair.

### Specified users segment mutable inputs

- **Invariant:** `segment_specified_users` has a mutable per-instance user-id set that affects `inputs_hash` but not params identity.
  - Legacy source:
    - Schema: `dbschema/default.gel` (`x_segments::SpecifiedUsersSegmentUser` unique `(instance, user_external_id)`).
    - Hashing/validation: `libs/shared/src/shared/segments/definitions/specified_users_segment.py`.
  - Rewrite enforcement:
    - DB: a join table keyed by instance + `user_id` (bigint) with a unique constraint.
    - Repository: inputs-hash computation sorts the set deterministically; empty set yields a WARNING (does not block materialization).
  - Test strategy: unit tests for inputs hashing + integration tests for add/remove/list behaviors.
