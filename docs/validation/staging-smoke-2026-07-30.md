# Staging Smoke — 2026-07-30 (post merge-train #726–#734)

**Build under test:** develop `6de181f8` (#734), auto-deployed to staging (verified: post-merge routes live — history endpoints answer 401 not 404 unauthenticated).
**Tenant:** `[SEED] Walkthrough Org` (canonical staging validation tenant; two real logins — the accepted-risk separation-of-duties design requires proposer ≠ approver).
**Method:** authenticated API-level checks against `securelogic-engine-staging.onrender.com`, both roles, plus one live end-to-end mutation proof. Re-runnable; keep this as the promotion smoke template.

## Results — 20/20 workflow checks PASS, 0 defects

| Axis | Check | Result |
|---|---|---|
| Health/deploy | /health db-connected; new-build routes present | ✅ |
| Authentication | Both seeded users login (password) | ✅ |
| User management | team/members: 2 members, seats 2/6 | ✅ |
| Vendor lifecycle | list (2 vendors) + per-vendor history endpoint | ✅ |
| Asset lifecycle | enterprise-entities list (flag ON in staging) | ✅ |
| Assessments | control-assessments list | ✅ |
| Findings | list + per-finding history | ✅ |
| Risks | list + q search (register search contract) | ✅ |
| Audit history | audit log (216 events) + **new resource filter** (31 finding events) + CSV export | ✅ |
| Exports | risks + vendors + audit-log CSV all download | ✅ |
| Intelligence | cyber-signals list returns live signals | ✅ |
| Reporting | dashboard/summary | ✅ |
| Permissions | member role → audit log = 403 (admin gate holds) | ✅ |
| Feature flags | webhook event catalog serves 7 types; EC flag ON staging; global search 404 (correct — #711 unmerged) | ✅ |
| **End-to-end trail** | live PATCH on a finding → `finding.status_changed` with actor email appears in per-finding history; invalid status properly 400-rejected | ✅ |

## Observations (classified)

| # | Observation | Class |
|---|---|---|
| 1 | No-op status PATCH (open→open) returns 200 and writes a `finding.status_changed` audit event with unchanged values | **Cosmetic** — trail noise, not a correctness issue |
| 2 | Seeded objects show empty histories until first live mutation (seed writes rows via SQL, not the API) | **Cosmetic / expected** — seed-script characteristic, not product |
| 3 | Org-creation loop not exercised end-to-end (signup requires email verification; no inbox in harness) — signup API validation responses verified only | **Medium (coverage gap in smoke, not product)** — cover at first Gate-B onboarding |

**Launch blockers found: 0. High: 0.**
