# Enterprise Risk Intelligence Platform (ERIP) — Program Tracker

Living tracker for the ERIP program (governing roadmap:
`docs/architecture/enterprise-risk-intelligence-platform.md`). Successor program to the
completed Enterprise Asset Registry goal (`enterprise-asset-registry-tracker.md` — preserved
as the Epic-1 historical record; do not edit it). Same governing invariants: everything DARK
behind flags (default off), additive-only migrations, backward compatibility, branch off
`origin/develop` → PR → CI 8/8 → squash-merge + delete branch, tenant scoping + inert RLS +
`dataClassification` on every new table, operator actions ledgered never executed, **no
production enablement (GATE B)**.

Last updated: 2026-07-06 (program established #511; Epic 2 memo ratified; E2.P1 merged #512; E2.P2 built).

## Program rulings / decision gates

| Date | Ruling |
|---|---|
| 2026-07-06 | ERIP established as the active governing program (Simmee directive). EAR = Completed Epic 1; EAR docs preserved as historical artifacts. Epics 2–7 approved scope; per-epic design memo required before implementation; autonomous engineering decisions where invariants preserved. Stop conditions: product-vision / destructive migration / compat break / operator-production action / BLOCKED-ON-SIMMEE. |

Open product decisions carried from Epic 1 (reserved for Simmee, not ERIP work): GATE B
production enablement; P9 entitlement-leg cutover.

## Epic ledger

| Epic | Scope | Status | Evidence |
|---|---|---|---|
| 1 — Enterprise Asset Registry | P0–P11 per EAR tracker | **COMPLETE ✅ (2026-07-06)** | PRs #496–#510; develop `7a81f857`; `enterprise-asset-registry-final-report.md` |
| 2 — Enterprise Discovery & Connectors | E2.P0–P6 (memo → sync state/scheduling → incremental+reconciliation+drift → conflict/confidence → owner/metadata → adapters wave 1 (AWS/Azure/GCP) → wave 2 (MS Graph/Google Workspace/GitHub/Jamf/Okta-generalized)) | **IN PROGRESS** — memo ratified (ERIP-AD-8…14); E2.P1 built | `docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md` |
| 3 — Enterprise Risk Intelligence | E3.P0–P4 (memo → continuous correlation → graph risk propagation → business impact → dimensional reporting) | PENDING | — |
| 4 — Executive Intelligence | E4.P0–P3 (memo → reporting API → surfaces → board reports) | PENDING | — |
| 5 — Predictive Intelligence | E5.P0–P3 (memo → pure engine → persistence/API → recommendations) | PENDING | — |
| 6 — Autonomous Operations | E6.P0–P3 (memo → orchestration core → internal executors → ServiceNow/Jira) | PENDING | — |
| 7 — Knowledge Graph / Digital Twin | E7.P0–P3 (memo → graph completeness → analysis surfaces → NL answering) | PENDING | — |
| Close — final report, staging validation guide, prod enablement checklist, rollback plan | after Epics 2–7 | PENDING | — |

## Phase/PR ledger

| Item | Status | PR / squash | Notes |
|---|---|---|---|
| Program establishment (roadmap + tracker + BUILD_SEQUENCE amendment) | **DONE** | #511, squash `c85c612d` | docs-only |
| E2.P0 — Epic 2 design memo (ERIP-AD-8…14) | **DONE** (shipped with E2.P1) | #512, squash `600d22d5` | `docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md`; memo+first-phase shared a PR (EAR P10 precedent) |
| E2.P1 — sync state + scheduled sync + retry/backoff | **DONE** | #512, squash `600d22d5` | Migration `20260811` (interval CHECK ≥15, next_sync_at, consecutive_failures, partial due-index); `connectorScheduleCore.ts` (pure backoff/validation); `connectorScheduledSyncFlag.ts`; worker `runScheduleScan` (elevated due-scan → per-org tenant-tx deduped enqueue + schedule advance; terminal failure = streak+backoff, success resets); PUT accepts `sync_interval_minutes`; flag `SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` default "false" ×4 render.yaml. Unit + isolation `connectorScheduling.test.ts` |
| E2.P2 — observation ledger + incremental sync + drift reconciliation | IN PR | — | Migration `20260812` (`connector_asset_observations` ledger — RLS, app_request DML, dataClassification entry; `enterprise_connectors.sync_cursor JSONB`); `ConnectorAdapter.fetchDelta?` optional capability + `ConnectorCursor`/`DeltaFetchResult` (ERIP-AD-10); ServiceNow reference `fetchDelta` (`sys_updated_on>` watermark; empty delta → cursor unchanged); `connectorObservationCore.ts` (pure plan→observations) + `connectorObservationStore.ts` (upsert; `countReappearing` before upsert; `markDriftStale` via `transaction_timestamp()` inequality — clock-independent, same-tx); worker: full vs delta branch, cursor persist (COALESCE keeps unchanged on null next_cursor), `sync_mode`/`observed`/`drift_stale`/`drift_reappeared` in summary. Drift is report-only — canonical rows never deleted (isolation-proven). Unit (`connectorObservationCore.test.ts`: planner + fetchDelta + migration lockstep) + isolation (`connectorObservations.test.ts`: full→cursor seed, delta no-stale, full-omit→stale→reappear, canonical survives, RLS) |

## Deferred / follow-up register

Carried from Epic 1 (rulings recorded in the EAR tracker; not blockers):
- Legacy assessment route-tx collapse, one stack per PR (EAR-AD-7 step 2).
- vendorAssessments/dependencyAssessments gate normalization (P9-cutover scope).
- Brief citations for corroborating provenance signals.
