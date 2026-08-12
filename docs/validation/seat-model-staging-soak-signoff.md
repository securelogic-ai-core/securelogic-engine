# Staging Soak Sign-off — Enterprise Seat / Role / Scoped-Authorization

**Package:** Enterprise Seat / Role / Scoped-Authorization (PR #784)
**Environment:** `securelogic-engine-staging` + staging Postgres
**Record date:** 2026-08-12 (operator-directed sign-off, info@securelogicai.com)
**Verdict:** **PASS** — see §7. This record was compiled exclusively from evidence
already collected and verified during the 2026-08-12 enablement session; no new
probes, deploys, flag changes, or environment mutations were performed to produce it.

---

## 1. Configuration under soak (all VERIFIED)

| Item | Verified state | Evidence channel |
|---|---|---|
| Engine SHA | `1cc39602` (PR #784 merge commit; == `develop` == `origin/develop` at soak time) | Render API deploy record read 2026-08-12 ~06:00 UTC |
| `SECURELOGIC_SEAT_MODEL_ENABLED` | `"true"` on `securelogic-engine-staging` (dashboard-set at soak time; declared in IaC later the same day, `00e6cccf`) | Render API env-var read |
| In-process enforcement | `GET /api/me` returned `seat.enforced: true` with fully resolved seat scope (`seatType`/`role`/scopes/capabilities), authenticated as the `[SEED] Walkthrough Org` analyst | Live API call against the running staging process |
| Seat migrations | All four applied: `20260915_enterprise_seat_model`, `20260916_sso_default_seat`, `20260917_viewer_export`, `20260918_api_key_seat_binding` — staging `schema_migrations` 203 → **207** at 2026-08-12 02:45:47 UTC | Direct staging-DB query |

## 2. Soak window and activation timeline (UTC, 2026-08-12)

- **02:45** — four seat migrations applied (203 → 207).
- **02:45–04:04** — deny-path validation traffic exercised against the enforcing
  process (see §5).
- **03:36 / 03:44 / 04:04** — explicit same-SHA API-triggered deploys to activate the
  env var in-process (per the EG2 Wave-1 lesson: Render injects env at deploy, not
  restart).
- **04:04 → 06:05** — post-activation observation window (logs read end-to-end).
- **~06:00** — end-of-window live verification: flag still `"true"`, `seat.enforced:
  true` still returned in-process.

**Elapsed enforced observation:** ~2h clean under enforcement (04:04–06:05 quiet soak,
preceded by ~1h20m of enforcement with active validation traffic from 02:45).
**Traffic caveat:** organic traffic in the quiet window was **near-idle**; the
functional exercise came from the validation traffic and the live multi-seat
walkthrough (operator-confirmed passed, 2026-08-12).

## 3. Stability

- **Health:** service served continuously through the window; one clean boot at the
  04:04 activation deploy, healthy thereafter.
- **Restarts/crashes:** **none** after the 04:04 activation deploy — no restarts, no
  crash loops, no failed health checks observed in the window.
- **Errors:** **zero error-level log entries** across the entire 04:04→06:05 window.
- **Warnings:** no warning-level summary was separately captured for the window; no
  warning was implicated in any observed behavior. (Recorded as a coverage note, not
  a finding.)

## 4. Authorization behavior observed

- **Authentication:** logins succeeded normally under enforcement (walkthrough-org
  analyst session established and used for the in-process verification); no
  authentication regression observed.
- **Contributor scoping:** deny paths returned **403** as designed on the scoped
  routes (finding create/patch) during the 02:45–04:04 validation traffic; the
  multi-seat walkthrough passed (operator-confirmed).
- **Viewer mutation/export:** deny-path 403s observed on the documented
  Viewer/ungranted routes (writes, `GET /api/findings/export.csv`, audit-log access)
  in the same validation traffic, consistent with the §1.21 deny matrix (a Viewer
  **seat** is read-only regardless of role — the release-review P1 fix `6200d37f` is
  in the deployed SHA).
- **Admin vs Full separation:** **not independently live-exercised inside the soak
  window.** Covered by the merged branch's CI (green, including the
  cross-org-isolation lane) and the operator-confirmed walkthrough.
- **API-key seat/role binding:** **not live-exercised inside the soak window.**
  Covered by the merged branch's CI (`apiKeySeatBinding.test.ts`) at the deployed SHA.
- **SSO / JIT:** **not observed** — no SSO traffic occurred during the window, so
  JIT default-seat behavior has no live staging observation. Covered by branch CI
  only.
- **Seat-cap / provisioning anomalies:** none observed or recorded; no provisioning
  events were noted in the window (near-idle traffic).
- **Rollback / flag disablement:** **none.** The flag was never flipped off; no
  rollback of any kind occurred; enforcement was verified live at both ends of the
  window.
- **Seat-model-attributable P0/P1 incidents:** **none.** (The one P1 found by the
  independent release review — Viewer-seat read-only — was found and fixed
  **pre-merge**, before any staging enablement.)

## 5. Classification of all observed denial/noise activity

1. **Expected authorization denials:** every observed 403 in the 02:45–04:04 window
   (finding create/patch, export.csv, audit-log) was deliberate deny-path validation
   traffic matching the documented deny matrix. Expected, correct, and desired.
2. **Inherited / pre-existing noise:** **none observed in this window** — zero
   error-level entries means there was nothing to classify. (Known pre-existing
   staging issues tracked elsewhere did not surface here and are not part of this
   record.)
3. **Seat-model-attributable issues:** **none.** No unexpected 401/403/404, no
   authorization regression, no error, no instability attributable to the seat model.

## 6. Coverage limitations of this soak (explicit)

This sign-off attests to **stability and enforcement correctness of what was
observed**. It does not claim live staging observation of: SSO/JIT default-seat
assignment, API-key binding under live traffic, or Admin-vs-Full separation under
live traffic (all covered by green CI at the deployed SHA; walkthrough coverage per
operator confirmation). These items should be included in the **production GATE B
validation checklist** rather than reopening the staging gate.

## 7. Verdict

**PASS.** The staging soak gate for the Enterprise Seat / Role / Scoped-Authorization
package is **CLOSED**: the enforcing configuration ran clean (zero errors, no
restarts, no rollback, no seat-attributable incident) with enforcement verified live
at both ends of the window, expected-only denial activity, and an
operator-confirmed multi-seat walkthrough pass.

**Only remaining operator-owned steps to production:**

1. **develop→main release** carrying the four additive seat migrations
   (migrate-before-merge order, per the established release runbook).
2. **Production GATE B decision** for `SECURELOGIC_SEAT_MODEL_ENABLED` — taken only
   after that release, with the §6 items in the GATE B validation checklist.

No code, config, flag, environment, or production change was made in the course of
recording this sign-off.
