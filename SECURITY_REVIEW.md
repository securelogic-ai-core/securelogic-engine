# SECURITY_REVIEW.md

**SecureLogic AI — Application Security Review (Sprint 3D)**
Date: 2026-07-01 · Branch: `develop` (post-#429) · Method: read-only, five parallel security reviewers, every finding grounded in `file:line`. No code changed.

> Reviewed as a senior application-security architect across: authentication, authorization, tenant isolation, RLS, OWASP Top 10, headers, secrets, CSRF, SSRF, SQL injection, XSS, rate limiting, logging, audit trail, session handling, uploads, Ask, voice, billing, API routes. Findings that look dangerous but are safe are documented in **§False Positives** so they are not re-flagged.

---

## Executive summary & verdict

**Overall posture: STRONG core, with hardening gaps. 0 Critical · 3 High · 12 Medium · 14 Low.**

The security fundamentals are genuinely well-built and should be preserved: **parameterized SQL end-to-end** (no injection found across ~618 queries), a **fully HTML-escaped** brief/alert email renderer, a **best-in-class SSRF guard** (IP pinning + redirect blocking + IPv4-mapped-IPv6 handling), **tenant-scoped server-controlled upload keys** with MIME + magic-byte validation, **enforced Stripe webhook signatures with fail-closed idempotency**, a **DB-immutable, tenant-scoped audit log**, **argon2id** hashing with DB-backed lockout, an **httpOnly + AEAD-encrypted** session cookie, and **live route-level tenant isolation** (`WHERE organization_id = $n`) that held on every mutation across 12 audited domains.

The gaps cluster in three places: **(1) rate limiting** — durable in name only (per-replica in-memory stores; the Ask/Voice per-org key is never set, collapsing to one platform-wide bucket); **(2) the SSO/session lifecycle** — a 7-day JWT is passed in a URL and cannot be revoked on logout; **(3) authorization granularity** — the entitlement gate cannot distinguish paid tiers, and two DELETE pre-flights leak cross-tenant existence/counts. None is a confirmed cross-tenant data breach or remote exploit; most are defense-in-depth or availability issues.

**This is not a launch blocker on its own**, but **H1 (SSO token in URL)** should be fixed before SSO is relied on in production, and the rate-limiting Highs should be scheduled early post-launch.

---

## Domain coverage at a glance

| Domain | Result | Domain | Result |
|---|---|---|---|
| Authentication | 🟡 strong; H1 SSO-token-in-URL | SQL Injection | 🟢 none (parameterized) |
| Authorization | 🟡 tier gate can't distinguish tiers | XSS | 🟢 none (escaped/React) |
| Tenant isolation | 🟢 live defense holds; 🟡 count oracles | Rate limiting | 🔴 weakest area (H2/H3) |
| RLS | 🟢 inert-by-design, correctly not relied on | Logging | 🟢 redacted; no stack leaks |
| Headers | 🟢 engine strong; 🟡 app CSP, website none | Audit trail | 🟡 immutable but best-effort |
| Secrets | 🟢 none tracked; 🟡 local key hygiene | Session | 🟡 no JWT revocation on logout |
| CSRF | 🟡 SameSite-only, no token/Origin | Uploads | 🟢 well-validated; Low MIME-OR |
| SSRF | 🟢 strong pinning guard | Ask / Voice | 🟢 tenant-safe; 🔴 shared limiter |
| Billing | 🟢 sig+idempotency+allow-list; 🟡 grant edge | API routes | 🟢 no mass-assignment/verbose errors |

---

## CRITICAL
**None.** No confirmed cross-tenant data leak, secret exposure, authentication bypass, injection, or remote exploit was found across the five review lanes.

---

## HIGH

### H1 — SSO session JWT is passed in a URL query string (credential leakage)
`src/api/routes/sso.ts:320-328` redirects to `${APP_URL}/api/auth-sso-callback?token=<7-day HS256 session JWT>&email=…&orgId=…`; `app/src/app/api/auth-sso-callback/route.ts:10` reads it from `searchParams`.
- **Impact:** the token is a full 7-day credential. In a URL it lands in browser history, the `Referer` of subsequent `/dashboard` navigations/asset loads, and proxy/Render access logs. It **cannot be revoked** (logout is stateless — see M8), and SSO/JIT users have `password_hash=''` so the `password_changed_at` invalidation path is unavailable. Anyone with log/history access replays it for up to 7 days.
- **Fix:** POST the assertion result (SAML `form_post`) or mint a single-use, short-TTL exchange code the callback swaps server-to-server; drop `email/orgId` from the URL and derive them from the validated token.
- **OWASP:** A07 (Identification & Auth Failures) / A02.

### H2 — Rate limiting is not durable and mostly per-IP-per-replica
Every `express-rate-limit`/`slow-down` limiter uses the default in-memory `MemoryStore`; `grep` for `rate-limit-redis`/`RedisStore`/`store:` returns zero hits. Affected: global + slowdown (`app.ts:232-246`), Stripe-webhook (`app.ts:306-311`), login/signup/forgot/verify (`customerAuth.ts:50-79`), MFA (`mfa.ts:34-47`, a hand-rolled `Map`), Ask (`ask.ts:113`), transcribe (`transcribe.ts:79`). The one **durable, Redis-backed** limiter, `tierRateLimit` (fail-open), is applied to only **2** route prefixes (`index.ts:352,375`), leaving the bulk of `/api` uncovered.
- **Impact:** on multi-replica Render the effective ceiling is `replicas × max`, and every window resets on deploy. Weakens brute-force protection on login/MFA and abuse/cost ceilings on Ask/transcribe/checkout/export. (Mitigant: login **lockout** is DB-backed and durable, so the account-takeover backstop holds; this is primarily an abuse/DoS-surface weakening.)
- **Fix:** back all limiters with `rate-limit-redis` (Redis already wired in `tierRateLimit.ts`) and apply `tierRateLimit` broadly after `attachOrganizationContext`.
- **OWASP:** A07 / A04.

### H3 — Ask & Voice "per-org" rate limit collapses to a single global bucket
`ask.ts:118` and `transcribe.ts:83` key on `(req as any).organizationId`, which is **never set in production** — `attachOrganizationContext` writes `req.organizationContext.organizationId` (`attachOrganizationContext.ts:23`), a different property (the only assignment to `req.organizationId` is in a test). The key therefore falls back to `req.ip`; and because both endpoints are reached **server-side through the Next.js app proxy** with `trust proxy=1`, the engine sees the app-server/LB IP for every tenant. Net: **all** Ask traffic shares one 20/min bucket and **all** Voice traffic shares one 10/min bucket, platform-wide.
- **Impact:** one tenant (or a legitimate burst) denies Ask/Voice to every other paying customer — an availability DoS on premium features. The docstring's "20/min per org" (`ask.ts:14`) is false.
- **Fix:** key on `req.organizationContext?.organizationId` (populated upstream), fall back to IP.
- **OWASP:** A04 (Insecure Design).

---

## MEDIUM

- **M1 — Entitlement gate cannot distinguish paid tiers (Team ↔ Platform).** `requireEntitlement.ts:5-10,31-36` maps `premium|platform|team → rank 4`; 215 routes gate on `"premium"`. Real paid boundaries hold (a `professional` tenant is 403'd from `premium`), but **Team Professional is authorization-indistinguishable from Platform Professional** — no `requireEntitlement("platform")` gate can exist. Ratified as intentional debt (**R4**, `TENANT_ISOLATION_STANDARD.md:213-220,268`); latent revenue/authz bug, not a data-isolation breach. *(This is the same issue the architecture review ranked C1 for monetization-enforcement reasons; from a pure access-control lens it is Medium/latent.)* **A01.**
- **M2 — Cross-tenant existence/count oracle in `controls.ts` DELETE pre-flight.** `controls.ts:550-555` `SELECT COUNT(*) … WHERE control_id=$1` has **no `organization_id`**; an org-A admin DELETEing an org-B control id gets `409 control_has_children` + exact child counts (existence + count disclosure). Admin-gated. Add `AND organization_id=$org`. **A01.**
- **M3 — Same oracle in `aiSystems.ts` DELETE pre-flight** (`aiSystems.ts:533-538`, `409 ai_system_has_reviews` + count). Add org predicate. **A01.**
- **M4 — `teamInvites.ts` mutates `users` without an org predicate on the write.** `:399-402` (`status='inactive'`) and `:486-489` (`role=$1`) scope only by `id`; currently protected by a preceding same-org guard SELECT (not exploitable today), but any regression makes it a cross-tenant member-disable / privilege change. Add `AND organization_id=$org` to the writes. **A01.**
- **M5 — App CSRF relies solely on `SameSite=Lax`; no CSRF token, no Origin/Referer check.** `app/src/lib/session.ts:43-49`. `SameSite=Lax` (set explicitly) *does* block classic cross-site forged POSTs, so this is not a live classic-CSRF hole — but it is site-scoped, so any XSS'd or attacker-controlled **sibling subdomain** under `securelogicai.com` can issue cookie-bearing same-site requests; `secure` is also only set in prod/`FORCE_SECURE_COOKIE`. Add an Origin allowlist (or `SameSite=Strict`) on billing/password/MFA mutations. **A05/A01.**
- **M6 — SAML: no-op schema validator + no explicit signature policy.** `sso.ts:33-35` installs a no-op `setSchemaValidator`; `buildSP` sets no `wantAssertionsSigned`/`wantMessageSigned`. Mitigated by samlify 2.13.1 still verifying the ACS signature by default and its XSW guard (`ERR_POTENTIAL_WRAPPING_ATTACK`) — so **not** a forged-assertion bypass today — but the unauthenticated ACS mints a JWT for the assertion's `nameID`, so signature enforcement is the only barrier to takeover and should be explicit, not default-derived. Set `wantAssertionsSigned:true` + install a real schema validator. **A05/A07.**
- **M7 — Webhook grants entitlement on `customer.subscription.created` with no status check.** `stripeWebhook.ts:171-202` gates `updated` on `active`/`trialing` but lets `created` fall through to an unconditional grant (`:197-199`). A subscription created in `incomplete` (SCA/3DS/failed initial payment) grants full tier until `incomplete_expired` (~23h). Real signed event required → Medium. Apply the same status gate to `created`. **A08.**
- **M8 — Logout does not revoke the JWT (stateless, 7-day).** `customerAuth.ts:809-821` only audits; the app destroys iron-session but the underlying JWT stays valid to `exp`. Combined with H1 a leaked token lives 7 days. Add a `token_valid_after`/jti denylist bumped on logout, checked in `requireApiKey`/`requireAuth`. **A07.**
- **M9 — Entitlement fail-open: unknown/missing tier metadata defaults *up* to premium.** `stripeWebhook.ts:151-157` returns `"paid" → premium` (highest) on unrecognized tier / price-ID miss. A new Stripe price added without updating `PRICE_ID_TO_TIER` silently upgrades a paying customer to full platform. Default **down** (`professional`) or drop+alert. **A08/A04.**
- **M10 — App CSP allows `unsafe-inline` and `unsafe-eval` in `script-src`.** `app/next.config.mjs:36`. Common Next.js constraint, but it means CSP is not a reliable second line against XSS on the authenticated app. (`connect-src` is correctly env-derived, `frame-ancestors 'none'`, HSTS preload present — all good.) Plan nonce-based CSP. **A05.**
- **M11 — Marketing website ships no security headers.** `website/next.config.mjs` is a static export with no `headers()` block; unless the host injects them, `securelogicai.com` serves without HSTS/CSP/X-Frame-Options/nosniff (clickjacking/MIME-sniff/downgrade on the public brand origin). Set headers at the hosting layer. **A05.**
- **M12 — Audit trail is immutable & tenant-scoped but best-effort, with uneven auth-event coverage.** `writeAuditEvent` is fire-and-forget and swallows failures with only a `warn` (`auditLog.ts:54-97`) — an event can be silently lost under DB pressure with no alert. Resource-mutation coverage is broad (125 sites), but login-success/logout/password-change are less consistently first-class than admin/mutation actions. Make auth-lifecycle events first-class + alert on `audit_write_failed`. **A09.**

---

## LOW

- **L1 — `requireAuth` fails OPEN vs `requireApiKey` fails CLOSED** on the identical `password_changed_at` DB check (`requireAuth.ts:55-57` swallows the error). Bounded: only helps a pre-password-change token replayed during a Postgres outage, only on `/api/auth/*` (self/org-scoped). Make it fail closed for symmetry. **A07.**
- **L2 — Password-reset / email-verification tokens stored plaintext at rest** (`customerAuth.ts:329,849`), looked up by equality; a DB/backup exposure yields usable tokens. Store `sha256(token)`. (Entropy/TTL/single-use otherwise good.) **A02.**
- **L3 — User-enumeration oracles:** `429 account_locked` and `403 account_pending_deletion` fire only for existing users (`customerAuth.ts:617,641`), despite the good constant-time dummy-hash login path. **A07.**
- **L4 — `change-password` skips the complexity policy** (`:990`, length ≥12 only) while signup/reset use `validatePassword`. Route it through `validatePassword`. **A07.**
- **L5 — App `SESSION_SECRET` is not boot-validated** (`session.ts:41`); no app-side `validateEnv`. If unset/weak, iron-session throws per-request (500) rather than failing at boot. Add an app boot check (present, ≥32 chars). **A05.**
- **L6 — `auth-sso-callback` trusts query params for session display fields** (`route.ts:26-33` sets `session.organizationId/userId/email` from the URL). Low impact today (engine derives org from the JWT claim, not `session.organizationId`); becomes exploitable if any app route trusts `session.organizationId` for authz. Derive from the token. **A01.**
- **L7 — `findings.ts` PATCH `owner_user_id` is not org-verified** (`:648-656`), unlike `risks.ts`. Can reference an out-of-org user id (broken reference / minor id disclosure). Use the `resolveOwnerUserSameOrg` pattern. **A01.**
- **L8 — `assessments.ts` unscoped child reads** (`:183-211,91-94`) — not exploitable (parent verified same-org, outer query org-scoped, under `asTenant`); add explicit `organization_id` for depth. **A01.**
- **L9 — Voice `transcribe.ts` fileFilter accepts on MIME *OR* extension** (`:54`), no magic-byte check — a renamed file passes, but bytes only reach Whisper and are never persisted. AND MIME+extension. **A04.**
- **L10 — Vendor-assurance PDF parse resource amplification** (`vendorAssurancePdfExtractor.ts`) — bounded by the 25 MB cap and runs in the durable worker off the request path; add a page-count/time budget. **A05.**
- **L11 — Voice uploads buffered in RAM** (`transcribe.ts:35-37`, `memoryStorage`, 10 MB) — bounded today by the (broken) limiter; revisit if H3 is fixed to per-org. **A04.**
- **L12 — Audit CSV export lacks spreadsheet formula-injection neutralization** (`auditLog.ts:178-185`); a logged value starting with `= + - @` executes on open in Excel/Sheets. Prefix such cells. **A03-adjacent.**
- **L13 — Local private-key material unencrypted in the working tree** (`issue.private.pem`, `keys/*.pem`, `engine-keypair.json` — real keys). **Untracked / never committed** (verified `git ls-files` empty, 0 commits), so not a repo disclosure; compromise-if-host-compromised. Confirm prod signing uses a distinct KMS key; rotate if any ran in prod. **A02.**
- **L14 — Deprecated `X-XSS-Protection: 1; mode=block`** set on engine + app; cosmetic, prefer `0` + CSP. **A05.**

---

## False Positives (looks dangerous, verified safe — do not re-flag)

1. **Legacy `signals` table is "unscoped" → FALSE.** `20260405_add_organization_id_to_signals.sql:15-19` added `organization_id`; the writer sets it per-org; `routes/signals.ts:40` filters `WHERE (organization_id=$1 OR organization_id IS NULL)` = own-org + global platform signals, authenticated + entitlement-gated. **This resolves the earlier architecture-review "H4 latent cross-tenant surface" — it is the by-design own+global pattern, not a leak.**
2. **RLS "not enforced" → inert BY DESIGN.** 23 tables have `ENABLE RLS` + fail-closed `NULLIF` policies, **0 `FORCE`**; runtime connects as owner (bypasses non-FORCE RLS); `app_request` role has no password yet; the DATABASE_URL flip is pending. Isolation runs on explicit `WHERE organization_id` — RLS is defense-in-depth, correctly **not** relied upon, and no audited table leans on RLS with an unwrapped writer.
3. **helmet "disabled" → FALSE.** helmet is present (`app.ts:174-184`); its CSP/HSTS/frameguard are intentionally off there because a stricter `securityHeaders` middleware sets a consolidated set first (HSTS 1yr+subdomains, nosniff, `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy).
4. **CORS wildcard → FALSE.** Exact-match `Set` allowlist, callback returns `false` otherwise, `credentials:false`, dev origins gated behind `isDev` (`app.ts:102-216`).
5. **Engine leaks stack traces → FALSE.** `errorHandler.ts:97-134` returns only a generic contract error; stack logged server-side, dev-only.
6. **Logger leaks secrets → FALSE.** `logger.ts` redacts Authorization/cookie/api-key headers + body secret fields; `httpLogger.ts` never logs bodies, strips querystrings. Secret sweep of tracked files clean.
7. **Audit log mutable / not tenant-scoped → FALSE.** DB triggers block UPDATE/DELETE/TRUNCATE (`20260614_…immutable.sql`); reads are admin-gated and `organization_id`-filtered.
8. **Auth endpoints only globally rate-limited → FALSE.** Login/signup/forgot/verify/MFA/Ask/transcribe/SSO/invites all have dedicated per-route limiters + DB-backed lockout. (The real issue is durability — H2, not absence.)
9. **JWT alg-confusion → FALSE.** `jwt.ts:120-156` ignores the header `alg`, always recomputes HMAC-SHA256 with `timingSafeEqual`; no `none` branch, no public-key path.
10. **Engine state-changing routes CSRF → FALSE.** Header-only auth (`X-Api-Key`/`Bearer`), no auth cookie; browsers don't attach these cross-site. CSRF surface is only the app cookie routes (M5).
11. **Admin `X-Admin-Key` CSRF → FALSE.** Header-based, timing-safe compare + CIDR allowlist; not browser-forgeable.
12. **JWT "in a cookie" is JS-exposed → FALSE.** `httpOnly:true` + AEAD-encrypted iron-session; token read server-side only, forwarded as Bearer; never in browser JS.
13. **samlify no-op validator → open XXE/XSW → FALSE (in 2.13.1).** Signature still verified on the POST binding; wrapping guard present. Residual = defense-in-depth reduction (M6), not a bypass.
14. **Billing price/amount manipulation → FALSE.** Checkout accepts only `tier` against server `VALID_TIERS`; price id from `STRIPE_PRICE_ID_*` env; `quantity:1`; no client amount.
15. **Webhook signature / idempotency → SAFE.** `constructEvent` enforced before processing (raw body preserved), oversized/missing sig short-circuits; idempotency claim fails **closed** (500 → Stripe retries).
16. **Portal return-URL open redirect → FALSE.** `return_url` is env + server-derived `?from=<entitlement>`; no client input.
17. **Ask prompt-injection / cross-tenant exfiltration → FALSE.** All 8 context queries run inside `withTenant(orgId)` with `WHERE organization_id=$1`, org derived server-side; the LLM has no DB/tool access and sees only the caller's own snapshot + 500-char question. Output rendered as a React **text node** (no `dangerouslySetInnerHTML`) → no XSS.
18. **SQL injection → NONE.** ~618 queries parameterized; "dynamic" builders only generate `$n` placeholders; the few interpolated **column names** come from trusted constants/hardcoded literals, never request input.
19. **XSS → NONE.** Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval` in app/website; brief & alert email HTML fully `escHtml()`-escaped; admin dashboard fields `esc()`-escaped.
20. **SSRF → NONE.** Webhook egress: https-only, metadata blocklist, all-record DNS classification, IPv4-mapped-IPv6 unwrap, DNS-rebind pinning, manual-redirect. Feeds are operator-curated constants; no user-supplied fetch URL; no SSO-metadata/avatar fetch exists.
21. **Mass assignment → NOT PRESENT.** No route spreads `req.body` into a write; explicit column-mapped INSERTs with hand-rolled validators.
22. **Committed secrets → NONE.** `git ls-files`/`git log --all` empty for all `.pem`/keypair/`.env`; only `.env.example` templates tracked.

---

## OWASP Top 10 (2021) mapping

| # | Category | Status | Findings |
|---|---|---|---|
| A01 | Broken Access Control | 🟡 | M1 tier gate, M2/M3 count oracles, M4 teamInvites, L6/L7/L8; live isolation holds, RLS inert-by-design |
| A02 | Cryptographic Failures | 🟡 | H1 JWT-in-URL, L2 plaintext reset tokens, L13 local keys; argon2id/timing-safe good |
| A03 | Injection | 🟢 | None (parameterized SQL, escaped HTML); L12 CSV formula (minor) |
| A04 | Insecure Design | 🟡 | H3 rate-key collapse, M1 tier model, M9 fail-open-up, L9/L11 |
| A05 | Security Misconfiguration | 🟡 | M10 CSP unsafe-inline, M11 website no headers, M6 SAML defaults, L5/L10/L14; helmet/CORS strong |
| A06 | Vulnerable/Outdated Components | 🟡 | samlify default-reliance (M6); 2 moderate Dependabot alerts (tracked separately) |
| A07 | Identification & Auth Failures | 🟡 | H1 SSO-URL, H2 rate durability, M8 no logout revoke, L1/L3/L4; argon2id + DB lockout strong |
| A08 | Software & Data Integrity | 🟡 | M7 created-without-status, M9 fail-open; webhook sig + idempotency verified strong |
| A09 | Logging & Monitoring | 🟡 | M12 best-effort audit + uneven auth events; immutable+scoped log strong |
| A10 | SSRF | 🟢 | None — comprehensive pinning guard |

---

## Recommendations (priority order)

1. **H1** — remove the SSO session JWT from the URL (SAML `form_post` or single-use exchange code) **before SSO is production-relied-upon**.
2. **H3** — fix the Ask/Voice limiter key (`req.organizationContext?.organizationId`) — one-line change restoring per-tenant throttling.
3. **H2** — Redis-back all limiters (Redis already wired) and apply `tierRateLimit` across `/api`, prioritizing login, MFA, forgot-password, Ask, transcribe, checkout, exports.
4. **M2/M3/M4** — add `AND organization_id = $org` to the two DELETE pre-flight `COUNT(*)` queries and the two `teamInvites` `users` UPDATEs; add a cross-org negative-path test (org-A id → org-B resource must 404, never 409-with-counts).
5. **M7/M9** — gate `customer.subscription.created` on `active/trialing`; default unknown tier **down**, not to premium.
6. **M8/M5** — add server-side JWT revocation on logout (jti/`token_valid_after`); add an Origin/Referer allowlist (or `SameSite=Strict`) on app billing/password/MFA mutations.
7. **M6** — set `wantAssertionsSigned:true` + install a real SAML schema validator instead of the no-op.
8. **M11/M10** — set security headers at the website host; plan nonce-based CSP to drop `unsafe-inline`/`unsafe-eval`.
9. **M12** — make auth-lifecycle events first-class audited and alert on `audit_write_failed`.
10. **Lows** — hash reset tokens at rest (L2), symmetric fail-closed `requireAuth` (L1), full password policy on change-password (L4), app-boot `SESSION_SECRET` validation (L5), MIME+magic-byte on transcribe (L9), CSV formula neutralization (L12), confirm prod signing keys are KMS-managed (L13).

---

## Appendix — method & scope notes
- Five parallel read-only reviewers: authN/session/secrets/CSRF; authZ/tenant/RLS; injection/XSS/SSRF/uploads; headers/rate-limit/logging/audit; Ask/voice/billing/API. All `path:line` reflect the reviewed branch; re-anchor if code moves.
- RLS taken as inert pre-flip per `TENANT_ISOLATION_STANDARD.md`; not executed. No penetration testing or dependency CVE scanning performed (static review only). App UI DOM-XSS assessed by source grep, not runtime.
- No code was modified. This document is the sole deliverable.

*End of review.*
