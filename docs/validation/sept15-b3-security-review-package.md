# Stop Gate B.3 — Independent Security Review Package: Vendor Portal Surface

Prepared: 2026-08-28 against `develop@5517caaf` (staging app self-reports this
commit; staging engine deployed from the same branch).
Audience: the **independent security reviewer** (a person who did not build
this surface). Internal expectations and file pointers are included on purpose.
Owner hand-off steps are in §7.

Gate definition (from `docs/validation/sept15-stop-gate-b-progress.md`):
B.3 = "Independent security review of the portal surface". Engineering has
passed B.1, B.2, B.5, B.6, B.7. B.3 and B.4 are human records that no test can
produce. This document is the brief for B.3.

---

## 1. Scope

### 1.1 What is in scope

The **external vendor portal**: the only part of the platform reachable by a
principal that has no platform account. A customer organisation issues a
questionnaire to a third-party vendor; the vendor receives a link, exchanges it
for a session, answers questions, attaches documents, exchanges clarification
messages, and submits.

| Layer | Component | Pointer |
|---|---|---|
| Engine routes (11) | `POST/DELETE /api/vendor-portal/session`, `GET /engagement`, `GET /questions`, `PUT /questions/:requirementId`, `POST /submit`, `POST/GET /evidence`, `DELETE /evidence/:evidenceId`, `GET/POST /comments` | `src/api/routes/vendorPortal.ts` (router wiring at :1245–1320; mount at `src/api/routes/index.ts:509`) |
| Session middleware | invite → session resolution, DB-backed rate limit, fingerprint drift | `src/api/middleware/requirePortalSession.ts` |
| Token model | invite token, session token, TTLs, cookie options | `src/api/lib/vendorPortal/portalTokens.ts` |
| Kill switch | `SECURELOGIC_VENDOR_PORTAL_ENABLED === "true"` else 404 | `src/api/lib/vendorPortal/vendorPortalFeatureFlag.ts` |
| Upload policy | per-file, per-engagement byte and count budgets, comment limits | `src/api/lib/vendorPortal/portalUploadPolicy.ts:35–55` |
| File validation | MIME allowlist + magic-byte check + filename neutralisation | `src/api/lib/evidenceFileValidation.ts:63–86` |
| Blob storage | Cloudflare R2 via `putEvidenceFile` / `deleteEvidenceFile` / `evidenceObjectKey` | `src/api/lib/evidenceStorage.ts`, config in `src/api/lib/blobStorageConfig.ts` |
| State machine | which transitions a `portal` actor may cause | `src/api/lib/vendorRisk/engagementStateMachine.ts` (`isPortalWritable`, `isPortalRespondable`, `isPortalCommentable`, `canTransition`) |
| Invite minting (internal side) | `POST /api/vendor-engagements/:id/issue` | `src/api/routes/vendorEngagements.ts:803–920`, chain at :2088–2126 |
| Schema | `vendor_engagement_invites`, `vendor_portal_sessions`, `vendor_engagement_comments` (RLS), `evidence` additive columns | migration `20260925` (grep `db/migrations` for it) |
| App (Next.js) portal screens | `/portal`, `/portal/accept/[token]`, `/portal/questionnaire`, `/portal/evidence`, `/portal/clarifications`, `/portal/review`, `/portal/done` | `app/src/app/portal/**` |
| App same-origin proxy | `/api/vendor-portal/[...path]` → engine, credential-free by design | `app/src/app/api/vendor-portal/[...path]/route.ts` |
| Audit | 7 portal event types | `vendorPortal.ts` lines 209, 244, 504, 587, 853, 1014, 1168 |

### 1.2 What is out of scope for B.3

- The internal (authenticated) Vendor Assurance workflow, except where it
  mints the invite (`/issue`) or consumes vendor-authored content.
- The Intelligence Brief, Ask, billing, SSO.
- Production. The portal is **dark in production** (`/api/vendor-portal/session`
  → 404 there, verified 2026-08-28). All work is against staging.

---

## 2. Trust-boundary statement

Quoted from the route file header (`src/api/routes/vendorPortal.ts:1–35`),
which is the engineering claim you are asked to attack:

> EVERY ROUTE IN THIS FILE IS REACHABLE WITHOUT A PLATFORM ACCOUNT.
>
> INVARIANT 1 — no route accepts an identifier from the caller. Not
> organization_id, not vendor_id, not engagement_id, not user_id. Every
> identifier comes from `req.portalContext`, which requirePortalSession
> resolved from the session ROW.
>
> INVARIANT 2 — the session is scoped to exactly ONE engagement. There is no
> route that lists engagements, vendors, or anything belonging to the
> organisation at large.
>
> INVARIANT 3 — writes stop at submission.
>
> INVARIANT 4 — the flag is a real kill switch. Off means 404 before any
> handler runs, and revoking sessions is one UPDATE.

Supporting claims from `requirePortalSession.ts:1–35`:

- Org and engagement come from the session row, never from the request.
- Session resolution runs on the **elevated** DB channel (`pgElevated`) because
  it precedes org context; everything after runs inside `withTenant(orgId)`.
- `req.portalContext` and `req.organizationContext` are structurally disjoint:
  a portal session cannot reach a normal API route and an org API key cannot
  reach a portal route.
- Rate limiting is DB-backed (counter on the session row) so a Redis outage
  does not remove the only limit on a public endpoint.

Design decisions the reviewer should know (from the gate document §4):

- **The portal is metadata-only.** No download route, no signed URL. A test
  asserts no response body carries a URL or storage key.
- **Withdrawal is a hard delete; the audit row (filename, size, SHA-256) is the
  survivor.** Row first, blob second.
- **Comment bodies and answer notes are stored verbatim** (not escaped, not
  stripped). The renderer is the sanitisation boundary. This is a deliberate
  **prompt-injection ingress point** so that the downstream analysis layer can be
  evaluated against real injection attempts.
- **`visibility` defaults to `internal`** on comments; the portal read filters in
  SQL and a CHECK makes a vendor-authored internal-only row unrepresentable.
- The clarification thread stays open after submission (until
  `analysis_complete`); the write window (answers, uploads) closes at
  `submitted`.

---

## 3. Token, session and storage model (facts, with pointers)

| Property | Value | Pointer |
|---|---|---|
| Invite token | 32 random bytes, hex (`crypto.randomBytes(32)`); only SHA-256 stored (`invite_token_hash`) | `portalTokens.ts:54–66` |
| Invite TTL | **30 days** | `portalTokens.ts:40` |
| Invite returned | once, in the `/issue` JSON response; never in audit payload; no email is sent by the platform | `vendorEngagements.ts:869–917` |
| Invite link shape | `https://<app-origin>/portal/accept/<token>` (built client-side) | `app/src/lib/vendorEngagements.ts:305–312` |
| Exchange | `POST /api/vendor-portal/session {token}` → httpOnly cookie `sl_vendor_portal`; `expired` → 410 (actionable), `revoked`/`not_found` → 401 indistinguishable | `vendorPortal.ts:96–215` |
| Exchange side effect | `issued → in_progress` only when `from === "issued"` (opening a link during `clarification_requested` does **not** resume it) | `vendorPortal.ts` ~:180–200 |
| Session token | separate random token; only hash stored; idle TTL **12 h** sliding, absolute TTL **7 days** | `portalTokens.ts:50–51, 97–110` |
| Cookie | `httpOnly`, `secure` in production only, `sameSite=lax`, `path=/api/vendor-portal`, `expires=absolute` | `portalTokens.ts:171–196` |
| Rate limit (sessioned) | 120 req/min per session, enforced in DB | `requirePortalSession.ts:49` |
| Rate limit (exchange, unsessioned) | only the **global** express-rate-limit: 300 req/min per client IP + slow-down after 100 | `src/api/app.ts:278–296`; no portal-specific limiter on `/session` |
| Fingerprint | user-agent hash + IP recorded; drift is **flagged** (`fingerprint_changed_at`) not blocked | `requirePortalSession.ts:160–180` |
| Sign-out | `DELETE /session` sets `revoked_at`; replay refused | `vendorPortal.ts:~220–250` |
| Upload cap | 25 MiB per file, 1 file per request (multer, memory storage) | `portalUploadPolicy.ts:35`, `vendorPortal.ts:1197–1200` |
| Engagement budgets | 250 MiB and 100 files per engagement, bind before the org-wide 2 GiB cap | `portalUploadPolicy.ts:42–49` |
| Allowed types | PDF, PNG, JPEG, TXT, CSV, DOCX, XLSX, PPTX (magic bytes checked where a magic exists; OLE legacy Office rejected; ZIP stored as a container, not decompressed) | `evidenceFileValidation.ts:63–86` |
| Comments | ≤ 8000 chars, ≤ 500 per engagement | `portalUploadPolicy.ts:52–55` |
| Storage | R2 object key from `evidenceObjectKey` (org-scoped); the vendor never receives a key or URL | `evidenceStorage.ts` |
| Kill switch | flag off → 404 on every route; plus `UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;` to drop live sessions | gate doc §5 |
| Audit | `vendor_portal.session.created / session.ended / response.saved / submitted / evidence.uploaded / evidence.withdrawn / comment.posted`, each with invite id and engagement id | `vendorPortal.ts` |

---

## 4. What engineering has already tested

Two isolation suites run against a real Postgres (R2 client stubbed only in the
upload suite) plus one static test. A total of 71 adversarial cases. You are
not asked to repeat them; you are asked to find what they cannot see.

### 4.1 `test/isolation/vendorPortalAdversarial.test.ts`

Invite exchange
- valid invite yields a session and the raw token is never echoed
- cookie is httpOnly and path-scoped to the portal API mount
- cookie value is not the invite token
- unknown token refused; malformed/missing token refused without a stack trace
- revoked invite refused indistinguishably from unknown
- expired invite says so (410) — actionable, not a useful oracle
- exchange is recorded on the invite for audit

Session reaches exactly one engagement
- org A's session sees org A; never sees org B; org B sees only its own
- another engagement's id supplied as a parameter changes nothing
- response never leaks internal risk data to the vendor

Session credentials
- no cookie refused; forged cookie refused
- revoked session stops immediately (kill switch)
- sign-out revokes so the cookie cannot be replayed
- session token never stored raw — DB holds hashes only

Flag is a real kill switch
- OFF 404s every route including the exchange; OFF is the default; ON restores with no data change

IDOR sweep
- vendor sees only their engagement's questions (both directions)
- answering another engagement's requirement by id refused
- not-in-scope indistinguishable from does-not-exist
- an answer is never written under another org

Structured answers
- free text without a structured answer rejected; answer outside `pass|partial|fail|not_applicable` rejected; each legal answer records a revision

State machine
- submit with required question unanswered refused
- submit when complete → `submitted`
- post-submit writes refused
- edit during `clarification_requested` saves and resumes
- double submission refused
- vendor cannot drive the engagement past `submitted`

Two auth worlds cannot mix
- portal session cannot reach a normal authenticated API route
- org API key cannot drive a portal route

### 4.2 `test/isolation/vendorPortalUploadAdversarial.test.ts`

Multipart exemption
- multipart with no session → 401 (not 415, not 201); forged cookie → 401
- anonymous multipart writes no row and no blob
- other portal routes still 415 a multipart body; evidence route refuses non-multipart

File content
- accepts a legitimate PDF; rejects PNG-claiming-PDF; rejects off-allowlist type; rejects legacy OLE Office; rejects binary smuggled as text/plain
- over-size rejected before the handler
- traversal filename neutralised and never in the object key
- ZIP stored without decompression
- no row and no blob when the storage write fails

Engagement budget
- byte budget exhausted → refused; file-count exhausted → refused
- a full engagement does not block the org or another vendor
- withdrawing returns budget

Authorization
- vendor cannot see or delete the org's internally-uploaded evidence
- session cannot delete another tenant's attachment; list shows only own engagement
- `organization_id` / `engagement_id` in the multipart body ignored
- cannot anchor an attachment to another engagement's requirement
- there is no download route (metadata-only, no URL/key in any body)
- kill switch 404s every new route

Write window
- uploads and withdrawals refused once submitted
- upload during `clarification_requested` resumes; merely opening the link does not; a comment does not
- comment thread stays open after submission

Clarification thread
- never returns an internal-visibility comment to the vendor
- DB refuses vendor-authored internal-only comment; refuses dual attribution (user + invite) on comments and on evidence
- vendor's own message marked as theirs; reviewers anonymous
- session cannot read another tenant's thread
- hostile text stored verbatim, never executed or reflected (server-side assertion)
- empty message refused

Audit and downstream
- upload, withdrawal, message recorded with invite and engagement
- submission enqueues one durable evidence-analysis job per stored file; withdrawn files skipped; submission never fails on it

### 4.3 `src/api/__tests__/vendorPortalStaticInvariants.test.ts` (B.2)

- for each of `organization_id`, `vendor_id`, `engagement_id`, `user_id`, `invite_id`, `session_id` (and variants): the route file never reads it from body, query or param
- the only source of org and engagement is `portalContext`
- every route is behind the flag AND the session resolver
- no route hands out a storage key or signed URL
- `visibility` is never taken from the request

Also: `portalUploadPolicy.ts` has 17 unit tests; app-side render tests exist
under `app/src/app/portal/__tests__/`.

---

## 5. What is explicitly NOT yet tested — where to look hardest

The gate document itself says: *"B.3's reviewer should look hardest at exactly
that seam: browser-enforced behaviours the test harness bypasses."* Two defects
were found only by building the screens (cookie path mismatch; edits refused
during clarification). Concretely untested or only partially covered:

1. **Browser-enforced behaviour.** Supertest sets cookies manually. Nobody has
   proven in a real browser: cookie path scoping under the app proxy; `SameSite=lax`
   semantics on the top-level navigation from the emailed link; whether `secure` is
   correctly true on staging (it is `isProduction`-gated — check what staging sets).
2. **CSRF on the same-origin proxy.** Every write is a cookie-authenticated
   POST/PUT/DELETE proxied by the app. There is no CSRF token; the defence is
   `SameSite=lax` + JSON/multipart content-type. Verify a cross-site form post
   cannot save an answer, upload, comment, or submit.
3. **Token handling in the browser.** `/portal/accept/[token]` puts the raw invite
   token in the URL. The client exchanges it and `router.replace("/portal")`. Check:
   browser history, `Referer` leakage to any third-party asset on that page, server
   logs of the app tier (see memory note: reset/verify tokens in URL query are logged
   cleartext by the APP tier — does the same apply to this path segment?), CDN/Render
   access logs.
4. **Exchange endpoint brute force.** `/api/vendor-portal/session` has no
   portal-specific limiter — only the global 300/min/IP limiter. The token is 256-bit
   so online guessing is infeasible; the question is whether the global limiter is
   keyed on the real client IP behind Cloudflare/Render (`src/api/infra/clientIp.ts`)
   and whether it can be bypassed with header spoofing.
5. **Rendering of verbatim content.** Hostile comment bodies and answer notes are
   stored verbatim by design. The server test proves they are not reflected; nobody
   has proven the **app renderer** (portal pages AND the internal reviewer pages
   `app/src/app/vendor-engagements/[id]/**`) escapes them. Test stored XSS both
   directions: vendor → internal reviewer, reviewer → vendor.
6. **Prompt-injection boundary (AI1-7, tracked open).** Vendor-authored notes,
   comments and document contents feed an LLM evidence-analysis worker after
   submission. The injection-boundary test does not exist yet. If you can reach the
   worker output on staging, attempt instruction injection via a comment, an answer
   note and a PDF; record what the analysis produced.
7. **Malware posture.** There is no AV scanning. Uploads are magic-byte checked and
   stored as-is in R2; ZIPs are stored as containers. Documents are later opened by
   the extraction worker. Assess the risk and whether polyglot files pass the checks.
8. **Storage scoping.** `evidenceObjectKey` is org-scoped; R2 credentials on staging
   are shared across the engine. Confirm an object key cannot be influenced by the
   vendor (filename is neutralised — verify) and that the audit row/blob lifecycle
   cannot be desynchronised by a concurrent withdraw + upload.
9. **Security headers on `/portal/*`.** CSP, frame-ancestors, referrer-policy on the
   external pages have not been reviewed separately from the app's defaults.
10. **Information disclosure in the thin responses.** The engagement read returns
    the customer organisation name and engagement title; comment authors are
    anonymised. Check every field in `GET /engagement`, `/questions` (rule trace
    "why we're asking"), `/evidence`, `/comments` for anything a vendor should not
    learn (internal reviewer identity, risk ratings, other vendors, framework
    licensing content).
11. **Fingerprint drift is flagged, not blocked.** A stolen session cookie works from
    any IP/UA for up to 12 h idle / 7 d absolute. Decide whether that is acceptable
    for the data class involved.
12. **Invite lifecycle edge cases.** Re-issuing an engagement; multiple invites per
    engagement; a withdrawn invite with a still-live session; the vendor contact
    email being wrong (there is no email-address binding at exchange — possession of
    the link is the whole credential).
13. **Elevated-channel usage.** Five `pgElevated` sites (invite lookup, session
    insert/resolve, rate-limit write). Confirm each is limited to the pre-context
    step and none can be reached with attacker-influenced SQL parameters beyond the
    hashed token.
14. **DAST has not been run** (SECURITY-VALIDATION-1 not started; `app/` has 6 HIGH
    npm advisories, see `docs/validation/sept15-truth-ledger-2026-08-28.md` item 20).
    A ZAP/Burp pass over `/portal/*` + `/api/vendor-portal/*` would be new evidence.

---

## 6. Staging access and rules of engagement

### 6.1 Hosts

| Surface | URL | Notes |
|---|---|---|
| App (portal UI + same-origin proxy) | `https://securelogic-app-staging.onrender.com` | `/portal/*`, `/api/vendor-portal/*`; `GET /api/version` shows the deployed commit |
| Engine (API) | `https://securelogic-engine-staging.onrender.com` | `/api/vendor-portal/*` directly (cookie path is `/api/vendor-portal` on either origin) |

Both have `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true` and
`SECURELOGIC_VENDOR_PORTAL_ENABLED=true` (verified 2026-08-28: junk token →
401 `portal_link_invalid`, not 404).

### 6.2 What you will be given

1. **A vendor-side invite link** (`/portal/accept/<token>`), valid 30 days. This is
   the external principal. You may exchange it, sign out, and ask for it to be
   re-issued as often as needed.
2. **A second invite link for a second, unrelated engagement** so cross-engagement
   tests have a real target on the other side. (The owner should issue this on a
   different vendor; the platform's isolation is per engagement, not per vendor.)
3. **Optionally, a read-only internal reviewer login** on the staging tenant
   `[SEED] Walkthrough Org`, so you can observe what the customer side sees of your
   vendor-authored content (needed for items 5 and 6 above). The owner decides
   whether to grant this; if granted it is a staging-only account on seed data.

You will **not** be given database access, Render access, R2 credentials, or any
production credential. Findings that need DB confirmation are confirmed by the
owner on request.

### 6.3 Rules of engagement

- **Staging only.** Production returns 404 on every portal route; do not probe it.
- **No real vendor data.** Upload only synthetic documents. Everything you send
  becomes rows in a shared staging database and objects in a staging bucket.
- **Rate limits are real:** 120 req/min per portal session (429), 300 req/min per
  IP globally with slow-down after 100. Do not run volumetric tests; note the limits
  and test whether they are correctly keyed instead.
- **Do not attempt to reach other staging tenants' data through any non-portal
  route.** Cross-tenant attempts are in scope only through the portal surface and the
  two engagements you are given.
- **Do not upload live malware.** EICAR is acceptable if you wish to test AV posture.
- Tell the owner before any test that could leave the staging tenant in a broken
  state (e.g. exhausting the 100-file budget). It is resettable, but it is shared
  with other validation work.
- Staging email is isolated; you will not trigger mail to third parties from the
  portal (the platform sends no email on invite; the owner emails you the link).

### 6.4 Timebox

Suggested 2–3 days of effort. Deliver interim critical/high findings same day.

---

## 7. Owner hand-off steps (provisioning the reviewer)

The platform **does not email invites**. `POST /vendor-engagements/:id/issue`
returns the raw token once; the app builds the link and shows it once. The
owner copies it into an email to the reviewer.

**UI path (recommended)** — sign in to
`https://securelogic-app-staging.onrender.com` as
`walkthrough-approver@seed.securelogicai.test` (role admin; password in the
walkthrough-validation-tenant note) and:

1. `/vendor-engagements/new` → pick a vendor (e.g. *Harbourline Data Services*),
   fill all 12 intake fields (every field is required — a 400 lists what is
   missing), create.
2. On the engagement page: **Resolve scope** (moves `draft/scoping → scoped`; the
   org has *SOC 2 Type II* and *NIST CSF 2.0* frameworks, so the scope is non-empty).
3. **Issue to vendor** → enter the reviewer's email as `contact_email` → the
   panel shows the invite URL **once**. Copy it.
4. Repeat 1–3 on a **different vendor** for the second engagement.

**API path (equivalent)** — engine host, JWT login:

```bash
E=https://securelogic-engine-staging.onrender.com
TOK=$(curl -s -H 'content-type: application/json' \
  -d '{"email":"walkthrough-approver@seed.securelogicai.test","password":"<see memory note>"}' \
  $E/api/auth/login | jq -r .token)

# 1. create — all 12 intake fields required; allowed values are in
#    src/api/lib/vendorRisk/inherentRisk.ts:98-230
ENG=$(curl -s -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"vendor_id":"906991bb-eda0-44f2-9836-4932006d64b0","engagement_type":"initial",
       "title":"[B3] security review target",
       "data_sensitivity":"confidential","data_volume":"moderate","access_level":"read_write",
       "operational_dependency":"moderate","recoverability":"days","business_criticality":"medium",
       "regulatory_exposure":"moderate","ai_involvement":"none","ai_autonomy":"none",
       "hosting_model":"saas","fourth_party_exposure":"low","concentration":"low"}' \
  $E/api/vendor-engagements | jq -r .id)

# 2. resolve + freeze scope
curl -s -X POST -H "Authorization: Bearer $TOK" $E/api/vendor-engagements/$ENG/scope

# 3. issue — returns invite_token ONCE
curl -s -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"contact_email":"<reviewer email>","contact_name":"<reviewer name>"}' \
  $E/api/vendor-engagements/$ENG/issue
# link = https://securelogic-app-staging.onrender.com/portal/accept/<invite_token>
```

Notes: `regulatory_breach_notification` is required when regulatory exposure
is above `none` (see `validateIntake`, `vendorEngagements.ts:252–282`) — the UI
form handles this; on the API add the field if the 400 names it. The `/issue`
route refuses `draft`/`scoping` (409) and an empty scope (422).

**To revoke** a reviewer's access at any time:
`UPDATE vendor_engagement_invites SET revoked_at = NOW() WHERE contact_email = '<reviewer email>';`
and the session UPDATE in §3. To kill the whole boundary: set the flag to
`false` on the staging engine and redeploy (Render injects env at deploy, not
restart), then run the session UPDATE.

---

## 8. Deliverable format

A written report (markdown or PDF) with:

1. **Scope actually exercised** — routes, screens, browsers, tools, dates, the
   staging commit (`GET /api/version` on the app).
2. **Findings**, each with: ID; title; severity (**Critical / High / Medium /
   Low / Informational**, CVSS 3.1 vector optional); affected route/screen;
   reproduction steps against staging; evidence (request/response, screenshot);
   impact in terms of the trust boundary (which invariant in §2 it breaks, if any);
   recommended fix.
3. **Confirmed-safe list** — which of the §5 items you tested and found no issue in,
   so the gate record says what was covered, not only what was found.
4. **Not tested** — anything in §5 you did not reach, and why.
5. **Sign-off block** (§9).

Every finding will be filed into the platform's own Findings lifecycle
(`source_type = security_review`, or as an issue on the repository if the owner
prefers) and tracked to closure; Critical/High findings block portal activation.

---

## 9. Sign-off

```
Stop Gate B.3 — Independent security review of the vendor portal surface

Reviewer (name, organisation):          ______________________________
Independence statement: I did not author or review the code under test
before this engagement.                 [ ] confirmed
Staging commit reviewed (app /api/version): ___________________________
Dates of testing:                        ______________________________
Browsers / tools used:                   ______________________________

Findings summary:  Critical __  High __  Medium __  Low __  Info __
Items in §5 covered:  ___ of 14      Not covered: ___________________

Verdict on the trust-boundary statement (§2):
  [ ] holds as stated
  [ ] holds with the listed Medium/Low exceptions
  [ ] does not hold — see Critical/High findings

Signature: ____________________   Date: __________

Owner acknowledgement (SecureLogic AI): ____________________   Date: __________
Findings filed as: ______________________________________________________
```

Gate outcome: B.3 is **PASS** only when this block is signed, all
Critical/High findings are closed and re-verified by the reviewer, and the
signed record is committed under `docs/validation/`.
