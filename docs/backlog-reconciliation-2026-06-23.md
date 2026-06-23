# Backlog Reconciliation — "match → surface → what to do next" + launch items

Reconciles the 16-item backlog against the **actual** codebase state (2026-06-23).
Several items were written when they were unbuilt; substantial work has landed
since. Each item below has an accurate disposition: **shipped**, **already-built
(stale premise)**, **correctly-not-built (blocked/conditional/cosmetic)**, or
**careful epic (genuine remaining work)**.

## Shipped this session (built → tested → promoted to prod)

| # | Item | Evidence |
|---|------|----------|
| 1 | **GAP-3 action engine** — all 4 generators | finding→action #276, risk→action #285, obligation→action #288, failed-assessment→action #291. Flag-gated `SECURELOGIC_ACTION_ENGINE_ENABLED`; idempotent partial indices. |
| 2 | **GAP-1 LLM control matcher** | `llmControlMatcher.ts` #294 — sonnet, suggest-only `target_type='control'`, cost-gated, after-commit, dormant `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED`. |
| 3 | **Fuzzy Phase 2.x** | token-distinctiveness weighting #277; recovers Sensata/Cisco tail. |
| 4 | **Federal Register adapter** | `federalRegisterAdapter.ts` #280 — live, reuses obligation branch, document-number dedup. |
| 5 | **Feed-health monitoring** | `feed_health` table + `feedHealth.ts` #281 — per-source success/failure + rising-edge `feed_source_down` alert; all 9 scheduler sources instrumented. |

## Already built — premise was stale (no change made; verified, not assumed)

| # | Item | Finding |
|---|------|---------|
| 8+9 | **Entitlement alignment + caps** | Core-platform routes uniformly `premium`-gated (Bucket A, 72-assertion test). `posture/topRisks/dashboard` are *deliberately* Bucket-B Brief-surface — re-gating would break paying Brief-Pro/Team. Caps enforced: `enforceEntityLimit` (50→409) + `teamInvites` seat (10→409). PR #244 closed/superseded. See `docs/entitlement-alignment-audit.md`. |
| 14 | **Advisory signal-type producer** | `signal_type 'advisory'` HAS a live producer — System-B `runPipeline` (AI_GOVERNANCE + GENERAL/default catch-all), fed by live RSS (venturebeat AI, technologyreview). Consumed in domain routing + brief category. No wiring bug. |
| 11 | **GDPR export #2b (bundle/zip orchestration)** | BUILT + DEPLOYED. `src/api/services/dataExport/` (9 test files, 71 tests): `runExport` streams NDJSON→zip via `archiver`, manifest-last, attachments, fail-closed (`AttachmentNotFoundError`). **Caller exists**: `data-rights-worker` claims `data_export_self`/`data_export_org` jobs → `runExport` → streams to R2. Deployed (render.yaml prod+staging). |

## Correctly NOT built — blocked, conditional, or cosmetic-deferred

| # | Item | Why not built |
|---|------|---------------|
| 6 | **HHS OCR adapter** | Documented guidance is "build ONLY when a specific healthcare customer needs it" (heavy/fragile JSF scraper). Building speculatively contradicts the scope; deferred by design. |
| 7 | **Healthcare sources (FTC/CMS/ONC)** | Guidance: "FTC + Federal Register now, CMS/ONC later." FTC is covered (`ftc_news` registry feed + the new Federal Register adapter, which indexes FTC rules). CMS/ONC explicitly deferred. The "now" is satisfied. |
| 10 | **Brief→Platform credit mechanic** | BLOCKED: "pricing locked it as TBD." The credit rule itself is undefined — billing logic can't be built for an unspecified rule. Needs the pricing decision first. |
| 12 | **GDPR export #3–8** | Follow-ons behind #2b (email delivery, deletion reaper, purge) tracked in the launch-readiness workstream — separate from the #2b orchestration (which is done). |
| 15 | **external_id manual-route column-write** | Cosmetic (dedup_hash already correct everywhere; cron path already persists external_id). The 8 non-uniform INSERT blocks make a hand-edit risk a runtime column/param mismatch; correct fix is a shared-INSERT-helper refactor, scoped separately. |
| 16 | **Orphan-row cleanup** | Destructive cosmetic (the dedup PR explicitly deferred it as optional). A guarded one-time DELETE; low value, not worth prod-data risk without need. |

## Careful epic — genuine remaining work, not turn-tail-safe

| # | Item | Why it needs dedicated, sequenced work |
|---|------|----------------------------------------|
| 13 | **RLS Batch B/C/D/E** | NOT a mechanical "add policies" task. The A.1 migration header itself documents that `vendors/controls/assessments/actions/policies/evidence/reports` are **gated**: each needs its CRUD route family `asTenant()`-wrapped **first**, or the DATABASE_URL flip causes **post-flip silent zero-rows** (customer data invisible, no error). The route-wrap has documented per-route hazard axes (fire-and-forget, concurrent-query, streaming-guard, post-commit-ambient). `users` needs its own pre-context-auth design pass. This is deliberate, operator-coordinated, hazard-laden work — to be done carefully against `docs/A04-G1-rls-rollout-plan.md`, batch by batch, with the SET-ROLE isolation harness proving each before the flip. |

## Net

The high-value "match → surface → what to do next" promise (GAP-1, GAP-3, fuzzy)
is **built end-to-end and in prod** (dormant behind flags pending enablement
review). Of the rest: 3 were already built (stale premises), 6 are correctly
deferred/blocked/cosmetic, and the RLS epic remains as careful, sequenced work.
