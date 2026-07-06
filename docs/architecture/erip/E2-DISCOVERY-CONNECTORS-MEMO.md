# ERIP Epic 2 — Enterprise Discovery & Connectors (design memo, E2.P0)

Status: RATIFIED (ERIP autonomous-decision authority; preserves all governing invariants).
Governing roadmap: `docs/architecture/enterprise-risk-intelligence-platform.md` §4 Epic 2.
Foundation: EAR Phase 3b connector activation + P7 relationship persistence (historical
record: `docs/architecture/enterprise-asset-registry/*`). Everything below is ADDITIVE to
that foundation; nothing existing changes behavior while flags are off.

---

## 0. Decisions (ERIP-AD-8 …)

> **ERIP-AD-8 — Observation ledger, not canonical mutation.** Discovery facts (which
> connector saw which external_ref, when, with what confidence and owner/metadata hints)
> live in a new per-org `connector_asset_observations` table. Canonical stores
> (`enterprise_entities`, detail tables, `assets`) are NEVER mutated by
> reconciliation/conflict logic beyond what the existing sync lanes already do (create).
> Drift, confidence, conflict, and owner discovery are all *derived from observations* and
> surfaced read-side. This preserves EAR-AD-1/2 (no attribute duplication; canonical tables
> stay authoritative) while giving every Epic-2 capability one substrate.

> **ERIP-AD-9 — Scheduling is a worker-tick concern, triple-fenced.** Scheduled sync reuses
> the existing every-minute connector worker cron: a due-connector scan enqueues normal
> `connector_sync` jobs (the route's enqueue-dedup shape). No new service, no new cron.
> Fenced behind BOTH existing flags AND new `SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED`
> (default off ×4) — manual sync behavior is unchanged when the new flag is off.

> **ERIP-AD-10 — Incremental sync is an optional adapter capability.** `ConnectorAdapter`
> gains optional `fetchDelta?(config, http, cursor) → {raw, next_cursor}`. The worker uses
> it only when the adapter implements it AND a cursor exists; otherwise full sync. Cursor
> stored per (org, connector) — `enterprise_connectors.sync_cursor JSONB`. A full sync
> always resets the cursor from the fetch result. No adapter is forced to change.

> **ERIP-AD-11 — Drift is reported, never destructive.** Reconciliation compares a FULL
> sync's external_refs against prior observations from the same connector; refs not seen
> again are marked `stale` on the observation row and counted in the sync summary
> (`drift_stale`, `drift_reappeared`). No canonical row is deleted or lifecycle-flipped by
> the engine. (A later operator-facing surface may act on staleness; that is read-side.)

> **ERIP-AD-12 — Conflict resolution = deterministic source precedence, field-level,
> derived.** When multiple connectors observe the same asset, the effective value of a
> discovered field is computed read-side: precedence = (source category rank for that
> field) then recency. Confidence = f(source count, agreement, recency) ∈ [0,100], stored
> per observation, rolled up read-side. Canonical fields set by humans always win (they are
> in canonical tables; observations never overwrite them — ERIP-AD-8).

> **ERIP-AD-13 — Owner discovery is suggest-only.** Adapters may emit `owner_hint`
> (email/display). Hints land on observations; a read route surfaces them per asset with
> the matching `users` row (org-scoped, by email) when one exists. Assigning an owner
> remains the existing human PATCH on the canonical table. No auto-assignment, ever.

> **ERIP-AD-14 — New adapters extend the registry + CHECK in lockstep; auth legs extend
> `HttpClient` optionally.** New connector ids require the deliberate migration widening
> the `enterprise_connectors.connector_id` CHECK (the 20260807 design). New auth modes
> (AWS SigV4) are implemented as a pure signing module injected at the client layer —
> adapters stay `fetch(config, http)`-shaped; the SSRF defense wraps every request
> unchanged. Okta remains served by the existing `identity_provider` adapter (no duplicate
> okta adapter; display name already says Okta-first).

## 1. Phases

### E2.P1 — Sync state + scheduled synchronization + retry/backoff (one PR)
- Additive migration `enterprise_connectors`: `sync_interval_minutes INT NULL CHECK (>= 15)`
  (NULL = manual-only), `next_sync_at TIMESTAMPTZ NULL`, `sync_cursor JSONB NULL`,
  `consecutive_failures INT NOT NULL DEFAULT 0`.
- Worker tick: when triple-fence passes, scan due rows (`enabled AND sync_interval_minutes
  IS NOT NULL AND (next_sync_at IS NULL OR next_sync_at <= now())`) via elevated channel
  (org fan-out — the briefScheduler/reassessment precedent), enqueue deduped
  `connector_sync` jobs, then set `next_sync_at = now() + interval` (schedule-from-enqueue;
  a failed run does not silence the schedule).
- Backoff: on failure, `consecutive_failures++`; scheduler skips rows whose backoff window
  (`interval * 2^min(consecutive_failures,5)`, capped at 24h) hasn't elapsed. Success resets
  to 0. Job-level retry (`decideFailureState`) unchanged.
- PUT /api/connectors/:id accepts `sync_interval_minutes` (validated); GET echoes schedule
  + next_sync_at + consecutive_failures.
- Tests: unit (due-scan predicate, backoff math, PUT validation) + isolation (scheduler
  enqueues for due org only; dedup against pending; flag-off = zero enqueues).

### E2.P2 — Observation ledger + incremental sync + reconciliation/drift (one PR)
- Migration: `connector_asset_observations` (id, organization_id, connector_id,
  external_ref, entity_kind, name, first_seen_at, last_seen_at, last_full_sync_seen_at,
  stale BOOLEAN DEFAULT FALSE, confidence INT NULL, owner_hint TEXT NULL, metadata JSONB
  NULL, UNIQUE (organization_id, connector_id, external_ref)) + inert RLS + app_request DML
  + dataClassification entry. (JSONB here is source-echo metadata, not compliance
  load-bearing — the S0 rule is respected; anything load-bearing must be promoted to typed
  columns before any workflow consumes it.)
- Worker: every persisted entity upserts its observation (`last_seen_at`, name refresh);
  FULL syncs additionally mark unseen refs `stale=true` and count `drift_stale` /
  `drift_reappeared` in the summary.
- `fetchDelta` capability (ERIP-AD-10) + cursor persistence; ServiceNow CMDB gets the
  reference delta implementation (`sys_updated_on >` cursor); others follow per-adapter.
- Tests: unit (upsert/stale planning pure core) + isolation (full-sync → stale marking →
  reappearance; delta path uses cursor and skips stale-marking; cross-org).

### E2.P3 — Conflict resolution + confidence + provenance read surface (one PR)
- Pure `discoveryConfidence.ts`: per-asset effective-field + confidence computation from
  observation rows (ERIP-AD-12; deterministic, fixture-tested).
- Read surface: `GET /api/assets/:id/discovery` (flag-gated, asTenant) — observations,
  per-field effective values + winning source, confidence, staleness. No canonical writes.
- Sync summary gains `conflicts_detected` (same external_ref/name observed with disagreeing
  fields across sources).

### E2.P4 — Owner + metadata discovery (one PR)
- `NormalizedEntity` gains optional `owner_hint`, `metadata` (typed narrow subset per
  category, e.g. os/last_seen for endpoints). Adapters populate where sources expose it.
- Observations store them; `/api/assets/:id/discovery` surfaces owner suggestions with
  org-scoped `users` email match (ERIP-AD-13). Endpoint typed columns (os, last_seen_at)
  populated at create-time where the detail table already has the column — no new canonical
  columns without need.

### E2.P5 — Adapter expansion wave 1: native clouds (one PR)
- `aws` (SigV4 — pure signer module, config: access key id/secret [secret], region;
  inventories EC2 instances + RDS + S3 buckets → cloud_resource/data_store),
  `azure` (OAuth2 client-credentials — the Defender leg reused; Resource Graph query),
  `gcp` (service-account JWT bearer — Cloud Asset Inventory). Categories `cloud`;
  provider stamped from adapter (not config) for these three.
- CHECK-widening migration + registry + REQUIRED_CONNECTOR_IDS + lockstep tests; mock-backed
  fetch/normalize tests per adapter. `cloud_inventory` (pre-authorized export URL) remains
  for anything else.

### E2.P6 — Adapter expansion wave 2 (one PR)
- `microsoft_graph` (OAuth2 client-credentials; devices → endpoints, users → identity
  accounts), `google_workspace` (service-account JWT; users → identity accounts, ChromeOS
  devices → endpoints), `github` (PAT; repos → applications), `jamf` (bearer; computers +
  mobile devices → endpoints).
- Requires the plan-mapping generalization: `NormalizedEntity` gains optional
  `detail_kind?: "endpoint" | "cloud_resource"` hint overriding category-based mapping
  (additive; existing adapters unchanged). CHECK migration + lockstep + mock tests as P5.

## 2. Flags

`SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` (new, default "false" ×4 render.yaml) — only
scheduling. Everything else rides the existing double fence (ECL + registry flags) exactly
like manual sync today.

## 3. Exit criteria (epic)

Mock-credential estate: scheduled incremental syncs run, observations accumulate, a full
sync marks drift, conflicting sources resolve deterministically with confidence, owner
hints surface, and all roadmap sources have adapters (9 existing + aws/azure/gcp/
microsoft_graph/google_workspace/github/jamf = 16) with mock-backed tests. Real-credential
round-trips remain operator-owned (ledger).
