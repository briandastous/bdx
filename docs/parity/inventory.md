# Phase 1 parity inventory (legacy → rewrite)

This doc is a Phase 1 artifact for `plans/NODE_POSTGRES_REWRITE_PLAN.md`. It captures the concrete “Must port” surface area from the legacy implementation and the key invariants/semantics that need parity (even if API/CLI shapes change).

Legacy repo (local checkout): `/Volumes/bjd_external/Projects/bdastous_monorepo/`

## Ingest jobs (legacy behavior to match)

Legacy “ingest kinds” (Gel enum): `dbschema/default.gel` (`x_ops::ingest_kind`).

### Followers sync

Legacy implementation:
- Service: `apps/x_sync/src/x_sync/services/followers_sync.py`
- Shared logic: `apps/x_sync/src/x_sync/services/_graph_sync_base.py`

Behavior:
- Two modes:
  - Full refresh: writes all relationships returned by the API and soft-deletes any previously-active edges not present in the run.
  - Incremental: stops early once it reaches a page containing no “new” relationships (new = not already active in DB).
- Upserts:
  - Upsert counterpart user profiles as they are encountered (soft-delete + revive semantics are DB-level).
  - Upsert follow edge (`target_id`, `follower_id`) and associated meta rows for traceability.
- Run metadata:
  - Always creates a run row with `status=in_progress`, then updates to `success|error` with `completed_at`.
  - Records `cursor_exhausted` (whether pagination fully completed).
  - Records last HTTP request/response snapshots when available.

### Followings sync

Legacy implementation:
- Service: `apps/x_sync/src/x_sync/services/followings_sync.py`
- Shared logic: `apps/x_sync/src/x_sync/services/_graph_sync_base.py`

Behavior is the same as followers sync, except the “primary” user is the follower and the counterparts are followed users.

### Posts sync

Legacy implementation:
- Service: `apps/x_sync/src/x_sync/services/posts_sync.py`

Inputs/modes:
- Full: `since = null` (fetch as much as allowed by upstream constraints).
- Incremental: `since = <datetime>` (timezone-aware; treated as UTC).

Key behaviors:
- Loads each target user’s profile to derive handles (fail-fast if a profile is missing handle/id).
- Builds one or more query strings (`from:<handle> OR ...`) with a max query length bound; if a single handle exceeds the configured max, the run fails.
- Handles upstream “result window limit” semantics:
  - Tracks per-window result counts and the oldest post timestamp.
  - If a window hits `POSTS_RESULT_WINDOW_LIMIT=1000`, shifts the window backwards using `until=<oldest-1s>` and continues.
  - `cursor_exhausted=false` indicates the run was bounded by window limits (not necessarily “no more posts exist”).
- Persists:
  - user updates (profiles),
  - post upserts,
  - per-post and per-user meta linking rows back to the ingest run.
- Run metadata:
  - `synced_since` stored on the run (informational; not itself a “recency” signal).
  - last HTTP request/response snapshots when available.

### Webhook: new follower

Legacy implementation:
- Stored event type: `x_ops::IFTTTFollowEvent` (see `dbschema/default.gel`)
- HTTP handler: `docs/ANALYSIS.md` references `apps/http_api/src/http_api/app.py` and `.../services/followers.py`

Behavior:
- Validates token and payload.
- Enriches with upstream profile data (when needed) and persists:
  - the webhook event row (raw payload),
  - user/follow upserts + traceability metadata.

## Asset system surface (legacy behavior to match)

Legacy schema + constraints: `dbschema/default.gel` (modules `x_assets`, `x_segments`, `x_post_corpora`).

Legacy definition sources:
- Params and hashing: `libs/shared/src/shared/assets/params.py`
- Ingest dependencies: `libs/shared/src/shared/assets/ingest_dependencies.py`
- Segments: `libs/shared/src/shared/segments/definitions/*`
- Post corpora: `libs/shared/src/shared/assets/post_corpus.py`

### Asset slugs (enumeration)

Legacy `AssetSlug` values:
- `segment_specified_users`
- `segment_followers`
- `segment_followed`
- `segment_mutuals`
- `segment_unreciprocated_followed`
- `post_corpus_for_segment`

Zombie audit confirmation:
- No additional asset slugs exist in the current schema (`dbschema/default.gel`).
- No hook execution tables (`*ActionRun`) exist in the current schema (already removed prior to this rewrite).

### Instance identity (structural params)

Legacy design:
- Operators never supply an opaque instance ID; they supply params.
- Params are hashed deterministically (v1) to create `params_hash`:
  - canonical parts include `asset_slug=<slug>` plus a fixed list of `identity_fields`,
  - nested params include the nested params’ slug + params_hash,
  - `fanout_source_params_hash` participates in identity only when present (engine-managed).

Legacy reference: `libs/shared/src/shared/assets/params.py` (`AssetParams.canonical_parts`, `params_hash_v1`).

Rewrite implication:
- Keep deterministic params hashing and explicitly document:
  - identity vs non-identity inputs,
  - stable sorting rules for any set-like inputs,
  - nested params semantics.

### Segment assets

All segments produce **user IDs**.

#### `segment_specified_users`

Params:
- `stable_key: string` (identity)

Mutable inputs (affect `inputs_hash` but not params identity):
- A per-instance set of `user_external_id` values (can be empty; treated as a warning, not an error).

Legacy reference:
- Params: `libs/shared/src/shared/assets/params.py`
- Mutable input hashing + validation: `libs/shared/src/shared/segments/definitions/specified_users_segment.py`
- Input storage table (Gel): `x_segments::SpecifiedUsersSegmentUser`

Dependencies:
- No asset dependencies.
- No ingest prerequisites (membership is operator-specified), but users may still be absent from the graph until discovered by ingest elsewhere.

#### `segment_followers` / `segment_followed`

Params:
- `subject_external_id: int` (identity)

Legacy materialization:
- Followers: fetch followers of the subject user.
- Followed: fetch followings of the subject user.

Legacy ingest prerequisites:
- Followers segment requires a recent followers ingest for the subject (freshness window `6h`).
- Followed segment requires a recent followings ingest for the subject (freshness window `6h`).

Legacy reference:
- Followers: `libs/shared/src/shared/segments/definitions/followers_segment.py`
- Followed: `libs/shared/src/shared/segments/definitions/followed_segment.py`
- Ingest prerequisites: `libs/shared/src/shared/assets/ingest_dependencies.py`

#### `segment_mutuals`

Params:
- `subject_external_id: int` (identity)

Dependencies:
- `segment_followers(subject_external_id=<same>)`
- `segment_followed(subject_external_id=<same>)`

Materialization:
- Computes intersection of dependency memberships “as-of” the pinned dependency materialization IDs.

Legacy reference:
- Definition: `libs/shared/src/shared/segments/definitions/mutuals_segment.py`
- Membership-as-of query used by derived segments: `libs/shared/src/shared/edgeql/asset_instances/fetch_instance_user_membership_external_ids_as_of_materialization_by_params_hash.edgeql`

#### `segment_unreciprocated_followed`

Params:
- `subject_external_id: int` (identity)

Dependencies:
- `segment_followed(subject_external_id=<same>)`
- `segment_followers(subject_external_id=<same>)`

Materialization:
- Computes `followed - followers` (users the subject follows who do not follow back), using dependency membership “as-of” pinned dependency materializations.

Legacy reference:
- Definition: `libs/shared/src/shared/segments/definitions/unreciprocated_followed_segment.py`
- Membership-as-of query: same as mutuals (see above)

### Post corpus assets

All post corpora produce **post IDs**.

#### `post_corpus_for_segment`

Params:
- `source_segment_params: SegmentParams` (identity; nested params hashing)

Dependencies:
- Dynamically depends on the `Segment` instance described by `source_segment_params`.

Ingest prerequisites:
- Requires posts ingest freshness for **each user** in the pinned source segment membership (“as-of” the dependency materialization).

Materialization (high level):
- Read the pinned source segment membership (as-of).
- Fetch posts for those authors.
- Diff against previous post corpus membership to write enter/exit events.
- Recompute the membership snapshot and bump `output_revision` if membership changed.

Legacy reference:
- Definition: `libs/shared/src/shared/assets/post_corpus.py`
- Ingest prerequisites: `libs/shared/src/shared/assets/ingest_dependencies.py`

## Operator surface (legacy reference)

Legacy CLI inventory (for parity target behaviors, not 1:1 UX):
- `docs/CLI_REFERENCE.md` (`x-sync`):
  - `jobs sync-followers`, `jobs sync-followings`, `jobs sync-posts`
  - Asset management groups:
    - create/track/untrack for each segment type,
    - specified-users add/remove/list,
    - post-corpus-for-segment create/track/untrack,
    - fanout root enable/disable.

Rewrite expectation:
- Provide equivalent operator capabilities via `packages/cli` (`bdx`), even if command names/flags differ.

## Deferred / not ported (explicit)

These legacy concerns should not exist in the rewrite v1. The checklist below is used to verify
that each item was intentionally *not* ported:
- [x] Prefect Cloud + deployment model (engine runner replaces it).
- [x] Gel/EdgeQL schema and codegen workflows.
- [x] `enable-env` secrets injection wrapper.
- [x] Letta app/server.
- [x] Hook execution machinery (e.g., `*ActionRun` flows/APIs); rebuild later only if needed.
