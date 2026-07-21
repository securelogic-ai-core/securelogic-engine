# Sprint 1 — Production Go-Live (Launch-Blocking Only)

> **Status:** ACTIVE — **NO-GO** (promotion still gated). **RE-BASELINED 2026-07-21** (operator rulings D-A–D-E below): the promotion object is now the **composite `develop` head** (266 commits / 65 staged migrations ahead of `main`, including Briefing B1/B2 + read-surface D1 as one validated architectural unit), promoted as a **single true merge**. The 2026-07-02 promote (`main` = `512cfa5a`, PR #449) is **archived historical evidence, not the governing baseline**, and the prior main freeze is **superseded by this baseline** — this document is the single promotion narrative. Part B operator gates 1–6 outstanding (empty evidence log). **All 8 CI lanes green on `develop`; staging deploy-verified at `cb934b05`. Production has NOT launched; all staged surfaces are prod-dark and prod enablement remains pending operator approval.**
> **Goal:** Get the staged `develop` release ready for, and then promote it to, production `main`.
> **Scope discipline:** This sprint contains **ONLY** launch-blocking work. No Sprint 2 / Sprint 3 items.
> **Pre-flight evidence:** `PART_B_PREFLIGHT.md` (migration + flag audits, 2026-07-21).

Sprint 1 has two parts:

- **Part A — Pre-promotion app hardening.** Customer-facing auth/billing/onboarding defects that must be fixed *before* go-live. Code work, validated on staging, merged to `develop`. **(Authorized & in execution.)**
- **Part B — Promotion gates.** The operator-only release gates that must all pass to promote `develop → main`. **(Operator-executed; unchanged.)**

Both parts must be complete before a Go decision.

---

## Part A — Pre-promotion app hardening

Execution rules (per operator directive): one issue at a time, root-cause first, fix completely, add tests, validate on staging, merge to `develop` after CI passes, update this doc after each issue. No `main`, no feature flags.

| # | Issue | Status | Merge |
|---|---|---|---|
| A1 | Manage Billing single-click bug | ✅ **DONE** | `develop` ← PR #409 (`0614429a`) |
| A2 | Add Confirm Password to signup | ✅ **DONE** | `develop` ← PR #411 |
| A3 | Onboarding flow — smallest correct UX improvement | ✅ **DONE** | `develop` ← PR #412 |
| A4 | Return to Dashboard / Return to Account nav on auth pages | ✅ **DONE** | `develop` ← PR #413 |
| A5 | Complete onboarding QA | ✅ **DONE** | `develop` ← PR #414 |

### A1 — Manage Billing single-click bug ✅ DONE
- **Root cause:** `BillingPortalForm` is a native `<form method="POST">` whose `onSubmit` synchronously set the submit button to `disabled={pending}`. Disabling a submit button within the same synchronous submit dispatch can suppress the browser's native form submission (browser-timing-dependent React + native-form race) — the first click flips the button to "Opening billing…" but the POST may not navigate, so users click again.
- **Fix:** never use `disabled` to gate the button (first native submit always proceeds → reliable single click); pending shown via label + `aria-busy`; duplicate submits blocked by `preventDefault()`-ing the 2nd+ submit via a ref-held guard. Guard extracted as pure module `createSubmitGuard` (mirrors `api/billing/portal/retry.ts`).
- **Files:** `app/src/components/BillingPortalForm.tsx`, `app/src/components/billingPortalSubmit.ts`, `app/src/components/__tests__/billingPortalSubmit.test.ts`.
- **Tests:** 4 cases (first proceeds; subsequent blocked; `hasSubmitted`; per-instance isolation). CI 7/7 green.
- **Validation:** app `tsc` clean; billing+component tests 12/12. Staging auto-deploys from `develop` (browser-level confirm is operator-observable).
- **Rollback:** revert merge commit `0614429a`; no migration/config/flag involved.

### A2 — Add Confirm Password to signup ✅ DONE
- **Root cause:** the signup form (`SignupForm.tsx`) had a single password field — a mistyped password silently created an account the user could not sign into (recoverable only via password reset). The confirm-password idiom already existed in `reset-password` / `accept-invite` but not in signup.
- **Fix:** add a `Confirm Password` `AuthInput` + `confirm` state; validate exact match (`Passwords do not match.`) in `handleSubmit` after the strength check. Extracted both client validators into a pure module `signupValidation.ts` (testable; mirrors the server's authoritative checks).
- **Files:** `app/src/app/signup/SignupForm.tsx`, `app/src/app/signup/signupValidation.ts` (new), `app/src/app/signup/__tests__/signupValidation.test.ts` (new).
- **Tests:** 7 cases — strength (length + each character class) and match (identical, mismatch, empty-confirm, case/whitespace sensitivity).
- **Validation:** app `tsc` clean; tests 7/7; CI green on PR #411. Staging auto-deploys from `develop`.
- **Rollback:** revert the PR #411 merge; no migration/config/flag.

### A3 — Onboarding flow: smallest correct UX improvement ✅ DONE
- **Review + root cause:** the `/getting-started` onboarding checklist's `getCompletedSteps` keyed BOTH step 4 ("Run an assessment") and step 5 ("Review your security posture") to `control_assessments > 0`. So the 5-step progress bar could never read "4 of 5" — running the first assessment jumped it 3→5 and flipped "All done!" before any posture had been computed or reviewed. A dishonest progress indicator is the clearest small defect in the flow.
- **Smallest correct fix:** decouple step 5 to a real posture signal already returned by `getDashboardSummary` (`posture.overall_score` / `snapshot_date`), so progress is honest and step 5 completes only when posture actually exists. Logic extracted to a pure module `onboardingProgress.ts`. No change to step destinations, copy, or the skip/complete actions (kept minimal).
- **Files:** `app/src/app/getting-started/page.tsx`, `app/src/app/getting-started/onboardingProgress.ts` (new), `app/src/app/getting-started/__tests__/onboardingProgress.test.ts` (new).
- **Tests:** 6 cases — empty org; each inventory step independent; the previously-impossible "4 of 5" state; step-5 completion via `overall_score`, via `snapshot_date`, and the `score === 0` (real score, not missing) edge.
- **Validation:** app `tsc` clean; tests 6/6; CI green on PR #412. Staging auto-deploys from `develop`.
- **Rollback:** revert the PR #412 merge; no migration/config/flag (presentation-only completion logic).

### A4 — Return to Dashboard navigation on auth pages ✅ DONE
- **Root cause:** auth pages render a full-bleed `AuthCard` with no app chrome, and `middleware.ts` only redirects *unauthenticated* users *into* `/login` — it never redirects an authenticated user *away* from an auth page. So a signed-in user who lands on one (stale bookmark, external link, or a legitimate token flow like `reset-password` / `accept-invite`) is stranded: no nav, and even the brand row isn't a link. (`/signup` was the lone exception — its server page already `redirect("/dashboard")`s authed users.)
- **Decision (operator-approved):** Dashboard only. Server-rendered **only** when an authenticated session exists; destination `/dashboard`; label `← Return to Dashboard`. No "Account" target (no route-specific reason today). No client-side session detection.
- **Smallest safe fix:** the session cookie is httpOnly, so signed-in state must be read on the server. Added a server component `AuthReturnLink` (reads `getSession()`, renders nothing for unauthenticated visitors) mounted via a one-line per-route `layout.tsx` re-exporting a shared `AuthReturnLayout`. This touches **zero** lines of the critical, untested client auth forms (login/reset/verify/forgot) and yields *consistent* placement (a fixed top-left link) across both `AuthCard` pages and the custom-markup `accept-invite` page. The auth predicate (`jwtToken ?? apiKey`) is extracted to a pure, tested module `authReturnLink.ts`, mirroring `/signup`'s exact check.
  - **Note on placement:** rendered as a fixed top-left link rather than an in-card footer, specifically to avoid restructuring the untested client auth forms (a Server Component can't be imported into a Client page; in-card placement would require extracting all four forms). Trivially relocatable later if an in-card footer is preferred.
- **Files:** `app/src/components/authReturnLink.ts` (new, pure), `app/src/components/AuthReturnLink.tsx` (new, server component), `app/src/components/AuthReturnLayout.tsx` (new), `app/src/components/__tests__/authReturnLink.test.ts` (new), and one `layout.tsx` each under `login/`, `signup/`, `forgot-password/`, `reset-password/`, `verify-email/`, `accept-invite/`.
- **Tests:** 6 cases — JWT session → link; legacy API-key session → link; unauthenticated → null; both-undefined → null; destination/label locked to `/dashboard` + `← Return to Dashboard`; empty-string `jwtToken` treated as unauthenticated (mirrors `/signup`'s `??`).
- **Validation:** root `tsc -p tsconfig.ci.json` clean; full root `vitest` 4652/4652 (incl. the new 6); app `next build` exit 0. Staging auto-deploys from `develop`.
- **Rollback:** revert the PR #413 merge; no migration/config/flag (presentation-only, additive files).

### A5 — Complete onboarding QA ✅ DONE
- **Root cause:** N/A — this is a verification pass, not a defect fix. The end-to-end new-customer onboarding flow (signup → verify-email → routing → `/getting-started` checklist → complete/skip → dashboard, plus the A2/A3/A4 fixes) was traced against verified code and exercised via the onboarding/auth-flow unit tests.
- **Result:** ✅ **PASS** — no launch-blocking defects. 13 checkpoints verified (C1–C13). Three **non-blocking** findings documented and explicitly deferred (scope is launch-blocking only): F1 `completeOnboardingAction` keys on `jwtToken` only — no impact since onboarding signups are always JWT; F2 "Skip setup for now" permanently completes onboarding (copy-only nit); F3 `/getting-started` has no entitlement guard for direct nav (natural entry already gates by `premium`). Routing confirmed correct: only `premium` = Platform Professional reaches `/getting-started`; other tiers go to `/dashboard`.
- **Files:** `docs/launch/ONBOARDING_QA.md` (new — full checkpoint table + findings + evidence). No application code changed (nothing launch-blocking found).
- **Tests:** none added (QA pass). Re-ran the onboarding/auth-flow suite as validation: 23/23 — `onboardingProgress` (6), `signupValidation` (7), `authReturnLink` (6), `billingPortalSubmit` (4).
- **Validation:** 23/23 onboarding/auth unit tests green; all 5 step-CTA routes confirmed present; root typecheck clean.
- **Rollback:** revert the PR #414 merge (documentation-only; no code/migration/config/flag).

---

## Part B — Promotion gates (operator-only)

> **RE-BASELINED 2026-07-21.** These cannot be executed by an automated session — they require Render / Stripe / staging-UI / production-DB access.
>
> **▶ Executable playbook:** `OPERATOR_RUNBOOK.md` reduces the Stripe gates (1–4) to step-by-step operator instructions with copy-pasteable commands/SQL, PASS/FAIL criteria, and an evidence log. **Its Gate 5 body (the `20260706`–`20260712` set + seat-cap pre-flight) is OBSOLETE — that set is already applied to production via the archived 2026-07-02 promote. Gate 5′ below, backed by `PART_B_PREFLIGHT.md` §1.5, replaces it.** The runbook's webhook notes stand (D-2 Enterprise/`admin` is granted out-of-band, not by the Stripe webhook; D-3 member seats are not metered by the webhook; Platform Monthly $800/mo is intentionally self-serve checkout).

### Operator rulings — 2026-07-21 (dated architectural decisions; supersede all prior promotion narrative)

| # | Ruling |
|---|---|
| **D-A** | The 2026-07-02 promote (`main` = `512cfa5a`, PR #449, incl. migrations `20260706`–`20260712` and the A1–A5 hardening) is **archived as historical evidence**. It is no longer the governing promotion baseline. The current validated baseline is the post-B1/B2/D1 architecture on `develop`. |
| **D-B** | The prior `main` promotion freeze (standing hold, 2026-07-02) is **explicitly superseded** by this re-baselined Sprint 1. There is one promotion narrative: this document. |
| **D-C** | **Composite promotion.** Staging validated the integrated system; cherry-picked slices would create never-tested combinations. Sprint 1 Part A (the B1/B2/D1 architectural unit, with everything staged beneath it) promotes as **one validated unit via a single true merge**. |
| **D-D** | The **authenticated staging walkthrough is a formal operator gate** (Gate 6). Automated testing proves correctness; the walkthrough proves usability. Both are required before production. |
| **D-E** | The production Briefing feature-flag flip (`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED`, engine + app two-switch) is **NOT part of Sprint 1's definition of done**. Sprint completion and production enablement remain separate operational decisions. |

### Launch state (re-baselined 2026-07-21, verified)
- **Production (`main`):** `512cfa5a` (2026-07-02, PR #449 — archived historical baseline per D-A). Carries the original Sprint-1 A1–A5 hardening, the free-trial work, the Brief Pro / Brief Team display rename, and migrations `20260706`–`20260712` (applied). Stable, known-good; the rollback target.
- **Staging (`develop`):** `cb934b05` — **266 commits and 65 staged migrations ahead of `main`** (`20260710` → `20260910`), carrying ECL S1–S10, EAR P0–P16, ERG C0–C3b, risk lifecycle R1–R3, finding governance (closure gate, SoD, independent review), evidence upload, and Briefing B1/B2 + read-surface D1. Every staged feature is dark behind a `"false"` production flag (verified — `PART_B_PREFLIGHT.md` §2).

**Static evidence already PASS (automated-session-verifiable, 2026-07-21):** all **8** CI lanes green on `develop` HEAD; staging `/version` (app + engine) = `develop` HEAD; migration pre-flight audit PASS (additive-only, RLS-conformant, one staging-only finding PF-1); prod dark-flag audit PASS on desired state. Full evidence: `PART_B_PREFLIGHT.md`.

### Staged release update (2026-07-21) — Briefing program + read-surface architecture

The staged `develop` release now additionally carries the Briefing Initiative B1/B2 and
the read-surface architecture D1 (full records: `BUILD_SEQUENCE.md` Briefing Initiative
entry; decision records under `docs/specs/`). Sprint-relevant facts:

- **Read-surface architecture COMPLETE; the Briefing GATE B architectural blocker is
  DISCHARGED.** `/posture` is now the canonical Posture Dashboard (analytics grid +
  Executive Report export re-homed); **no analytical capability, export, or destination is
  lost when the Briefing feature is enabled.** Spec: `docs/specs/read-surface-architecture-spec.md`
  (RATIFIED & IMPLEMENTED).
- **`develop` HEAD is `b91fbdd5`** (D1 `a971f2a4` + B2 `11ee6b9e` + lockfile-only audit
  fix). **CI is FULLY GREEN — all 8 lanes** (the audit lane, red on every push since
  2026-07-20 due to an upstream `brace-expansion` advisory, is restored; `npm audit`
  reports 0 vulnerabilities). This satisfies the promotion-readiness "CI green on the
  promotion head" evidence as of this HEAD.
- **Staging verification COMPLETE (automated-session scope):** app + engine `/version`
  both report `b91fbdd5`; `/posture`, `/dashboard`, and the Executive Report export
  endpoint are live and auth-gated; the engine Briefing-layout endpoint confirms flag-ON +
  auth-enforced behavior; flag-off surfaces remain byte-identical (prod `main` untouched).
- **Prod impact: none.** All Briefing/D1 surfaces are dark in production
  (`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` prod `"false"` on both services); this update
  changes no Sprint 1 gate and adds no launch-blocking scope.

**Remaining operator-controlled production activities (unchanged in ownership):**
1. Part B promotion gates 1–6 below — the launch-blocking set (the walkthrough is now
   formal Gate 6 per ruling D-D); still **NO-GO** until they pass.
2. Post-promotion, the production Briefing feature-flag enablement (engine + app
   two-switch) — a separate operator ruling, NOT part of Sprint 1's definition of done
   (ruling D-E).

**Production has not launched.** Promotion and all production enablement remain pending
operator approval.

### Promotion-candidate SHA + quiescence rule (added 2026-07-21 — replaces the superseded freeze as the head-pinning control)

Ruling D-B removed the main freeze; nothing else pins the promotion head while gates run.
Therefore, promotion is made deterministic and auditable as follows:

1. **When M2 begins, the operator declares a promotion-candidate SHA** (the `develop`
   HEAD at that moment). Every §0.4 evidence row records the candidate SHA it was
   collected against.
2. **Quiescence:** from that declaration until M3 completes, `develop` accepts
   **docs-only** commits (which extend the candidate without invalidating evidence —
   the promotion head becomes the newest docs-only descendant). Any commit touching
   application code, tests, config, flags, schemas, or `render.yaml` **invalidates the
   candidate**: either re-declare a new candidate and re-affirm every gate whose object
   the delta touches, or revert the commit off `develop`.
3. **At M3, the promotion PR head must be the declared candidate (or its docs-only
   descendant), verified by `git diff <candidate>..<head> -- . ':!docs' ':!*.md'`
   returning empty.**

### The 6 launch-blocking gates (owner: operator; re-baselined 2026-07-21, reconciled 2026-07-21)

> **Evidence correction (2026-07-21 reconciliation):** the §0.4 evidence log in
> `OPERATOR_RUNBOOK.md` is empty, but committed evidence artifacts DO exist under
> `docs/validation/billing-portal/` — Gate 1 holds a full PASS and Gate 3 a
> code-prerequisite PASS (both 2026-07-01). §0.4 is now the **index** pointing at those
> authoritative artifacts (never duplicating them). The archived 2026-07-02 promote
> itself remains historical evidence only (D-A). Each gate below requires a §0.4 row
> (PASS or carry-forward re-confirmation) before promotion.
>
> **M2 execution order (reconciled):** Gates **1 → 2 → 3 → 4** are a sequential Stripe
> dependency chain (config → capabilities → checkout → transitions). Gates **5′ and 6
> are independent** of the chain and of each other — they may run in parallel with it,
> and Gate 6 has no prerequisite at all (staging already serves the baseline).

**Gate 1 — Stripe Billing Portal configuration — CARRY-FORWARD gate (reconciled 2026-07-21).** A full PASS was recorded 2026-07-01 in `docs/validation/billing-portal/GATE_1_RESULT.md` (machine-verified prod config + operator-attested staging click-through), and the staged payload does not touch the portal path. The gate therefore does **not** re-run; it **re-confirms**. Re-confirmation criteria (all three, recorded as the §0.4 row): (a) `STRIPE_PORTAL_CONFIGURATION_ID` + `STRIPE_PORTAL_RETURN_URL` still set on both engine services (values unchanged since the PASS); (b) no Stripe portal-configuration change since 2026-07-01 (dashboard check); (c) one staging "Manage billing" click-through still opens the portal. Any failed criterion voids the carry-forward → run the full runbook Gate 1.

**Gate 2 — Stripe test-mode portal capabilities.** subscription_update, price changes, prorations, cancellations (per decision); all 4 test Price IDs in the allowed-plan list. No prior evidence — full run.

**Gate 3 — Staging checkout amounts — HALF-COMPLETE (reconciled 2026-07-21).** The **engineering half is PASS** (2026-07-01, `docs/validation/billing-portal/GATE_3_RESULT.md`: tier→price map, allow-list, invalid-tier rejection, 503-on-missing-var, UI-label consistency — and `billing.ts` is unchanged in the staged range, so the PASS carries forward). The **operator/Stripe half remains outstanding and is the only work in this gate**: the 4 Stripe checkout-page totals + 4 Price-object cross-checks + screenshots. Amounts: Brief Pro $49/mo; **Brief Team** $199/mo (display name per the shipped #447 rename; internal key `teams` unchanged); Platform Professional monthly $800/mo; Platform Professional — Annual $7,200/yr. All four paid plans are **self-serve checkout**; Free needs no checkout (default tier); Enterprise is sales-led only (custom contract, no Stripe checkout).

**Gate 4 — Staging portal upgrade/downgrade transitions — FULL VALIDATION REQUIRED (reconciled 2026-07-21).** The gate's object **changed during Sprint 1**: `src/api/webhooks/stripeWebhook.ts` was modified in the staged range (PR-D1 `5389f620` — `api_key_id` demoted from fatal gate to resolver fallback, +28/−9). **No prior evidence can carry forward; this gate validates a modified surface and must run in full**: for each of the 5 transitions, Stripe sub updates + webhook fires + `entitlement_level` correct + return-to-app, executed against staging at the promotion-candidate SHA.

**Gate 5′ — Migration pre-flight for the 65-migration staged set** (replaces the obsolete 7-file Gate 5). Per `PART_B_PREFLIGHT.md`: (a) F-1 filename-key check — the 65 staged filenames return **0 rows in prod** and **65 rows applied in staging** (§1.5 SQL); (b) resolve finding **PF-1** (possible skipped v2 grants on staging `enterprise_entities`/`data_stores` — §1.3; blocks the A04-G1 staging RLS flip, not promotion, but verify now); (c) **batch-application ruling** — rehearse the 65-file batch against a prod clone, or explicitly accept the risk on the per-file-atomicity + additive-only evidence (§1.4). The old seat-cap pre-flight is retired — `20260711` is already applied to prod.

**Gate 6 — Authenticated staging walkthrough (formal gate per ruling D-D).** Visual/usability pass of the staged surfaces on staging with real credentials: The Briefing (`/dashboard`, flag-on), the Posture Dashboard (`/posture` — analytics grid, Executive Report PDF export, back-link), workspace navigation, and the boundary sanity check (Briefing = "what matters to me now", Operational Views = "what do I inspect/execute", Posture = "how is the organization performing"). Automated tests prove correctness; this gate proves usability. Record PASS/FAIL + screenshots in the evidence log.

### Part B milestone completion model (operator-required, 2026-07-21)

A milestone is **never** "complete" merely because the code or document exists. Every
Part B milestone must explicitly state which of these four **cumulative** states it has
reached; each state requires the previous one.

1. **Engineering completion** — the work exists on `develop`, tested/audited, CI green.
   Proves the work is *built*, nothing more.
2. **Operator validation** — the operator has executed the relevant gates/walkthroughs
   against staging and recorded PASS evidence in the `OPERATOR_RUNBOOK.md` §0.4 log.
3. **Production readiness** — all six gates hold simultaneously on the intended
   promotion head: evidence log complete, 8 CI lanes green, dark-flag audit re-confirmed,
   Gate-5′ batch ruling recorded. The promotion PR may be opened.
4. **Production launch** — the composite true merge is on `main`, post-deploy
   verification passed (`/version` both services, 65 migrations recorded), launch state
   flipped to LIVE. (The Briefing flag flip remains outside even this state — ruling D-E.)

**Current milestone states:**

| Milestone | State reached |
|---|---|
| M1 — Part B re-baseline (rulings D-A–D-E, gate redefinition, `PART_B_PREFLIGHT.md` audits) | **1 — Engineering completion** (docs-only; operator rulings ratified; no gate evidence exists yet) |
| M2 — Operator gates execution (Gates 1–4, 5′, 6; execution order: Stripe chain 1→2→3→4, with 5′ and 6 in parallel) | **Not started** (pre-existing artifacts indexed: Gate 1 PASS carry-forward + Gate 3 engineering-half PASS under `docs/validation/billing-portal/`; every §0.4 row still requires operator sign-off at the promotion-candidate SHA) |
| M3 — Promotion + post-deploy verification | **Not started** |

### Promotion-readiness gate
- All **8** CI lanes green on the promotion head (`audit`, `build`, `lint`, `test`, `typecheck`, `cross-org-isolation`, `tenant-coverage`, `url-drift`).
- Dark-flag audit re-confirmed at promotion time: every staged-feature flag `"false"` on all production services per `PART_B_PREFLIGHT.md` §2, **plus** the operator dashboard confirmation (§2.3) that no dashboard-set override enables a staged feature.
- Promotion executed as a **true merge** (`gh pr merge <N> --merge`, never squash); post-merge `origin/develop..origin/main = 0`.
- Post-deploy `/version` on prod engine **and** app returns the promoted commit; the 65 staged filenames appear in prod `schema_migrations`; no migration errors in the prod deploy log.

Full procedure: `RELEASE_CHECKLIST.md`.

---

## Definition of done (Sprint 1 — re-baselined 2026-07-21)

1. **Part A** — the validated composite architecture on `develop`: the original A1–A5 hardening (shipped; promoted 2026-07-02, archived baseline) **plus** the Briefing/read-surface architectural unit (B1, B2, D1 — shipped, ratified, staging-validated). **COMPLETE.**
2. **Part B** — Gates 1–6 all pass with recorded evidence in the `OPERATOR_RUNBOOK.md` §0.4 log.
3. Promotion PR merged to `main` via **single composite true merge** (ruling D-C), all **8** CI lanes green on the promotion head.
4. Dark-flag audit re-confirmed in prod (all staged-feature flags OFF, incl. dashboard check); post-deploy `/version` confirms the promoted commit on both prod services; 65 staged migrations recorded in prod `schema_migrations`.
5. Launch state updated from **NO-GO** to **LIVE** in `LAUNCH_MASTER_PLAN.md` and `KNOWN_ISSUES.md`.

**Explicitly NOT in the definition of done (ruling D-E):** the production Briefing flag flip — a separate post-sprint operational decision.

**Do not** start Sprint 2 until this is true.

---

## Explicitly out of scope for Sprint 1
Export-delivery email (PR #4), in-app price-label reconciliation, vendor-assurance prod enablement + rank-2 gate flip, brand-asset swap → **Sprint 2**. A04-G1 RLS flip, GDPR deletion reaper, Priority-4 4B/4C/4D → **Sprint 3**.



