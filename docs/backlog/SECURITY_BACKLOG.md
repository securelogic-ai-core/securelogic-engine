# Security Backlog

> Tracking summary for the open security remediation work surfaced by the Sprint 3D security review (`SECURITY_REVIEW.md`, merged to `develop` in [#430](https://github.com/securelogic-ai-core/securelogic-engine/pull/430)).
> **Last updated:** 2026-07-26. Priorities here are a record of the agreed triage — do not change them in this doc without re-triaging.
>
> Scope: the three **High** findings (#431–#433), two remediation **epics** (#434–#435), and the accepted-debt findings from the asset-search package pre-commit review (SEC-AS1/AS2, 2026-07-26). This backlog is intentionally kept separate from the [Performance & Reliability Backlog](./PERFORMANCE_RELIABILITY_BACKLOG.md).

## Priority-ordered items

| Rank | Issue | Title | Severity | Priority | Promotion-gate (develop→main) | Effort | Dependencies |
|---|---|---|---|---|---|---|---|
| 1 | [#433](https://github.com/securelogic-ai-core/securelogic-engine/issues/433) | SEC-H3 — Ask/Voice rate limiter collapses to one platform-wide bucket | High | P1 | **No** | Low (~1–2h) | None; unblocks #432 |
| 2 | [#434](https://github.com/securelogic-ai-core/securelogic-engine/issues/434) | SEC-E1 — Tenant scoping hardening (epic) | Medium | P1 | **No** | S–M (~1–2d) | None (complementary to A04-G1 RLS flip) |
| 3 | [#435](https://github.com/securelogic-ai-core/securelogic-engine/issues/435) | SEC-E4 — Billing & webhook integrity hardening (epic) | Medium | P1–P2 | **No** | S (~0.5d) | None; validate alongside Part-B Gate 4 |
| 4 | [#432](https://github.com/securelogic-ai-core/securelogic-engine/issues/432) | SEC-H2 — HTTP rate limiters in-memory / per-replica | High | P2 | **No** | M (~1–2d) | Redis (already wired); soft dep on #433 keying |
| 5 | [#431](https://github.com/securelogic-ai-core/securelogic-engine/issues/431) | SEC-H1 — SSO session JWT transmitted in URL | High | P2 (deferred) | **No** — *must-fix-before-SSO-GA* | M–H (~2–4d) | Design decision (form_post vs one-time code); shares JWT-revocation store with finding M8 |

## Notes

- **Priority ≠ severity for #431:** it is the most severe finding by impact (credential leakage) but the lowest launch-urgency because SSO is **out of initial launch scope** — its exposure is contingent on SSO going live. It is classified **must-fix-before-SSO-GA**, and re-escalates to promotion-relevant only if SSO GA is pulled into the launch (see the reclassification recorded on the issue).
- **Epics group the Medium/Low findings from the review:** #434 (SEC-E1) covers M2, M3, M4, L6, L7, L8; #435 (SEC-E4) covers M7, M9. Findings are referenced by their `SECURITY_REVIEW.md` IDs on each epic (no child issues created yet).
- **Not yet ticketed:** the entitlement rank-collapse finding (M1 / R4) is intended as a **standalone** issue, product-gated (needs a Platform-only capability before it becomes must-fix); it is tracked as R4 debt in `TENANT_ISOLATION_STANDARD.md`, not opened here.
- **Recommended implementation order:** #433 → #434 → #435 → #432 → #431 (override: #431 first if SSO GA joins the launch).
- **Promotion gating:** **none of #431–#435 blocks the develop→main promotion.** The actual promotion blockers remain the Part-B operator Gates 1–5 (Stripe billing config/validation + migration F-1 + seat-cap pre-flight), tracked in `docs/launch/OPERATOR_RUNBOOK.md`.

## Asset-search package — accepted debt (pre-commit review, 2026-07-26)

Findings from the security pass on the shared asset-search package (`asset_search_index_v` + `assetSearchResolver.ts` + five consuming routes). Labeled **F-1/F-2** in the review conversation; recorded here as **SEC-AS1/AS2** — *not* to be confused with migration gate **F-1** in `RELEASE_CHECKLIST.md`, which is unrelated. Both were triaged **accept as technical debt** (neither was a commit blocker; no live leak, no auth gap, no injection). No GitHub issues opened yet.

| ID | Review label | Title | Severity | Disposition | Rides on |
|---|---|---|---|---|---|
| SEC-AS1 | F-1 | `asset_search_index_v` tenant isolation rests on a single control (caller org predicate); `vendors`/`ai_systems` arms have no RLS backstop and `security_invoker` is PG ≥ 15 only | Medium (defense-in-depth) | Accept as debt | A04-G1 RLS rollout (add `vendors`/`ai_systems` RLS there) |
| SEC-AS2 | F-2 | Search cost amplification: 2-char minimum, leading-wildcard ILIKE over the unindexed multi-arm view, behind non-durable rate limiting | Medium (availability/cost) | Accept as debt, **trigger-gated** | SEC-H2 [#432](https://github.com/securelogic-ai-core/securelogic-engine/issues/432) (Redis-backed limiters) |

- **SEC-AS1 details:** every current consumer passes a server-derived org id, and `test/isolation/assetSearchIndexView.test.ts` covers cross-org exclusion + RLS-through-the-view for `app_request`. Residual risk is a *future* consumer omitting the predicate. Remediation: (a) `vendors`/`ai_systems` RLS lands with A04-G1 (no new scope); (b) optional XS guard test asserting the view is referenced only from `assetSearchResolver.ts` and the one audited EXISTS in `signalMatchSuggestions.ts`.
- **SEC-AS2 details:** leading-wildcard `ILIKE` cannot use btree and no `pg_trgm` indexes exist; `LIMIT` bounds rows, not scan work. Org-predicate pushdown onto indexed `organization_id` scans keeps this cheap at current volumes. **Growth triggers (act when either fires):** any tenant exceeding ~50k rows across the seven asset tables, **or** p95 search latency > 200 ms on staging. Then: one additive migration adding `pg_trgm` GIN indexes on the hot term columns (`vendors.name`, `ai_systems.name`, `enterprise_entities.name`, `endpoints.hostname`, `cloud_resources.account_id`, the `external_ref` columns). Independently, when #432 lands, the five `?q=` routes (assets, vendors, ai-systems, enterprise-entities, signal-match-suggestions) must be inside the durable limiter's scope.
- **F-3 (not backlogged):** the correlated-EXISTS plan-shape question in `listSignalMatchSuggestions` is a **post-merge staging validation action** (EXPLAIN ANALYZE against the walkthrough org; rewrite to the pre-resolved id-set pattern only if the per-row SubPlan signature appears). It is an action item of the package's staging pass, not standing debt — deliberately not tracked here.

## Source of record
- Full findings, evidence (`file:line`), false positives, and OWASP mapping: [`SECURITY_REVIEW.md`](../../SECURITY_REVIEW.md).
- SEC-AS1/AS2 evidence and the full 10-point expansion (including the F-3 EXPLAIN expectations): the 2026-07-26 pre-commit review of the asset-search package (conversation record; key anchors — `db/migrations/20260908_asset_search_index_view.sql:32-38,125-137`, `src/api/lib/assetSearchResolver.ts:35,50-52,119-140`, `src/api/routes/signalMatchSuggestions.ts:433-446`).
