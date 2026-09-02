# D2–D14 evidence-validity policy — staging gate record

**Date:** 2026-09-02
**Package:** owner ratification of D2 through D14, implemented as migration `20261085`
**Authority:** owner ruling 2026-09-02 (amendments to the recommendations put in the decision record)
**Result:** **31 PASS / 0 FAIL** on staging, through product routes
**Production:** untouched, and measured rather than assumed

---

## 1. Exact state proven

| Fact | Value |
|---|---|
| Merged head on `develop` | `ec28d5a8` (PR #977, merge of `a34e63d7`) |
| Staging engine live SHA | `ec28d5a8`, status `live`, finished 2026-09-02T02:28:33Z |
| Staging service | `srv-d7n0rju8bjmc738jbs7g`, branch `develop`, autoDeploy on |
| Migration applied | `20261085_evidence_validity_policy_d2_d14.sql`, recorded in `schema_migrations` (281 total) |
| Live policy rows | 13 |
| New policy columns present | `artifact_basis_permitted`, `bridge_required_above_months`, `no_window_reason`, `requires_artifact_end` |
| Anchor CHECK on staging | `report_period_end`, `collected_at`, `artifact_stated_date`, `object_cadence`, `none` |
| Flag | `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` = `true`, staging engine ONLY |
| Acceptance job | `job-dabokg0jo6nc738dtfrg` (31/0). First run `job-dabojvm7bikc73dpk15g` was 30/1 |

The first run's single failure was a **harness** defect, not a product defect: it
read `version` where the coverage route emits `coverage_version`
(`vendorEngagements.ts:2548`). The corrected harness was injected into the
running service rather than committed first, so the proof stays pinned to
`ec28d5a8` and the deployed SHA never moved to accommodate its own test.

## 2. What the 31 checks prove, through product routes

**The ratified policy is what is live** (checks 2–7). Exactly thirteen classes,
`contract` and `other_assurance_report` carrying no row as D13 and D14 require,
the SOC rows superseded rather than edited, D2's bridge condition stored with
the 15-month ceiling intact, D3's required certificate end set, and D12's
no-window row naming model-version identity as the reason.

**D9 — a caller cannot manufacture freshness** (8–10). A curation request
claiming an export was observed today, against a row collected on 2026-07-01,
produced a window from July. Evidence with no observation date established
nothing. A scan from 2025-01-01 expired on its own dates.

**D10 — the ceiling outranks the customer** (12–14). A six-month engagement
cadence bound at six months. A **120-month** cadence produced 2028-01-01, the
24-month ceiling, not 2036. An attestation with no engagement established
nothing.

**D7 — the linked object governs** (15–17). A policy document followed its
policy object's next review date; a cadence beyond 24 months was capped; an
unlinked document established nothing.

**Cross-tenant** (19–20). Evidence in org A pointing at another org's policy id
resolved to `no_linked_object_cadence` with a null window, never that org's
cadence. Curating another org's evidence returned 404.

**D13 / D14 — the human-committed basis** (21–24). A contract took the term the
artifact states. `perpetual` was **refused** without an explicit assertion and
accepted with one. A residual assurance artifact with no term established
nothing.

**D11 — no route around a governed window** (25). An attempt to commit
`perpetual` on a `privacy_agreement` was refused `artifact_basis_not_permitted`.

**D3 / D4 — the certificate is absolute** (26–28). No recorded expiry
established nothing; annual re-evidence bound inside a three-year term; an
expiry inside the cadence capped the window.

**D15 — tighten freely, loosen to the ceiling** (30–31). Tightening to 9 months
succeeded. Loosening to 16 was refused with the ceiling named.

**S4 regression** (32). The coverage surface answers `assurance-coverage-1.1`.

## 3. Production untouched — measured

| Service | Branch | Live SHA | Deploy finished | Flag |
|---|---|---|---|---|
| Production engine `srv-d5vmr37fte5s73cspe1g` | `main` | `b916622d` | 2026-08-28T21:02:23Z | **absent** |
| Demo engine `srv-d7kit9qqqhas73bm8040` | `main` | `b916622d` | 2026-09-01T21:40:52Z | **absent** |

The production deploy predates this entire package and did not move. Stronger
than a claim about the production estate being empty: **`origin/main` contains
zero `2026108x` migrations**, so production's database cannot hold the evidence
lifecycle substrate at all, let alone `20261085`. Verified before the merge and
again after it.

## 4. What this package does NOT deliver

The S4 counting predicate classifies only SOC reports, so **no newly ratified
class reaches questionnaire reduction**. This makes ratified policy real for the
curation path and the Step-2 lifecycle predicate. Extending the counting
predicate beyond SOC is separate, unauthorized work.

Three limitations are unchanged and now sit against ratified policy rather than
against a proposal: bridge letters have no artifact type, so D2's condition is
unsatisfiable today; surveillance-audit status is unobservable, which is why D4
uses annual re-evidence as the proxy; and model-version identity does not exist,
which is why D12 fails closed instead of substituting time.

## 5. Open item for the owner

One interpretive call, recorded in
`docs/design/VA-EVIDENCE-validity-policy-RATIFICATION-MEMO.md`: whether
`privacy_agreement` may carry a `perpetual` basis. Seeded FALSE on the
fail-closed reading of D11 plus global principles 4 and 6. Reversing it is a
single policy row value in a version-2 row.

## 6. Rollback

`db/rollback/20261085_evidence_validity_d2_d14_rollback.sql`. It refuses to run
while any organization holds a live setting for a class this migration
introduced, because dropping the platform ceiling out from under a live customer
setting would leave a configured duration with no policy to bound it.
