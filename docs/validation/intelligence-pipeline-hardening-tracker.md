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
| `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` | `false` | Canonical Intelligence Event projection + downstream reads | 4 ingestion services |

## Goal-item ↔ slice map

| Goal item | Status | Where |
|---|---|---|
| 1 — Canonical Intelligence Events | **BUILT (dark)** | `intelligence_events` + `eventCanonicalKey` + `planEventUpsert` + store |
| 2 — Source corroboration | **BUILT (dark)** | `intelligence_event_sources` ledger (attribution/revisions preserved) |
| 3 — Deduplication / update-detection | **BUILT (dark)** | total identity + idempotent re-projection (update-not-duplicate) |
| 4 — Timeline | **BUILT (dark)** | `intelligence_event_timeline` (first_seen/corroborated/exploit/patch/severity/status) |
| 5 — Executive summaries | **BASELINE BUILT** · LLM enhancement = IE.P5 | `contentQuality` display-safe summary on the event; LLM narrative pending |
| 6 — Content quality | **BUILT (dark)** | `contentQuality.ts` — never a broken sentence; replaces slice(0,497)+"…" |
| 7 — Findings from events (dedup) | **PENDING (IE.P6)** | — |
| 8 — Downstream integration | **PENDING (IE.P7)** | brief/exec/graph read events when flag on |
| 9 — Notifications | **RELIABILITY BUILT** · policy = IE.P7 | idempotent send + catch-up + delivery health; immediate/daily/weekly policy pending |

## Slice ledger

| Slice | Status | Commit | Notes |
|---|---|---|---|
| Slice 0 — brief delivery reliability | **DONE** | `e9f1691a` | idempotent send, from-email fix, missed-week catch-up (dark), delivery-health alerting; 20 tests |
| IE.P0 — design memo + flag + tracker | **DONE** | `4bb277fb` | memo IE-AD-1..9; flag ×4; this tracker |
| IE.P1 — identity core | **DONE** | `4bb277fb` | `eventCanonicalKey` total promotion of clusterKey |
| IE.P2 — content-quality core | **DONE** | `4bb277fb` | `assessContent` / `trimToSentence` |
| IE.P3 — schema + projection core | **DONE** | `4bb277fb` | 3 global tables (`20260822`) + `planEventUpsert`; dataClassification registered |
| IE.P4 — store + projection wiring | **DONE** | `814454e1` | store + batch entrypoint + hourly worker wiring + script + isolation test |
| IE.P5 — LLM-enhanced executive summaries | **PENDING** | — | reuse `llmService`, deterministic fallback, citations preserved |
| IE.P6 — findings from events (dedup-by-update) | **PENDING** | — | event→finding, update not duplicate |
| IE.P7 — downstream reads + notification policy | **PENDING** | — | brief/exec read events; immediate-critical + daily digest + weekly separate; notification ledger |

## Tests

- Unit (local, mocked/injected): identity (13), content-quality (13), projection (7),
  store (4), brief reliability (20) — all green. Full signals + worker suites green (153).
- Integration (CI isolation lane, real Postgres): `test/isolation/intelligenceEventProjection.test.ts`
  — multi-source collapse, corroboration ledger, timeline, idempotency, flag-gated batch.

## Follow-ups / notes

- Projection cadence today = hourly (intelligence-worker) + on-demand
  (`npm run intelligence-events:project`). A dedicated interval worker or cron is a
  possible later refinement if sub-hourly freshness is needed for immediate alerts (IE.P7).
- `cluster_key` (soft grouping) and `intelligence_brief_item_provenance` remain the
  prior dark scaffolding; the canonical event layer is their durable successor. Brief
  consumption of events (IE.P7) supersedes the ephemeral brief-time grouping when enabled.
