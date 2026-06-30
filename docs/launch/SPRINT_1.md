# Sprint 1 — Production Go-Live (Launch-Blocking Only)

> **Status:** ACTIVE — **NO-GO** (promotion still gated; app-hardening in progress).
> **Goal:** Get the staged `develop` release ready for, and then promote it to, production `main`.
> **Scope discipline:** This sprint contains **ONLY** launch-blocking work. No Sprint 2 / Sprint 3 items.

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
| A4 | Return to Dashboard / Return to Account nav on auth pages | ✅ **DONE** | `develop` ← PR #PENDING |
| A5 | Complete onboarding QA | ⬜ Pending | — |

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
- **Rollback:** revert the PR #PENDING merge; no migration/config/flag (presentation-only, additive files).

### A5
Defined by the operator directive; will be filled in on completion with root cause, files, tests, validation, rollback.

---

## Part B — Promotion gates (operator-only)

> Unchanged from the original Sprint 1 definition. These cannot be executed by an automated session — they require Render / Stripe / staging-UI / production-DB access.

### Launch state (verified)
- **Production (`main`):** `959951b9` — carries only the Priority-4 4A.1 contract-stubs foundation; stable, known-good.
- **Staging (`develop`):** ahead of `main` by the staged release + Part A app-hardening fixes. The entire Phase-4 B/C/D signal batch is flag-gated/inert.

**Static evidence already PASS (automated-session-verifiable):** all 7 CI lanes green on `develop` HEAD; canonical checkout routing; seat-cap migration SQL reviewed; `render.yaml` diff limited to staging-only `STRIPE_PORTAL_CONFIGURATION_ID`; Phase-4 flags default OFF.

### The 5 launch-blocking gates (owner: operator)

**Gate 1 — Stripe Billing Portal configuration.** Set `STRIPE_PORTAL_CONFIGURATION_ID` on `securelogic-engine-staging` (+ confirm prod), redeploy, record timestamp.

**Gate 2 — Stripe test-mode portal capabilities.** subscription_update, price changes, prorations, cancellations (per decision); all 4 test Price IDs in the allowed-plan list.

**Gate 3 — Staging checkout amounts.** Brief Pro $49/mo; Team Professional $199/mo; Platform Professional — Annual $7,200/yr; Platform Professional monthly ($800/mo) remains Billing-Portal-only.

**Gate 4 — Staging portal upgrade/downgrade transitions.** For each of the 5 transitions: Stripe sub updates + webhook fires + `entitlement_level` correct + return-to-app.

**Gate 5 — Migration validation + production pre-flight.** Validate all 6 staged migrations on staging (`20260706`–`20260711`); F-1 filename-key check returns 0 in staging + prod; seat-cap pre-flight `WHERE max_members = 10` shows no legit 10-seat org wrongly lowered to 6.

### Promotion-readiness gate
- All 7 CI lanes green on the promotion head.
- Phase-4 flags confirmed **OFF** in production engine env.
- Promotion executed as a **true merge** (`gh pr merge <N> --merge`, never squash); post-merge `origin/develop..origin/main = 0`.
- Post-deploy `/version` on prod engine **and** app returns the promoted commit.

Full procedure: `RELEASE_CHECKLIST.md`.

---

## Definition of done (Sprint 1)

1. **Part A** — A1–A5 all fixed, tested, on `develop`, validated on staging.
2. **Part B** — Gates 1–5 all pass with recorded evidence.
3. Promotion PR merged to `main` via true merge, all 7 CI lanes green.
4. Phase-4 flags verified OFF in prod; post-deploy `/version` confirms the promoted commit on both prod services.
5. Launch state updated from **NO-GO** to **LIVE** in `LAUNCH_MASTER_PLAN.md` and `KNOWN_ISSUES.md`.

**Do not** start Sprint 2 until this is true.

---

## Explicitly out of scope for Sprint 1
Export-delivery email (PR #4), in-app price-label reconciliation, vendor-assurance prod enablement + rank-2 gate flip, brand-asset swap → **Sprint 2**. A04-G1 RLS flip, GDPR deletion reaper, Priority-4 4B/4C/4D → **Sprint 3**.



