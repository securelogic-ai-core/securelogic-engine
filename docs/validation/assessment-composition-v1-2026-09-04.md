# Assessment Composition v1 — staging validation record, 2026-09-04

> **Status: OUTSTANDING — not PASS.** By owner ruling, Assessment Composition v1
> is not marked PASS until the deployed-browser issues in §3 are fixed, deployed to
> staging at an exact SHA, and every run below is repeated. This is the interim
> record; the final evidence replaces this notice.

**Claim:** on staging, through the product paths a customer uses, SecureLogic
composes a vendor assessment from the relationship's facts (Core Assurance Set
v1, corpus 1.2.0), explains what it will and will not ask and why, issues the
questionnaire to a directory contact with an invitation SecureLogic itself
sends, and the vendor answers through the portal into the existing lifecycle.

## SHAs and runs

| Surface | SHA on staging | Run | Result |
|---|---|---|---|
| engine (`srv-d7n0rju8bjmc738jbs7g`, deploy `dep-dadd8jijnfac73efd0qg`) | develop `3e19ae48` (#999) | `scripts/validation/assessment-composition-staging-e2e.sh` | **41 PASS / 0 FAIL** |
| app (`/api/version`) | develop `3e19ae48` | `scripts/validation/assessment-composition-staging-journey.mjs chromium` | **33 PASS / 0 FAIL** |
| app | develop `3e19ae48` | `… journey.mjs webkit` | **33 PASS / 1 FAIL** — the one failure is finding §3.3 (login-page SSO fetch), not the package |
| app | develop `3e19ae48` | `scripts/validation/assessment-composition-hydration-probe.mjs` | **FAIL by design at this SHA** (see §3) |

Migrations on staging include `20261088` (Core Assurance identity) and
`20261089` (invite delivery columns). `SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED`
is `true` on the staging engine only; production is `false` and untouched.
Validation tenant: `[SEED] Walkthrough Org`; every vendor created is uniquely
stamped and archived by the harness.

## 1. What the engine harness proved (public API, as a customer would call it)

Relationship intake (owner scenario) → Critical / High / `tier_1_critical` →
engagement opened from the relationship → **composed under scope-rule 1.2.0**:
all 16 Core Assurance objectives decided, 79 items asked, snapshot readable at
`GET /vendor-engagements/:id/composition` with per-objective outcome AND
customer-facing rationale, the S4 coverage dual-read recorded on the snapshot,
the Core Assurance Set provisioned into the tenant library, re-composition from
unchanged inputs **reproducing the same hash**, history appended.

Two counter-cases that give the composition its meaning:

- **nominal relationship** (catering): 16 not applicable, no questionnaire
  required, issuance refused `422 empty_scope`;
- **low-exposure relationship** (new step 4b this session): `tier_4_low`,
  **12 of 16 objectives apply, 4 not applicable each carrying its reason**, the
  12 asked at **attest** depth.

Issuance: to a directory contact with a composed message and due date;
credential minted once; **invitation SENT from SecureLogic** (provider
accepted, provider message id recorded through the `email_sends` join);
engagement read shows delivery state and carries **no token material**; a
second issue is refused. Portal: link exchanged → due date shown → the composed
79 items, Core Assurance objectives asked → vendor answers → customer sees the
link opened and the answer arriving. Re-issue to another contact supersedes the
prior credential (old link dead), history preserved; revoke revokes access and
keeps history.

## 2. What the browser journey proved (real UI, Chromium and WebKit)

Sign in → vendor created (no criticality asked) → relationship added → contact
added → **factual intake recorded in the UI, classification derived** →
engagement opened from the relationship → page names the relationship →
"Not composed yet" → **a dropped compose request is refused in the panel, page
intact** (new step 7a: the transport-failure class that crashed VO 2.0) →
composed: all 16 objectives, explainability chips, applicable domains,
additional requirements with reasons → recipient picker lists the directory
contact, primary suggested, invitation addressed by first name → **sent from
SecureLogic (UI)**, secure link shown once as recovery → status and due date
persisted → **resend from the Invitation block issues a new link and the old
link no longer exchanges (401)** (new step 8b) → vendor side: link exchanged,
79 questions rendered, objectives asked, every question answered, submitted →
customer: state Submitted, responses readable; engine cross-checks (delivery
sent with provider id, invite bound to the contact, snapshot on rules 1.2.0).

## 3. What this validation FOUND

1. **Hydration defect on the engagement page at `3e19ae48` — reproduced, and
   scoped precisely.** `assessment-composition-hydration-probe.mjs` opens an
   *issued* engagement in two browser contexts. `en-US`/`UTC` (which matches
   the server) renders `expires 10/4/2026` with **zero** errors — which is why
   the journey passes: Playwright's default context IS en-US/UTC and the journey
   listens for thrown page errors only. `de-DE`/`Pacific/Auckland` renders
   `expires 5.10.2026` and throws **React #418**. Any customer whose browser
   locale or timezone differs from the server's hits it. **Fix = PR #1000**
   (`85de9216`, CI 8/8, mergeable, base develop): ISO calendar dates in the
   panel, the send flow and the composition header. **Merged 2026-09-04 as develop `55d48960`** after the owner's ruling; the
   probe is the acceptance check to re-run once staging converges on that SHA
   (result recorded in the final update of this record).
2. **Rate limiter vs. app fan-out — pre-existing, platform-level, not fixed
   here.** Engine logs show one `/vendors/[id]` render costs **25–31 engine
   calls** from the app server. `createApiKeyRateLimiter(120)` is mounted on
   all of `/api` and keys on the raw `Authorization` bearer — on the app path
   that is the **user's JWT**, so the budget is **120 calls/min per signed-in
   user, about four vendor-page renders a minute**. Server actions
   `router.refresh()` (another render). Two journey attempts at 3 s and 12 s
   pacing died exactly here: 16 × `429` in one second at 17:49:46Z, after which
   `getVendor` returned `null` and `vendors/[id]/page.tsx:924` redirected to
   `/vendors` ("vendor gone"), which itself 429'd into "Vendors couldn't be
   loaded right now". A person working relationship → contact → intake at
   ordinary speed can reach this. Evidence and options are in the memory note
   *app-fanout-vs-per-jwt-rate-limit*; needs an owner ruling (scope the limiter
   for first-party traffic, collapse the fan-out behind an aggregate read, or
   treat 429 distinctly in the app — not a harness problem). The 30 s pacing
   that made the journey pass is a workaround, recorded as such.
3. **Login page SSO domain check hits `…onrender.com//api/sso/check-domain`
   (double slash) and fails the browser's access-control check on every load.**
   `app/src/app/login/page.tsx:56` concatenates `${ENGINE_URL}/api/…` with no
   normalisation, and the app-staging `NEXT_PUBLIC_ENGINE_URL` (build-time)
   evidently ends in `/`. Chromium logs a console error; **WebKit raises it as an
   unhandled page exception** (the WebKit journey's single FAIL). The check
   fails open to the password form, so sign-in works. Two fixes, both small:
   strip a trailing slash where `ENGINE_URL` is read, and correct the staging
   env value (needs an app rebuild — `NEXT_PUBLIC_*` is baked). Not part of this
   package; recorded so it is not rediscovered.

## 4. Boundaries reasserted

One resolver, one corpus; applicability decided on facts only and recorded with
its reason; the snapshot is append-only and hash-reproducible; tokens never
leave the issuance response; revocation is authoritative in the portal
middleware; production is untouched (flag `false`, `main` at `2340bad4`).

## 5. Scope discipline

No merge, no promotion, no production change, no Blueprint sync, no flag
change. The only writes were to the staging validation tenant (harness vendors,
archived) and to `delivered@resend.dev`.
