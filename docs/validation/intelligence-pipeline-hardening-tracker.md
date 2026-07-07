# Intelligence Pipeline Hardening — Tracker

Living tracker for the **Intelligence Pipeline Hardening** goal (make all
intelligence consumed by ERIP canonical, corroborated, deduplicated,
quality-checked, and enterprise-grade before it reaches Risk Intelligence,
Executive Intelligence, Workflows, the Knowledge Graph, or the Intelligence
Brief).

Design memo: `docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md`.
Enablement + rollback + operator ledger: `docs/runbooks/intelligence-events-enable-rollback.md`.

Governance (inherited from ERIP): everything DARK behind flags (default off),
additive migrations only, backward compatibility, tenant/global scoping honoured,
reuse-before-rewrite, operator actions ledgered never executed, **no production
enablement (GATE B)**.

## Flags

| Flag | Default | Purpose | Declared |
|---|---|---|---|
| `SECURELOGIC_BRIEF_CATCHUP_ENABLED` | `false` | Boot-time recovery of a missed weekly Tuesday brief send | engine + engine-staging (2 — only services that boot the scheduler) |
| `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` | `false` | Canonical Intelligence Event projection + findings + notifications + downstream reads | 4 ingestion services |

## Lifecycle states (authoritative)

`new → corroborating → confirmed → actively_exploited → mitigated → resolved →
archived` (`intelligenceEventLifecycle.ts`). Derived from accumulated evidence
(source count, authoritative sources, ever_exploited, ever_patched); resolved/
archived come from the time-based aging pass; never regressed except re-emergence.

## Migrations (additive, dark)

| Migration | Adds |
|---|---|
| `20260822_intelligence_events.sql` | 3 GLOBAL tables: events (7-state lifecycle + ever_exploited/ever_patched), sources ledger, timeline |
| `20260823_findings_intelligence_event.sql` | findings source_type 'intelligence_event' + partial unique dedup index |
| `20260824_intelligence_event_notifications.sql` | ORG-scoped notification dedup ledger (RLS + app_request grant) |
| `20260825_intelligence_event_workflow_triggers.sql` | GLOBAL workflow-trigger dedup ledger (one per event+state) |

## Goal-item ↔ slice map

| Goal item | Status | Where |
|---|---|---|
| 1 — Canonical Intelligence Events | **BUILT (dark)** | `intelligence_events` + `eventCanonicalKey` + `planEventUpsert` + store |
| 2 — Source corroboration | **BUILT (dark)** | `intelligence_event_sources` ledger (attribution/revisions preserved) |
| 3 — Deduplication / update-detection | **BUILT (dark)** | total identity + idempotent re-projection (update-not-duplicate) |
| 4 — Timeline | **BUILT (dark)** | `intelligence_event_timeline` (first_seen/corroborated/exploit/patch/severity/status) |
| 5 — Executive summaries | **BUILT (dark)** | `buildEventSummary` (normalized, cited, display-safe) on every event + `enhanceEventSummaryLLM` overlay |
| 6 — Content quality | **BUILT (dark)** | `contentQuality.ts` — never a broken sentence; replaces slice(0,497)+"…" |
| 7 — Findings from events (dedup) | **BUILT (dark)** | `20260823` dedup index + `eventFinding`/`eventFindingStore` (one finding per org+event); fired by lifecycle workflow |
| 8 — Downstream integration | **BUILT (dark)** | enriched detail API (lifecycle/timeline/sources/confidence/citations/findings/assets/actions); consumers below |
| 9 — Notifications | **BUILT (dark)** | reliability + policy `decideNotification` + dedup ledger `20260824`; fired by lifecycle workflow |

## Authoritative-model consumer migrations (every downstream reads events when flag ON)

| Consumer | Status | Where |
|---|---|---|
| Intelligence Brief (item 1) | **BUILT (dark)** | `eventBriefSource.fetchBriefEventRows` → `generateBrief`; flag OFF = legacy cyber_signals query |
| Executive dashboards (item 2) | **BUILT (dark)** | `getExecutiveEventSummary` + `GET /api/intelligence/executive-summary` |
| Knowledge Graph / graph ask (item 3) | **BUILT (dark)** | `eventGraphContext` → `answerGraphQuestion` events evidence in `/api/graph/ask` |
| Findings (item 4) | **BUILT (dark)** | `reconcileEventFindingForOrg` — one per org+event, update-not-duplicate |
| Notifications (item 5) | **BUILT (dark)** | `evaluateAndClaimNotification` — policy + dedup ledger |
| Predictive Intelligence (item 6) | **BUILT (dark)** | `eventHistorySeries` (timeline counts, not signal spikes) + `GET /api/intelligence/forecast` |
| Workflow Automation (item 7) | **BUILT (dark)** | `processEventLifecycleTriggers` — once per event lifecycle transition, fans out findings + notifications |
| APIs/UI (item 8) | **BUILT (dark)** | `GET /api/intelligence/events[/:id]` + executive-summary + forecast |

## Slice ledger

| Slice | Status | Commit | Notes |
|---|---|---|---|
| Slice 0 — brief delivery reliability | **DONE** | `e9f1691a` | idempotent send, from-email fix, missed-week catch-up (dark), delivery-health alerting; 20 tests |
| IE.P0 — design memo + flag + tracker | **DONE** | `4bb277fb` | memo IE-AD-1..9; flag ×4; this tracker |
| IE.P1 — identity core | **DONE** | `4bb277fb` | `eventCanonicalKey` total promotion of clusterKey |
| IE.P2 — content-quality core | **DONE** | `4bb277fb` | `assessContent` / `trimToSentence` |
| IE.P3 — schema + projection core | **DONE** | `4bb277fb` | 3 global tables (`20260822`) + `planEventUpsert`; dataClassification registered |
| IE.P4 — store + projection wiring | **DONE** | `814454e1` | store + batch entrypoint + hourly worker wiring + script + isolation test |
| IE.P5 — executive summaries (deterministic + LLM overlay) | **DONE** | `0a6bf3a9` | `eventExecutiveSummary` + `eventExecutiveSummaryLlm`; wired into projection |
| IE.P6 — findings from events (dedup-by-update) | **DONE** | `fa3eb403` | `20260823` + `eventFinding`/`eventFindingStore` + isolation test |
| IE.P7 — notification policy + dedup ledger | **DONE** | `241023ff` | `eventNotificationPolicy` + `20260824` ledger + `eventNotificationStore` |
| IE.P7 — canonical event read API (item 8) | **DONE** | `1aa9625a` | `intelligenceEventReader` + `routes/intelligenceEvents` |

## Enablement follow-ups (documented, on-enable)

- Wire `enhanceEventSummaryLLM` into a post-projection summary-refresh pass (deterministic
  summary is already live; LLM overlay is opt-in on enablement with an ANTHROPIC key).
- Wire `reconcileOrgEventFindings` + `evaluateAndClaimNotification` into a per-org cadence
  (worker/cron) once projection is validated in staging.
- Swap the brief / executive / graph read paths to consume `intelligenceEventReader`
  (foundation shipped; per-surface swap is incremental and reversible).

## Tests

- Unit (local, mocked/injected): identity, content-quality, projection, store, executive
  summary + LLM overlay, event-finding, notification policy, event-read route, brief
  reliability — signals + route + dataClassification suites green (163); worker suite green.
- Integration (CI isolation lane, real Postgres):
  `test/isolation/intelligenceEventProjection.test.ts` (multi-source collapse, corroboration
  ledger, timeline, idempotency, flag-gated batch), `eventFindingReconcile.test.ts`
  (create→update dedup, org-isolated relevance), `eventNotificationLedger.test.ts`
  (claim-once/suppress-duplicate, org-isolated).

## Follow-ups / notes

- Projection cadence today = hourly (intelligence-worker) + on-demand
  (`npm run intelligence-events:project`). A dedicated interval worker or cron is a
  possible later refinement if sub-hourly freshness is needed for immediate alerts (IE.P7).
- `cluster_key` (soft grouping) and `intelligence_brief_item_provenance` remain the
  prior dark scaffolding; the canonical event layer is their durable successor. Brief
  consumption of events (IE.P7) supersedes the ephemeral brief-time grouping when enabled.
