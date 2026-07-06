# Enterprise Risk Intelligence Platform (ERIP) — Program Tracker

Living tracker for the ERIP program (governing roadmap:
`docs/architecture/enterprise-risk-intelligence-platform.md`). Successor program to the
completed Enterprise Asset Registry goal (`enterprise-asset-registry-tracker.md` — preserved
as the Epic-1 historical record; do not edit it). Same governing invariants: everything DARK
behind flags (default off), additive-only migrations, backward compatibility, branch off
`origin/develop` → PR → CI 8/8 → squash-merge + delete branch, tenant scoping + inert RLS +
`dataClassification` on every new table, operator actions ledgered never executed, **no
production enablement (GATE B)**.

Last updated: 2026-07-06 (program established).

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
| 2 — Enterprise Discovery & Connectors | E2.P0–P6 (memo → sync state/scheduling → incremental+reconciliation+drift → conflict/confidence → owner/metadata → adapters wave 1 (AWS/Azure/GCP) → wave 2 (MS Graph/Google Workspace/GitHub/Jamf/Okta-generalized)) | PENDING — memo first | — |
| 3 — Enterprise Risk Intelligence | E3.P0–P4 (memo → continuous correlation → graph risk propagation → business impact → dimensional reporting) | PENDING | — |
| 4 — Executive Intelligence | E4.P0–P3 (memo → reporting API → surfaces → board reports) | PENDING | — |
| 5 — Predictive Intelligence | E5.P0–P3 (memo → pure engine → persistence/API → recommendations) | PENDING | — |
| 6 — Autonomous Operations | E6.P0–P3 (memo → orchestration core → internal executors → ServiceNow/Jira) | PENDING | — |
| 7 — Knowledge Graph / Digital Twin | E7.P0–P3 (memo → graph completeness → analysis surfaces → NL answering) | PENDING | — |
| Close — final report, staging validation guide, prod enablement checklist, rollback plan | after Epics 2–7 | PENDING | — |

## Phase/PR ledger

| Item | Status | PR / squash | Notes |
|---|---|---|---|
| Program establishment (this roadmap + tracker + BUILD_SEQUENCE amendment) | IN PR | — | docs-only |

## Deferred / follow-up register

Carried from Epic 1 (rulings recorded in the EAR tracker; not blockers):
- Legacy assessment route-tx collapse, one stack per PR (EAR-AD-7 step 2).
- vendorAssessments/dependencyAssessments gate normalization (P9-cutover scope).
- Brief citations for corroborating provenance signals.
