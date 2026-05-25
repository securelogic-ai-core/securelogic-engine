# E1-G1 cross-org isolation harness — first run

**Date:** 2026-05-21
**Branch:** `fix/sec-e1-g1-isolation-harness`
**Run:** local, throwaway Postgres (`scripts/harness-db-up.sh`, port 55432)
**Result:** RED — 78 tests, 67 passed, 11 failed.

This is the first cross-org isolation harness run (E1-G1 step 6). Per the
operator-set hard rule, every non-404 cross-org probe is recorded here as a
candidate finding for joint triage. No remediation has been attempted; the
harness PR has not been opened; E1-G1 has not been closed.

## Summary tally

- 13 v1 routes exercised.
- **7 fully green** — both positive controls pass, every cross-org probe 404:
  vendors, risks, controls, obligations, aiSystems, policies, vendorAssessments.
- **1 not tested** — findings: resource create failed (broken seed, see below).
- **5 flagged** — cross-org PATCH probe returned 400, not 404:
  vendorReviews, riskTreatments, controlAssessments, obligationAssessments,
  aiGovernanceAssessments.
- 46 cross-org probes recorded: 36 returned 404 (pass), 10 returned 400.
- **No probe returned 2xx.** No cross-org read or write succeeded — no data
  was mutated or disclosed across the org boundary in any probe.

## Finding 1 — findings resource: create failed (broken seed, NOT a leak)

`POST /api/findings` returned HTTP 500 (`finding_create_failed`) for both orgs.
Root cause from the app log:

```
DatabaseError: column "due_date" of relation "findings" does not exist
  at src/api/routes/findings.ts:121  (SQL state 42703)
```

The `findings` INSERT in the route references a `due_date` column that does
not exist on the `findings` table after a from-scratch apply of all 93
migrations. Because create failed, `findings` was NOT probed for cross-org
isolation — its positive-control and probe tests passed only vacuously
(early-return on missing id).

This is a seed/schema failure, not an isolation defect. It is orthogonal to
E1-G1 but needs its own investigation: either `findings.ts` inserts a column
no migration creates (route/schema drift), or a migration that adds
`findings.due_date` is missing from `db/migrations/`. Production may differ
from the migration set — to be confirmed during triage.

## Finding 2 — cross-org PATCH returns 400 (not 404) on 5 routes

| Route | Probe | Direction | Status | Expected |
|---|---|---|---|---|
| vendorReviews | PATCH /api/vendor-reviews/:id | B→A | 400 | 404 |
| vendorReviews | PATCH /api/vendor-reviews/:id | A→B | 400 | 404 |
| riskTreatments | PATCH /api/risk-treatments/:id | B→A | 400 | 404 |
| riskTreatments | PATCH /api/risk-treatments/:id | A→B | 400 | 404 |
| controlAssessments | PATCH /api/control-assessments/:id | B→A | 400 | 404 |
| controlAssessments | PATCH /api/control-assessments/:id | A→B | 400 | 404 |
| obligationAssessments | PATCH /api/obligation-assessments/:id | B→A | 400 | 404 |
| obligationAssessments | PATCH /api/obligation-assessments/:id | A→B | 400 | 404 |
| aiGovernanceAssessments | PATCH /api/ai-governance-assessments/:id | B→A | 400 | 404 |
| aiGovernanceAssessments | PATCH /api/ai-governance-assessments/:id | A→B | 400 | 404 |

For all 5 routes:
- **Positive controls (org A and org B) PASSED** — same-org GET returns 200
  with the correct id and owning `organization_id`. The seed is sound; this
  is not a broken-seed signal.
- **GET cross-org probes (both directions) PASSED 404** — cross-org *read*
  isolation holds on these routes.
- Only the **PATCH cross-org probe** is non-404: it returns **400**.

400 is not a 2xx, so the verdict classifier marked these `non-404`, not
`IDOR` — the cross-org PATCH did not write anything. But 400 ≠ 404, so per
the hard rule each is a candidate finding requiring triage.

### Hypotheses (unconfirmed — for joint triage, not acted on)

1. **Body-validation-before-org-check (most likely).** The PATCH probe body
   is `{ notes: "harness cross-org probe" }`. If these routes validate the
   body before the org-scoped `WHERE id=$1 AND organization_id=$2` lookup,
   an unaccepted/empty update set yields 400 for *any* caller — same-org
   included — and the org boundary is never reached. That would make this a
   **harness manifest defect**: the PATCH probe body for these 5 routes is
   not a valid partial update, violating routeManifest.ts's own stated
   requirement ("a *valid* body is required so a body-validation 400 cannot
   mask the org-scope 404"). The GET-only positive control never exercised
   the PATCH body, so this gap was not caught earlier.
2. **Enumeration oracle (lower-severity real finding).** If the route
   returns 400 for a cross-org id but 404 for a genuinely non-existent id,
   the 400-vs-404 difference distinguishes "exists in another org" from
   "does not exist" — a tenant-enumeration information leak.
3. **Genuine IDOR — ruled out for these probes.** No PATCH returned 2xx, so
   no cross-org mutation occurred.

### Decisive disambiguating probe (proposed, not yet run)

For one flagged route, run the 2×2:
- PATCH **same-org** id, same `{ notes }` body → 200 or 400?
- PATCH **random non-existent** uuid, same body → 404 or 400?

Outcomes:
- same-org 400 → body invalid → hypothesis 1 (harness manifest fix: correct
  the probe body per route).
- same-org 200 **and** non-existent 404 but cross-org 400 → hypothesis 2
  (real oracle — route should 404 cross-org, fix is route-side).

## Other observations

- Test display names read `org B cannot PATCH org undefined's …` — `dir[5]`
  in the `it()` title should be `dir[3]`. Cosmetic only; attacker key and
  victim id are derived from `dir === "B->A"` comparisons and are correct.
- testDb.ts logged 1 migration applied out of filename order
  (`20260504_user_alert_preferences_org_scope.sql`) — expected, handled by
  the multi-pass runner; unrelated to Finding 1.

## Triage 2026-05-21 — Finding 2 resolved for controlAssessments

Probe script: `e1-g1-controlassessments-patch-probe-2026-05-21.ts`.

**Code read — `controlAssessments.ts` PATCH handler order:** org-context check
→ `:id` UUID check → `validateControlAssessmentStatusTransition(req.body)`
(400 on invalid) → *then* `SELECT … WHERE id=$1 AND organization_id=$2
FOR UPDATE` (404 if not found). **Body validation precedes the org-scoped
lookup.** The validator requires a non-empty `status`
(`controlAssessmentValidation.ts:187`, `status_required`).

**2×2 result (probe body `{ notes }`):**

| # | Request | Status | Body |
|---|---|---|---|
| 1 | same-org PATCH `:id` | 400 | `status_required` |
| 2 | same-org PATCH non-existent uuid | 400 | `status_required` |
| 3 | cross-org PATCH `:id` | 400 | `status_required` |

**Confirmation (valid body `{ status: "in_progress" }`):**

| # | Request | Status | Body |
|---|---|---|---|
| 4 | cross-org PATCH `:id` | 404 | `control_assessment_not_found` |
| 5 | same-org PATCH non-existent uuid | 404 | `control_assessment_not_found` |
| 6 | same-org PATCH `:id` | 200 | assessment updated |

**Verdict: harness body defect — NOT a finding, NOT an IDOR, NOT an oracle.**
`{ notes }` yields an identical `400 status_required` for same-org,
non-existent, and cross-org alike — the 400 carries no org-dependent
information and the org check is never reached. With a *valid* body the route
behaves correctly: same-org 200, cross-org **404**, non-existent **404** —
cross-org and non-existent are indistinguishable, so there is no oracle.
Cross-org PATCH isolation on controlAssessments **holds**.

Root cause: the manifest PATCH probe body `{ notes }` is invalid for the
status-transition assessment routes, violating routeManifest.ts's stated
requirement that the probe body be valid so a body-400 cannot mask the
org-404. Fix is harness-side (per-route valid PATCH bodies); not yet applied.

**Likely generalises** to obligationAssessments and aiGovernanceAssessments
(same `{ notes }` probe body, same status-transition validator pattern) —
to be confirmed. riskTreatments and vendorReviews have their own validators
and still need their own 2×2 (vendorReviews flagged by operator as the odd
one out).

## Triage 2026-05-21 (cont.) — remaining four flagged routes

Probe script: `e1-g1-flagged-routes-patch-probe-2026-05-21.ts`.

**Code read — handler order, all four routes:** org-context check → `:id`
UUID check → `validate<Route>StatusTransition(req.body)` (400 on invalid) →
BEGIN → `SELECT … WHERE id=$1 AND organization_id=$2 FOR UPDATE` (404 if not
found) → terminal/transition guards. **Identical to controlAssessments —
body validation precedes the org-scoped lookup.** Each route has its own
validator (`obligationAssessmentValidation.ts`, `aiGovernanceAssessment‌Validation.ts`,
`riskTreatmentValidation.ts`, `vendorReviewValidation.ts`); all four require
a non-empty `status` (`status_required`).

**2×2 result — every route identical:**

| Route | 1 same-org `{notes}` | 2 same-org nonexistent `{notes}` | 3 cross-org `{notes}` | 4 cross-org `{status}` | 5 same-org nonexistent `{status}` | 6 same-org `{status}` |
|---|---|---|---|---|---|---|
| obligationAssessments | 400 | 400 | 400 | **404** | **404** | 200 |
| aiGovernanceAssessments | 400 | 400 | 400 | **404** | **404** | 200 |
| riskTreatments | 400 | 400 | 400 | **404** | **404** | 200 |
| vendorReviews | 400 | 400 | 400 | **404** | **404** | 200 |

(400 body = `status_required`; 404 body = `<route>_not_found`.)

**Verdict for all four: harness body defect — NOT a finding, NOT an oracle.**
Same-org `{notes}` = 400 (per the agreed interpretation → harness defect).
The 400 is identical for same-org / non-existent / cross-org — no
org-dependent information. With a valid body the routes isolate correctly:
same-org 200, cross-org 404, non-existent 404 — cross-org and non-existent
are indistinguishable, so no enumeration oracle. riskTreatments and
vendorReviews — the routes with their own validators where a real oracle
could have existed — show no oracle.

## Status — all five flagged routes triaged

- **Finding 2 — all 5 flagged routes (controlAssessments, obligation‌Assessments,
  aiGovernanceAssessments, riskTreatments, vendorReviews): CLEAR.** No
  cross-tenant IDOR, no enumeration oracle. The PATCH 400s were caused
  entirely by the harness manifest's invalid `{ notes }` probe body — these
  are status-transition routes requiring `status`. Read and write cross-org
  isolation hold on every probed route.
- **Harness manifest fix required (not yet applied):** the PATCH probe body
  for these 5 routes must be a valid status-transition body (e.g.
  `{ status: "in_progress" }`) so a body-400 cannot mask the org-404.
- **Finding 1 (`findings.due_date` schema drift): untouched** — separate
  bug, outside E1-G1's isolation question; `findings` remains unprobed.

## Manifest fix applied 2026-05-21 — harness re-run

The PATCH probe body for the five status-transition routes (vendorReviews,
riskTreatments, controlAssessments, obligationAssessments,
aiGovernanceAssessments) was changed from `{ notes }` to `{ status:
"in_progress" }` in `routeManifest.ts`. The `IdEndpoint.body` doc comment now
states why a route-accepted body is mandatory (validation precedes the
org-scoped lookup).

Harness re-run: **77 passed / 1 failed (78)**. All 46 cross-org probes
returned 404 — every previously-flagged PATCH probe now 404, zero non-404
probes. The single remaining failure is the `findings` create (Finding 1),
untouched and unprobed.

STOP — `findings.due_date` (Finding 1) to be investigated separately. Do not
commit the harness, open the PR, or close E1-G1 yet.

## Finding 1 — root cause (2026-05-21)

`POST /api/findings` (`findings.ts:121`) INSERTs a `due_date` column into the
`findings` table. The full `findings` schema across all migrations:

- `001_securelogic_platform.sql` — `CREATE TABLE findings`: no `due_date`.
- `20260410_platform_primitives.sql` — ALTERs findings adding organization_id,
  source_type, source_id, domain, priority, likelihood, confidence,
  time_sensitivity, scoring_rationale, owner_user_id: no `due_date`.
  (The `due_date DATE` in this file is on the `actions` table, not findings.)
- `20260424_findings_source_type_risk.sql` — source_type CHECK only.
- No other migration touches findings. Grep of `due_date` across all
  migrations: 4 files, none ALTER `findings`.

**No migration ever adds `findings.due_date`.** Yet the application layer
fully expects it: `findingValidation.ts` validates `due_date` as an optional
ISO date (`CreateFindingInput.due_date: string | null`), and `findings.ts`
destructures, INSERTs, and RETURNs it.

**Root cause: a missing migration.** `due_date` is a deliberate, fully-wired
findings field in the route + validator — not a stray typo, and not a
renamed/dropped column (no evidence it ever existed in the schema). The
`ALTER TABLE findings ADD COLUMN due_date DATE` was never written. Secondary
inconsistency: `GET /findings/:id` does NOT select `due_date` — the read path
omits the field the write path stores, confirming the feature was half-wired.

**Open question — prod state (needs an operator schema check, not done here):**
- If prod `findings` has no `due_date` → `POST /api/findings` 500s in
  production today (latent — workflow-generated findings use other routes'
  own INSERTs; only the manual `POST /api/findings` path hits this).
- If prod `findings` has `due_date` (added out-of-band) → prod works but the
  migration set has drifted from prod schema.

### Options (no fix applied — operator decision)

- **A. Add the missing migration** — new `ALTER TABLE findings ADD COLUMN
  IF NOT EXISTS due_date DATE`. `IF NOT EXISTS` is idempotent, so it is safe
  whether prod already has the column or not. Aligns schema to the existing
  route+validator, fixes the latent prod 500 if present, gets the harness to
  true 13/13. Optionally also add `due_date` to the GET select for
  read/write consistency. Smallest correct change; additive, nullable.
- **B. Remove `due_date` from route + validator** — strip it from
  `findings.ts` and `findingValidation.ts`. Discards a fully-built field;
  risky if prod already has the column. Not recommended.
- **C. Defer findings, close E1-G1 at 12/13** — mark findings deferred in the
  harness manifest with a documented reason, track `findings.due_date` as a
  separate issue. Keeps the harness PR scoped; findings isolation stays
  genuinely untested but the gap is explicit.
