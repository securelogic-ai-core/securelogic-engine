# Assessment Composition v1 — staging validation record, 2026-09-04

> **Status: PASS at develop `4a4729fa`** (staging engine + app), after the three
> deployed-browser findings of the first pass were fixed in narrow PRs, merged
> normally, deployed at exact SHA, and every run repeated. The first pass at
> `3e19ae48` is kept below as history; "fixed-and-retested" and "outstanding"
> are labelled as such.

**Claim:** on staging, through the product paths a customer uses, SecureLogic
composes a vendor assessment from the relationship's facts (Core Assurance Set
v1, corpus 1.2.0), explains what it will and will not ask and why, issues the
questionnaire to a directory contact with an invitation SecureLogic itself
sends, and the vendor answers through the portal into the existing lifecycle.

## 1. Final runs — develop `4a4729fa`

Staging engine `srv-d7n0rju8bjmc738jbs7g` live on `4a4729fa`; staging app
(`/api/version`) `4a4729fa`; converged 2026-09-04 19:30Z.

| Run | Result |
|---|---|
| `assessment-composition-hydration-probe.mjs` (strict: any console/page error on login → engagement is a FAIL), engagement `d7173d50` (issued) | **PASS** en-US/UTC and de-DE/Pacific-Auckland, `expires 2026-10-04`, 0 errors |
| Two-browser login check (Chromium + WebKit): one `…/api/sso/check-domain` request, exactly one slash, zero errors | **PASS** both |
| `assessment-composition-staging-e2e.sh` (engine, public API) | **41 PASS / 0 FAIL** |
| `assessment-composition-staging-journey.mjs chromium` — **default 12 s pacing**, the pacing that hit the limiter on the first pass | **33 PASS / 0 FAIL** |
| `assessment-composition-staging-journey.mjs webkit` — default pacing | **33 PASS / 0 FAIL** |
| Engine 429 responses 19:12Z–19:41Z (convergence through both journeys) | **0** |
| `GET /vendors/:id/framework-progress` reads in that window / per-framework `requirements?assessment_type=vendor` reads | **10 / 0** |

The journeys exercise the deployed workflow end to end: sign-in, vendor,
relationship, directory contact, factual intake → classification, engagement
from the relationship, a dropped compose request refused in the panel, the
composition with all 16 objectives and their explainability, recipient
selection with the primary contact suggested, invitation sent from SecureLogic,
delivery state and due date persisted, resend from the invitation block issuing
a new link, **the old token refused (401) at `/api/vendor-portal/session`**,
the vendor's portal session, the 79-question composed questionnaire, every
question answered and submitted, the customer seeing Submitted with responses
readable, and engine cross-checks (delivery sent with provider message id,
invite bound to the contact, snapshot on rules 1.2.0).

## 2. The three findings — root cause, fix, retest

### 2.1 Hydration error #418 on the engagement page — FIXED (#1000), RETESTED PASS

**Root cause.** The invitation block, a client component that is also
server-rendered, formatted the link expiry with `toLocaleDateString()`; the
composition header and the send flow's sent step did the same. When the
browser's locale or timezone differs from the server's, the hydrated text
differs and React throws #418. Playwright's default context is en-US/UTC —
the server's shape — which is why the journey never saw it; the probe's
second context (de-DE / Pacific/Auckland) reproduced it every time at
`3e19ae48` (`expires 5.10.2026` vs the server's `10/4/2026`).

**Fix.** PR #1000 (`85de9216` → develop `55d48960`): ISO calendar dates in all
three places, with a regression test that asserts the ISO form and rejects the
locale forms.

**Retest.** Probe PASS in both contexts at `55d48960` and again, strict, at
`4a4729fa`.

### 2.2 Login page SSO check — TWO root causes, FIXED (#1002, #1004), RETESTED PASS in WebKit and Chromium

**Root cause A — the URL.** The staging app's build-time
`NEXT_PUBLIC_ENGINE_URL` ended in `/` and `login/page.tsx` built
`${ENGINE_URL}/api/sso/check-domain` verbatim → `https://<engine>//api/…`.
**Fix:** PR #1002 (`b0677f16` → `a8047e74`): `lib/engineBaseUrl.ts`
(`normalizeBaseUrl`, `joinEngineUrl` = exactly one slash at the boundary,
`engineBaseUrl()` / `browserEngineBaseUrl()`), applied to the login page, the
API layer's SSO check, the session probe and the 127 identical server-side
definitions; the login check carries a 5 s abort and its failure path is
explicitly "no SSO offered". Regression tests cover a base with and without a
trailing slash (same base, one-slash SSO URL) and a rejected/CORS-style fetch
leaving the password form standing with no unhandled rejection. The
staging-only env value was corrected (no trailing slash); production
configuration untouched.

**Root cause B — CORS, found only after A was deployed.** With the slash gone
the request still failed: `Origin https://securelogic-app-staging.onrender.com
is not allowed by Access-Control-Allow-Origin. Status code: 200`. The engine's
allowlist was a hard-coded set of the three production origins; the staging
engine runs with `isDev=false`, like production, so it had never allowed its
own staging app — the double slash had masked it. **Fix:** PR #1004
(`483e3f83` → `4a4729fa`): `lib/corsOrigins.ts` allows the production
origins plus the exact https origin of the deployment's own `APP_BASE_URL`
(already `https://app.securelogicai.com` in production, so the production
allowlist is byte-identical, asserted by test). No wildcard.

**WebKit note.** At `a8047e74` WebKit still reported the CORS-refused fetch as
a page error even though the call is wrapped in try/catch and the page
recovered — WebKit surfaces an access-control refusal at page level. The
verification standard is therefore *no error at all*, which the CORS fix
achieves: **Chromium 0 errors, WebKit 0 errors, one single-slash request** at
`4a4729fa`.

### 2.3 Rate limiter vs. page fan-out — FIXED (#1003), RETESTED PASS at default pacing

**Exact fan-out (measured on staging from engine logs; identical for a curl
server render and a Chromium render of `/vendors/[id]`):** 2 session-bridge
calls (`/auth/me`, `/me`), 8 page reads (vendor, assessments, reviews,
findings, signals, ai-systems, contacts, relationships), 1 assurance-docs
read, `GET /frameworks` + one `GET /frameworks/:id/requirements?assessment_type=vendor&subject_id=…`
**per activated framework** (6 on the validation org), and 1 client-side
history fetch = **18 per render, growing with every activated framework**.
`createApiKeyRateLimiter(120)` is mounted on all of `/api` and hashes the raw
bearer — the user's JWT on the app path — so the budget is 120 calls/min per
signed-in user. Every server action on the page (`router.refresh()`) is
another full render. The first pass's journeys at 3 s and 12 s pacing died
here: 16 × 429 in one second, then `getVendor` collapsed the 429 to null and
`page.tsx` redirected to `/vendors` ("vendor gone"), which itself 429'd.

**Correction (no limiter change, no first-party bypass).**
- `GET /api/vendors/:id/framework-progress` — one tenant-scoped query
  returning, for every framework of the caller's org where THIS vendor has at
  least one recorded response, exactly the summary the requirements route
  computes; same guard chain as the two reads it replaces; vendor ownership
  checked first (404, no hint); classified deny-all for Contributors like
  those reads. The page reads it once. **Per render 18 → 12, independent of
  framework count.**
- `getVendorDetail` returns an outcome: 401/403/404 keep the tenant contract
  (redirect, render nothing); 429/5xx/timeout render the standard
  `UnavailableNotice` on the vendor page with a retry — never a redirect.

**Regression coverage.** Isolation (8): aggregate summary equals the
requirements-route summary byte-for-byte; a stored `not_assessed` does not
"start" a framework; same-org vendors never share responses; cross-org 404
both ways; org B's read never carries an org A framework. App (7): six started
frameworks → one aggregate call and zero per-framework reads; ≤ 10 page reads
per render; **a realistic minute of the onboarding workflow (5 renders + 3
actions plus the measured session-bridge and client-side calls) stays under
120**; unavailable → notice + retry, no redirect; not-found → redirect.

**Retest.** Chromium journey 33/33 and WebKit journey 33/33 at the script's
default 12 s pacing, **zero 429 responses** on the engine across the window,
10 aggregate reads, 0 per-framework reads.

## 3. What was NOT changed

Rate-limit semantics, the limiter's key or value, the questionnaire's
per-framework requirements read, `engagementStateMachine`, the tenant
contract of the vendor page for a record the caller may not see. Production:
no code promoted, no configuration touched, no flag changed, Vendor Assurance
not activated.

## 4. Open items for the owner (manual validation, not blockers of this PASS)

1. **Production CORS for a future non-production-hostname app is now
   configuration-driven** (`APP_BASE_URL`); production's own value already
   resolves to an allowed origin, so nothing changes there. Worth a glance at
   promotion time.
2. **The two session-bridge calls per render** (`/auth/me`, `/me`) are outside
   this package and still count against the per-user budget; a busy analyst
   is now at ~12 renders/min headroom rather than ~6. Not a defect today.
3. **Journey runs at 3 s pacing** remain an abuse shape, not a person; the
   script's default (12 s) is the realistic standard and now passes.

## 5. History — first pass at develop `3e19ae48` (superseded)

| Run | Result |
|---|---|
| engine harness | 41 / 0 |
| Chromium journey (30 s pacing to survive the limiter) | 33 / 0 |
| WebKit journey (30 s pacing) | 33 / 1 — the login-page SSO fetch, finding 2.2 |
| hydration probe | FAIL by design in de-DE/Pacific-Auckland (React #418), finding 2.1 |
| Chromium journeys at 3 s and 12 s pacing | died at 429 → redirect to /vendors, finding 2.3 |

PRs: #999 (Assessment Composition v1), #1000 (hydration), #1001 (this record's
first version + harness extensions + probe), #1002 (engine base URL), #1003
(framework-progress aggregate + 429 page state), #1004 (CORS own app origin).
