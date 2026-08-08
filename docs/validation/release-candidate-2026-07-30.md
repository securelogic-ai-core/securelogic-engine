# Release Candidate Delta Report — Private Beta

**Date:** 2026-07-30 09:31 UTC
**Release candidate:** develop @ `b57d1a92` (`b57d1a9292041e4e099cc3b60e6f82490f7f7b76`)
**Scope of this record:** the completed release train (#726–#735) plus the operator-authorized post-train integration (#710, #711). This document itself lands as a docs-only commit on top of the RC; the promotion delta beyond `b57d1a92` is documentation only and does not invalidate any validation below.

## 1. Merge summary

**Release train (nine PRs, merged 2026-07-30, per-merge validation at each checkpoint):**

| PR | Squash | Content |
|---|---|---|
| #726 | `15654384` | Per-object history on vendors/controls/obligations/AI systems (shared resourceHistory lib) |
| #727 | `4e0546a8` | Audit-log resource drill-down (list + CSV export filters) |
| #729 | `6c0ebfb4` | Audit-log actor filter |
| #728 | `da38fe3b` | AI governance assessments join the audit trail |
| #730 | `0ebd9769` | Risks history migrated to the shared resourceHistory lib |
| #731 | `2d4171a1` | Per-finding activity history (sixth register on the shared trail) |
| #732 | `616a5396` | Stale-session enforcement — removal/role changes effective immediately on all login surfaces |
| #733 | `d81a945d` | Export-file purge worker (O-11 7-day bundle lifetime enforced) |
| #734 | `6de181f8` | Webhook payload/envelope documentation on the settings page |

**Release-readiness package:** #735 `b93bc098` — DR/BC plan (`docs/DR_PLAN.md`), production-readiness checklist, private-beta go-live checklist, staging smoke record.

**Post-train integration (operator-authorized separately, 2026-07-30):**

| PR | Squash | Content |
|---|---|---|
| #710 | `a8eb9048` | SSO one-time code exchange — **dark** behind `SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED`; additive migration `20260912_sso_login_codes` (RLS from creation). Integration commit `6e9bf02a` closed the #732 coordination item: the exchange consume-time lookup now gates on the canonical `SESSION_BLOCKED_STATUSES` set. |
| #711 | `bad1c8dc` | Federated global search over the seven canonical objects — **live on deploy** (read-only, no flag). |

Readiness-doc record: `b57d1a92` (go-live + production-readiness checklists updated; docs-only).

## 2. Final CI results (develop)

- `a8eb9048` (develop + #710), full run: **all 8 lanes — 7 green** (test, typecheck, lint, build, url-drift, tenant-coverage, cross-org-isolation), `audit` red.
- `b57d1a92` (final tip), full run: **all required lanes green** incl. cross-org-isolation; `audit` red.
- `audit` lane: pre-existing red on every develop commit — 19 high-severity npm advisories requiring breaking majors (eslint@10, archiver@8, exceljs). Documented operator decision, not introduced by this cycle, not silent.
- Both restacked PR heads also ran fully green on required lanes pre-merge.

## 3. Local validation results

**Post-train develop (`b93bc098` era):** engine 405/6722 · isolation 133/858 · app 93/1200 — all green.

**Post-integration (pre-merge, on the exact tree develop became):**
- Engine: **409 files / 6751 passed** (3 skipped), exit 0
- Isolation (real-SQL, harness Postgres): **134 files / 863 passed**, exit 0
- App: **93 files / 1200 passed**, exit 0
- Post-merge proof: `git diff` between the validated tree and merged develop @ `bad1c8dc` is **empty** — the suite verdict transfers byte-for-byte.
- Suite deltas vs baseline are exactly the new PRs' own suites (+4 engine files = 13 SSO + 16 search tests; +1 isolation file = 5 ssoCodeExchange tests).
- Restack integrity: patch-level content-preservation diffs verified for both PRs; application knowledge index regenerated with zero drift.

## 4. Staging validation summary

Per `docs/validation/staging-smoke-2026-07-30.md`, executed against the deployed train (walkthrough tenant):
- **20/20 PASS, 0 defects**; live mutation → audit → history proof; RBAC negative test passed; enterprise-context flag ON in staging behaving correctly.
- Observations (non-blocking): no-op PATCH writes a `status_changed` event (cosmetic); seeded objects show empty histories until first live mutation (expected); org-creation email loop not smoke-covered (medium coverage note).
- **Obsolete expectation:** that smoke recorded global search returning 404 as *correct* (#711 was unmerged). On any SHA ≥ `bad1c8dc` search is live — the Gate A smoke re-run on the promoted SHA **must add a global-search probe**.

## 5. Enterprise Grade v1 assessment

Release Candidate Audit score 88/100 — **Ready for Private Beta**. Capability classification (post-integration deltas marked ◆):

| Capability | Classification |
|---|---|
| Register experience (6 registers: filter/search/export/history) | Best in Class |
| Audit trail & drill-down (by object and by actor) | Best in Class |
| ◆ Global search | Enterprise Ready — live on deploy |
| ◆ SSO / login-surface security | Enterprise Ready — code exchange merged dark; every login door under `SESSION_BLOCKED_STATUSES` |
| Stale-session enforcement | Enterprise Ready |
| Webhooks (delivery/retry/rotation/catalog/docs) | Enterprise Ready — wave-1 dark |
| Alerting & deep links | Enterprise Ready |
| Evidence & audit packages / data-export lifecycle | Enterprise Ready |
| Continuous monitoring & scheduling | Enterprise Ready |
| Reporting & posture snapshots | Enterprise Ready |
| Commercial (trials/seats/entitlements) | Enterprise Ready |
| Data retention/pruning · session architecture · GDPR erasure automation · comments/bulk-ops/notifications/API-scopes/OpenAPI | Deferred by explicit decision (§7) |

## 6. Remaining Gate A operator tasks (launch gates)

1. DR_PLAN `[OPERATOR-VERIFY]` boxes checked against the Render dashboard (backups, PITR, retention).
2. **First restore test executed and logged** (DR_PLAN §6) — closes E3-G1.
3. Sealed secrets copy exists (DR_PLAN §3).
4. Flag-state review: wave-1 OFF, SSO code exchange OFF, risk-acceptance prod per GATE B, registry flags per rollout plan.
5. Staging smoke re-run green on the exact promoted SHA — **including the new global-search probe** (§4).
6. Promotion develop → main → prod deploy green; `/health` green; Sentry quiet for 24 h soak.

## 7. Known deferred items — intentional, decision-gated, NOT gaps discovered late

- **npm-audit majors** (audit lane red) — operator ruling; breaking upgrades.
- **webhook_deliveries retention window** — ruling pending; fastest-growing table; worker is low-complexity once ruled.
- **Session architecture** (7-day JWT TTL, refresh tokens, sign-out-everywhere) — accepted limitation; post-launch workstream; schema decision required.
- **Wave-1 webhook enablement, SSO code-exchange enablement** — merged dark by design; enablement is a separate operator decision per flag discipline.
- **GDPR erasure automation** — D-12 WORM/FK architectural defect; manual process documented; operator ruling territory.
- **Out of beta scope per go-live doc:** comments on records, register bulk operations, in-app notification center, API key scopes, customer IP allowlisting, self-serve SSO configuration, public OpenAPI reference, multi-org/BU hierarchies.
- **Standing ADR/policy rulings:** ADR-0004/0005/0006 reconciliation, AD-13 link-store shape, vendor review-cadence model.

## 8. Promotion recommendation

**Promote the develop tip containing this record (docs-only delta over `b57d1a92`) to `main` once the Gate A tasks in §6 are complete.**

Basis: every code change on the candidate is validated by (a) full local three-suite runs on the exact merged tree with unmasked exit codes, (b) byte-identity proof between the validated tree and develop, (c) full CI green on required lanes at both merged tips, and (d) staging smoke on the train plus a defined probe addendum for the one post-train live change. No regressions were found in authentication, search, audit history, permissions/tenancy, or enterprise workflows. No new launch blockers exist; both remaining blockers are the operator-gated Gate A items (DR verification chain and promotion soak).
