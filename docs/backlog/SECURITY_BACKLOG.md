# Security Backlog

> Tracking summary for the open security remediation work surfaced by the Sprint 3D security review (`SECURITY_REVIEW.md`, merged to `develop` in [#430](https://github.com/securelogic-ai-core/securelogic-engine/pull/430)).
> **Last updated:** 2026-07-01. Priorities here are a record of the agreed triage — do not change them in this doc without re-triaging.
>
> Scope: the three **High** findings (#431–#433) and two remediation **epics** (#434–#435). This backlog is intentionally kept separate from the [Performance & Reliability Backlog](./PERFORMANCE_RELIABILITY_BACKLOG.md).

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

## Source of record
- Full findings, evidence (`file:line`), false positives, and OWASP mapping: [`SECURITY_REVIEW.md`](../../SECURITY_REVIEW.md).
