# A04-G1 RLS phase-1 — core-entity critical path & the commit-then-X blocker (2026-06-24)

## Context
Goal item 13 = finish A04-G1 RLS phase 1. After the signal-link batch (13 tables,
promoted to main `82554d71`) and `ai_system_vendor_dependencies` (#324), ~57 tables
remain `pending`. This doc records *why the bulk can't be enabled yet* and the exact
critical path, so the work is sequenced correctly rather than rushed into a
flip-time production break.

## The invariant
RLS is enabled per-table by `ENABLE ROW LEVEL SECURITY` + a policy on
`NULLIF(current_setting('app.current_org_id', true), '')::uuid`. At the
owner→`app_request` `DATABASE_URL` flip, ANY query against an RLS-enabled table that
runs **without** a tenant scope (no `app.current_org_id` GUC set) returns **0 rows**.
So a table can only be safely enabled once **every reader and writer** of it runs
inside `asTenant`/`withTenant` (or the elevated `pgElevated` channel).

## Why the core entities are blocked
The big entities are read across many shared **reporting aggregator** routes
(measured reader spread): `controls` 23 route files, `assessments` 20, `vendors` 18,
`obligations` 15, `ai_systems` 12, `actions` 9, `control_assessments` 9,
`governance_reviews` 7. Until every one of those readers is tenant-safe, none of these
entities can be enabled.

## Aggregator inventory (measured 2026-06-24)
| Route | Status | Notes |
|-------|--------|-------|
| `dashboard.ts` | ✅ wrapped | single handler `asTenant`-wrapped (pre-existing); 15 sequential reads |
| `posture.ts` | ✅ mostly wrapped | 7 wrapped handlers (pre-existing) |
| `evidence.ts` | ✅ wrapped #325 | fixed latent flip-bug (read findings/vendor_assessments unscoped) |
| `intelligence.ts` | ✅ wrapped #326 | serialized 6-way Promise.all; fixed latent flip-bug (risks/findings/posture_snapshots) |
| `ask.ts` | ⛔ commit-then-compute | makes a multi-second LLM call mid-handler; `asTenant` would hold the DB tx open across the LLM round-trip (idle-in-transaction). Must fetch context under `withTenant`, commit, THEN call the LLM + respond. |
| `auditPackage.ts` | ⛔ commit-then-stream | streams `application/pdf` (`setHeader`+`attachment`). β1.5 buffering proxy throws on streaming. |
| `gapReport.ts` | ⛔ commit-then-stream | streams PDF; also has 2 `Promise.all` to serialize. |
| `executiveReport.ts` | ⛔ commit-then-stream | streams PDF; 1 `Promise.all`. |

## The blocker: `asTenant` can't wrap streaming or long-external-I/O handlers
`asTenant` (PR β1.5) buffers a single `status()`+`json()` and flushes it AFTER COMMIT.
It deliberately throws if the handler streams (`setHeader`/`send`/`write`/`pipe`) — see
`feedback_route_wrap_streaming_guard`. It also keeps the request transaction open for
the whole handler, which is wrong for a handler that then blocks on a slow external
call (LLM, S3). The 4 routes above hit exactly these cases.

## Required pattern — "commit-then-X" (NOT yet built)
Refactor each blocked handler into two phases:
1. **Fetch phase** — run ALL DB reads inside `withTenant(orgId, ...)`, materialize the
   results into plain in-memory objects, let `withTenant` COMMIT and release the client.
2. **Emit phase** — OUTSIDE any tenant scope, render the PDF / call the LLM using the
   already-materialized data, then stream / `res.json`.
This keeps every DB read tenant-scoped (RLS-correct post-flip) without holding a tx open
across streaming or external I/O. It is the same hazard flagged for `findingsExport.ts`.

## Critical path to finish item 13
1. Build the commit-then-X refactor for the 4 blocked routes (each its own verified PR).
2. Audit/wrap any remaining isolated-table readers.
3. THEN enable RLS on the core entities family-by-family (`controls`, `obligations`,
   `vendors`, `ai_systems`, `assessments`, `actions`, the assessment children), each with
   its full reader+writer set confirmed tenant-safe + a cross-org isolation cert.
4. One coherent develop→main promote when phase 1 is complete.

This is genuinely multi-session and gated on step 1 (an architectural refactor), not a
sequence of mechanical per-table mirrors. Rushing step 3 ahead of step 1 would empty
out executive reports / dashboards at the flip — the exact failure this batch prevents.
