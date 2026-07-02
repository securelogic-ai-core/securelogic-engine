# Onboarding QA — Sprint 1 / Part A / A5

> **Verdict:** ✅ **PASS** — no launch-blocking defects in the onboarding flow.
> **Method:** static end-to-end trace against verified code + onboarding/auth-flow
> unit tests. Live staging-UI click-through is operator-owned (Part B, Gates 1–5).
> **Date:** 2026-06-30. **Base:** `develop` @ `632fec70` (after A1–A4).

This QA covers the **complete new-customer onboarding path**, from signup through
the `/getting-started` checklist to dashboard hand-off, including the A2/A3/A4
fixes shipped earlier in Sprint 1.

---

## 1. Flow map (verified)

```
/signup ──POST /api/auth-signup──▶ /verify-email?email&plan
   │                                     │ (auto-verify on token)
   │                                     ▼
   │                       paid pendingPlan? ──yes──▶ POST /api/billing/checkout (Stripe)
   │                                     │ no
   │                                     ▼
   │                    entitlement "premium" (Platform) & !onboardingCompleted?
   │                          ├─ yes ─▶ /getting-started  (5-step checklist)
   │                          └─ no  ─▶ /dashboard
   ▼
(authed user landing on any auth page) ──▶ A4 "← Return to Dashboard" escape hatch
```

`/getting-started` → 5 steps → **Skip** or **Go to dashboard** → `completeOnboardingAction` → `/dashboard`.

---

## 2. Checkpoints

| # | Checkpoint | Verdict | Evidence |
|---|---|---|---|
| C1 | Signup validates password strength **and** confirm-match before POST (A2) | ✅ | `SignupForm.tsx:61-65`, `signupValidation.ts` (7 tests) |
| C2 | Consent gate: cannot submit without accepting terms | ✅ | `SignupForm.tsx:67-70,256` |
| C3 | Signup success routes to `/verify-email` carrying `email` + `plan` | ✅ | `SignupForm.tsx:104-110` |
| C4 | `/verify-email` auto-verifies on token and handles expired/invalid | ✅ | `verify-email/page.tsx:66-95` |
| C5 | Paid `pendingPlan` → Stripe checkout (real top-level form POST, not fetch) | ✅ | `verify-email/page.tsx:99-107,36-50` |
| C6 | Non-paid routing: Platform (`premium`) & not-onboarded → `/getting-started`, else `/dashboard` | ✅ | `verify-email/page.tsx:109-114`; `"premium"`→Platform Professional `api.ts:49` |
| C7 | `/getting-started` requires a session (no token → `/login`) | ✅ | `getting-started/page.tsx:58-61` |
| C8 | `/getting-started` skips itself when onboarding already completed | ✅ | `getting-started/page.tsx:64` |
| C9 | Progress is **honest**: step 5 keyed to a real posture signal, "4 of 5" reachable (A3) | ✅ | `onboardingProgress.ts:37-51` (6 tests) |
| C10 | Data contract: `DashboardSummary.inventory{frameworks,vendors,controls,control_assessments}` + `posture{overall_score,snapshot_date}` exist & feed step logic | ✅ | `api.ts:266-355`, consumed `getting-started/page.tsx:70-82` |
| C11 | All 5 step CTAs point at routes that exist | ✅ | `/frameworks`, `/vendors/new`, `/controls/new`, `/controls`, `/dashboard` — all present |
| C12 | Skip / complete persists completion (JWT session) and redirects to dashboard | ✅ | `actions.ts:7-18` |
| C13 | Authed user on auth pages has a return path (A4) | ✅ | `AuthReturnLink.tsx`, per-route `layout.tsx` (6 tests) |

---

## 3. Findings (all non-blocking)

### F1 — `completeOnboardingAction` keys on `jwtToken` only (not `apiKey`) · *Observation, low*
`actions.ts:9` resolves `token = session.jwtToken ?? null`, while `getting-started/page.tsx:60`
admits `jwtToken ?? apiKey`. A **legacy API-key-only** session that reached the checklist
would skip the completion call and never persist `onboardingCompleted`, re-showing the
checklist on a later visit.
- **Why not blocking:** the launch onboarding audience is **new signups, which are always
  JWT** (customer auth). API-key sessions are the legacy/back-compat path and do not flow
  through signup → onboarding. No real-customer impact.
- **Recommendation:** out of Sprint 1 scope (launch-blocking only). If ever desired, align
  the predicate to `jwtToken ?? apiKey` — defer to Sprint 2.

### F2 — "Skip setup for now →" permanently completes onboarding · *Minor UX, non-blocking*
Both the primary "Go to your dashboard" button and the "Skip setup for now" link invoke the
same `completeOnboardingAction` (`getting-started/page.tsx:188-208`), which sets
`onboardingCompleted = true`. So "skip" is permanent — the checklist will **not** reappear,
despite the "for now" wording.
- **Why not blocking:** behaviour (don't re-nag) is arguably desirable; only the copy is
  slightly misleading. No functional break.
- **Recommendation:** Sprint 2 polish — either drop "for now" from the label, or make skip a
  true dismiss that does not mark completion. Not fixed here (scope discipline).

### F3 — `/getting-started` has no entitlement guard · *Observation, low*
The page gates on session + `onboardingCompleted` only, not entitlement
(`getting-started/page.tsx:58-64`). A non-Platform user who navigates **directly** to the URL
sees Platform-tier steps; CTAs then route to platform routes that may themselves gate access.
- **Why not blocking:** the natural entry (`/verify-email`) already routes only `premium`
  users here (C6); direct nav is an edge case and pre-existing.
- **Recommendation:** none for launch; revisit if/when onboarding is opened to more tiers.

---

## 4. Validation

- Onboarding/auth-flow unit tests: **23/23 pass** — `onboardingProgress` (6), `signupValidation` (7), `authReturnLink` (6), `billingPortalSubmit` (4).
- Full app type surface clean (root `tsc -p tsconfig.ci.json`); app `next build` exit 0 (run during A4).
- All 5 step-CTA routes confirmed present on disk.

## 5. Conclusion

The new-customer onboarding flow is **correct, honest, and navigable** for the launch
audience (Platform Professional signups). A2 closed the silent-typo lockout, A3 made the
progress bar honest, A4 added an escape hatch on auth pages. The three findings above are
non-blocking observations/polish, explicitly **deferred** to keep Sprint 1 launch-blocking-only.

**A5 verdict: PASS. No code changes required for go-live.**
