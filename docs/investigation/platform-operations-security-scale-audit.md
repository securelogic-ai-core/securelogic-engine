# Platform Operations, Security and Scale — Truth Audit

**Date:** 2026-08-24
**Author:** engineering audit, during the #826 holding window
**Status:** INVESTIGATION — for owner review. No code changed, nothing merged, nothing deployed.
**Working tree audited:** `scratch/merge-train-dryrun` (= `origin/develop` + the 21 held branches).
Infrastructure claims are read from the **live** Render API and public DNS/TLS on 2026-08-24,
not from `render.yaml` — see [[render-yaml-declared-not-synced]]; declared ≠ synced has bitten
this program in both directions.

## What this is and is not

This is **not** a capability re-audit. It does not restate the Enterprise Capability Baseline,
does not score product features, and does not revisit the 95/95 decomposition. It answers one
question: *what does the platform underneath the product actually have, operationally and
securely, and what of that is genuinely required before we put a paying stranger on it.*

Every `BUILT` or `PARTIAL` claim below cites a file:line, a live API response, or a network
probe. Where evidence was unavailable from inside this container the item is marked
`NEEDS INFRASTRUCTURE VERIFICATION` rather than guessed.

**Deliberate output discipline:** several findings are marked `NOT NEEDED`, `DEFER`,
`ALREADY BUILT`, `CONFIGURATION ONLY` or `DOCUMENTATION ONLY`. They are not padded into
packages. Roughly a third of the surface the brief asked about needs no engineering at all.

---

## 0. The two findings that outrank everything else in this document

### 0.1 P0 — `securelogicai.com` does not currently resolve to SecureLogic infrastructure

There is no Cloudflare boundary in front of production to audit, because the domain is not
pointed at production at all.

| Probe | Result |
|---|---|
| `securelogicai.com` NS | `ns1.ns306.parklogic.com`, `ns2.ns306.parklogic.com` |
| `app.securelogicai.com` A | `172.237.129.108 / .236 / .242` |
| `nonexistent-xyz.securelogicai.com` A | **same three IPs** — wildcard |
| TLS cert on `app.securelogicai.com` | `CN=*.securelogicai.com`, Let's Encrypt, issued **2026-08-22**, SAN `*.securelogicai.com, securelogicai.com` |
| Render's edge IP (from `securelogic-app.onrender.com`) | `216.24.57.7` |
| Render custom-domain record for `securelogic-app` | `app.securelogicai.com` — `verificationStatus: verified` |

ParkLogic is a domain-parking/monetisation operator. Render does not issue wildcard
certificates for custom domains and does not serve from `172.237.129.0/24`. A wildcard A record
that answers for hostnames that were never configured is parking behaviour, not application
behaviour.

Render still reports the custom domain as `verified` because verification is sticky once
granted — it is not a live reachability signal. This is the declared-≠-synced trap in its
sharpest form.

**What this does not mean:** the product is not down. `https://securelogic-app.onrender.com/`
serves the real app (307 → `/login`) and `https://securelogic-engine.onrender.com/health`
returns 200. Production is running; the branded hostname is not currently in front of it.

**Why it is P0 anyway:** every launch artefact, every Stripe return URL, every email link and
every SSO ACS URL that names `securelogicai.com` currently points at a third party's parking
infrastructure. Whoever controls that answer controls what a customer following a SecureLogic
link sees, and a wildcard cert on that name means the parking host can terminate TLS for any
subdomain we later create.

**This is operator-owned, not engineering-owned.** The fix is at the registrar/DNS layer, and
the audit cannot and should not touch it.

### 0.2 P0 — the Render origins are directly reachable from the public internet

`https://securelogic-engine.onrender.com/health` → `200`.
`https://securelogic-app.onrender.com/` → `307`.

Both answer to anyone. The `server: cloudflare` response header on these is **Render's own edge
in front of `*.onrender.com`** — it is not a SecureLogic Cloudflare zone and it enforces no
SecureLogic policy. Render offers no inbound IP allowlist on these plans, so even once DNS is
corrected, an intended Cloudflare boundary would be *bypassable by hostname* unless origin
authentication is added.

Consequence today: any WAF rule, rate limit, bot rule, geo rule or IP allowlist placed at
Cloudflare later is advisory, not enforcing. That includes the `/admin` IP allowlist
(ADR-0011) — see [[admin-ip-allowlist-unwired]].

Detail: rate limiting *is* enforced at the origin (`ratelimit-limit: 300`,
`ratelimit-policy: 300;w=60` observed on the live `/health` response), so the origin is not
naked. But it is the only enforcement point.

---

## 1. Executive matrix

| AREA | CURRENT STATE | EVIDENCE | GAP | PRIORITY | LAUNCH REQUIREMENT | RECOMMENDATION | PACKAGE |
|---|---|---|---|---|---|---|---|
| A1 Sentry integration | BUILT | `src/api/lib/sentry.ts`; `src/api/server.ts:55`; live `SENTRY_DSN_ENGINE` set on prod engine | — | P2 | met | keep | — (ALREADY BUILT) |
| A2 Frontend error tracking | BUILT | `app/sentry.client.config.ts`, `app/src/instrumentation.ts`; live `NEXT_PUBLIC_SENTRY_DSN_APP` set | — | P2 | met | keep | — (ALREADY BUILT) |
| A3 Backend error tracking | BUILT | `src/api/app.ts:478` `setupExpressErrorHandler` | — | P2 | met | keep | — (ALREADY BUILT) |
| A4 Session Replay | MISSING | no `replayIntegration` in repo | no replay | P3 | no | do not add before a support burden exists | — (NOT NEEDED NOW) |
| A5 Replay/error correlation | MISSING | consequence of A4 | — | P3 | no | — | — (NOT NEEDED NOW) |
| A6 Distributed tracing | PARTIAL — **broken on the engine** | `src/api/lib/sentry.ts` header: HTTP auto-instrumentation not applied under ESM; `tracesSampleRate: 0.1` set on both tiers | no end-to-end trace | **P1** | yes | preload `--import ./instrument.mjs` | PLATFORM-R1 |
| A7 Release SHA correlation | PARTIAL | engine `release: RENDER_GIT_COMMIT` (`sentry.ts`); app `release: NEXT_PUBLIC_RENDER_GIT_COMMIT` — **not among the prod app's 16 live env keys** | app events unversioned | P2 | no | set one env var | PLATFORM-R1 (CONFIGURATION ONLY) |
| A8 Tenant-safe user/session correlation | MISSING | no `Sentry.setUser` anywhere | cannot ask "which tenant is failing" | **P1** | yes | org-id only, never email | PLATFORM-R1 |
| A9 Rage-click | MISSING | consequence of A4 | — | P3 | no | — | — (NOT NEEDED NOW) |
| A10 Dead-click | MISSING | consequence of A4 | — | P3 | no | — | — (NOT NEEDED NOW) |
| A11 Web Vitals (LCP/INP/CLS) | MISSING | no `web-vitals` dependency in `app/package.json` | no field perf data | P2 | no | ships with A6 preload for near-zero cost | PLATFORM-R1 |
| A12 Route latency metrics | PARTIAL | `src/api/infra/httpLogger.ts` (pino-http, default `responseTime` retained); no aggregation | latency is in logs, never summarised | **P1** | yes | aggregate, don't re-instrument | PLATFORM-R1 |
| A13 p50/p95/p99 | MISSING | only `src/api/routes/adminDunningMetrics.ts` (billing-specific) | no percentiles anywhere | **P1** | yes | derive from A12 | PLATFORM-R1 |
| A14 External dependency latency | PARTIAL | LLM only: `src/api/lib/llm/llmTelemetry.ts`; Stripe/Resend/connectors untimed | blind to 3rd-party stalls | P2 | no | one shared outbound wrapper | PLATFORM-R1 |
| A15 DB query latency | MISSING | no timing in `src/api/infra/postgres.ts` | cannot attribute slowness to SQL | **P1** | yes | wrap `pg` proxy — the seam exists | PLATFORM-R1 |
| A16 Pool wait time | MISSING | not measured | exhaustion is invisible | **P1** | yes | ships with A15 | PLATFORM-R1 |
| A17 Slow-query detection | MISSING | no threshold logging | — | P1 | yes | ships with A15 | PLATFORM-R1 |
| A18 Query fingerprinting | MISSING | — | — | P2 | no | ships with A15 | PLATFORM-R1 |
| A19 `pg_stat_statements` | NEEDS INFRASTRUCTURE VERIFICATION | zero repo references; extension state unknown on Render PG | — | P1 | yes | check + enable | PLATFORM-R1 (CONFIGURATION ONLY) |
| A20 Telemetry privacy controls | BUILT | `src/api/lib/sentry.ts` `scrubEvent`/`deepScrub`; `app/sentry.scrub.ts`; `httpLogger.ts` `REDACT_KEYS` + `safePathOnly` | — | P0-grade, already met | met | keep; extend to any new sink | — (ALREADY BUILT) |
| B Application slowness | UNPROVABLE TODAY | consequence of A12–A19 | no causal evidence | **P1** | yes | instrument, then measure, then optimise | PLATFORM-R1 |
| C1 Pool configuration | PARTIAL — **unbounded acquisition wait** | `src/api/infra/postgres.ts:50` `new Pool({connectionString, ssl})` — no `max`, no `idleTimeoutMillis`, no `connectionTimeoutMillis` | exhaustion presents as an infinite hang | **P0** | yes | set explicit bounds | PLATFORM-R1 |
| C2 Pool-per-process | BUILT (implicit) | two pools per engine process: `postgres.ts:50` + `:71` `pgElevated` | ~20 conns/instance at pg defaults | P1 | yes | size against the plan's limit | PLATFORM-R1 |
| C3 Worker pool behaviour | PARTIAL | worker services import the same `pg` module | uncounted total conns | P1 | yes | count in the same budget | PLATFORM-R1 |
| C4 Connection leaks | BUILT (guarded) | `withTenant`/`withElevated` `finally { client.release() }`, `postgres.ts` | — | P2 | met | keep | — (ALREADY BUILT) |
| C5 Transaction handling | BUILT | `withTenant` BEGIN/COMMIT/ROLLBACK + savepoint proxy + `runAfterCommit` detachment | — | P2 | met | keep | — (ALREADY BUILT) |
| C6 RLS context scope | BUILT — **transaction-local** | `postgres.ts` `set_config('app.current_org_id', $1, true)` | — | P0-grade, already met | met | keep | — (ALREADY BUILT) |
| C7 Advisory lock scope | PARTIAL | xact-scoped in app code (`assetAutoCreation.ts:215`, `findings.ts:1572`, `applicabilityAssessmentWriter.ts:93`); **session-scoped** in `src/api/infra/advisoryLock.ts` | one PgBouncer blocker | P2 | no | convert before any pooler | PLATFORM-SCALE1 |
| C8 PgBouncer | **RECOMMENDED LATER** | see §C verdict | — | P3 | no | do not enable | — (DEFER) |
| D1 Redis provider | NEEDS INFRASTRUCTURE VERIFICATION | `REDIS_URL` set on prod engine (live); provider not derivable without reading the value | — | P2 | no | record it | DOCUMENTATION ONLY |
| D2 Redis usage | BUILT | 14 consumers incl. `tierRateLimit.ts`, `apiRateLimiter.ts`, `enforceUsageCap.ts`, `adminLockout.ts`, `feedEtagStore.ts`, `entitlementStore.ts` | — | P2 | met | keep | — (ALREADY BUILT) |
| D3 Distributed locks in Redis | NOT USED | locks are in Postgres (C7) | — | P3 | no | correct as-is | — (NOT NEEDED) |
| D4 Sessions in Redis | NOT USED | JWT + `users.session_epoch` | — | P3 | no | correct as-is | — (NOT NEEDED) |
| D5 Redis failure behaviour | BUILT — **fails open** | `apiRateLimiter.ts` `if (!redisReady) next()`; 1200 ms timeouts; `redis.ts` 1500 ms connect timeout, bounded reconnect | rate limits vanish when Redis is down | P1 | yes | fail closed on **auth** limiters only | PLATFORM-S1 |
| D6 Tenant key isolation | PARTIAL | keys derived per org/key-hash in the limiters | no repo-wide key convention | P2 | no | document the convention | DOCUMENTATION ONLY |
| D7 Upstash | **UPSTASH NOT NEEDED** | see §D verdict | — | P3 | no | keep current | — (NOT NEEDED) |
| E Deployment platform | KEEP RENDER | see §E verdict | `autoDeploy: true` on all 6 prod services defeats deploy ordering | P1 | yes | fix ordering, not vendor | PLATFORM-R1 (CONFIGURATION ONLY) |
| E2 Declared vs live services | PARTIAL | `render.yaml` declares 14; Render API returns **17** (`securelogic-demo-app`, `securelogic-demo-engine`, `securelogic-intelligence-api`[suspended]) | 3 undeclared services | P2 | no | declare or delete | DOCUMENTATION ONLY |
| F1 Cloudflare boundary | **MISSING** | §0.1 | no boundary exists | **P0** | yes | operator DNS action | PLATFORM-S1 (operator-owned) |
| F2 Origin directly reachable | **YES** | §0.2 | boundary bypassable by hostname | **P0** | yes | origin authentication | PLATFORM-S1 |
| F3 Cloudflare SSL mode | NOT DETERMINABLE | domain is not on a Cloudflare zone | — | P0 (blocked by F1) | yes | re-audit after F1 | PLATFORM-S1 |
| F4 Authenticated Origin Pull | MISSING | prerequisite F1 absent | — | P1 | yes | the durable fix for F2 | PLATFORM-S1 |
| F5 Origin security headers | BUILT | live: HSTS `max-age=63072000; includeSubDomains; preload`, `frame-ancestors 'none'`, COOP/CORP, Permissions-Policy | — | P1 | met | keep | — (ALREADY BUILT) |
| F6 Prod CSP defect | **PARTIAL — live defect** | prod app response header contains `connect-src 'self' http://localhost:4000`; source `app/next.config.mjs:27` fallback; `NEXT_PUBLIC_ENGINE_URL` absent from the prod app's 16 live env keys | plaintext dev origin in a prod security header | **P1** | yes | set the env var and rebuild | PLATFORM-S1 (CONFIGURATION ONLY) |
| F7 `ENGINE_URL_BASE` unset in prod | PARTIAL | declared `render.yaml:117`; **absent** from the prod engine's 70 live keys — the prod twin of [[staging-engine-url-base-unset]] | absolute URLs/SAML ACS resolve by fallback | **P1** | yes | set it | PLATFORM-S1 (CONFIGURATION ONLY) |
| G1 Secrets in repo | BUILT (clean) | `git ls-files` → only `.env.example` ×3; `.gitignore:4-6` | — | P0-grade, already met | met | keep | — (ALREADY BUILT) |
| G2 Secret storage | BUILT | Render env, `sync: false` on every secret in `render.yaml` | — | P1 | met | keep | — (ALREADY BUILT) |
| G3 Secret scanning | MISSING | no gitleaks/trufflehog in `.github/workflows/` | a committed key would not be caught | **P1** | yes | add one CI job | PLATFORM-S1 |
| G4 Dependency audit | BUILT | `.github/workflows/ci.yml:100-114` → `scripts/ci/auditGate.mjs`, GHSA waivers in `.audit-waivers.json` | — | P1 | met | keep | — (ALREADY BUILT) |
| G5 External secret manager | NOT NEEDED NOW | 70 keys, one platform, one operator | — | P3 | no | Render env is correct at this size | — (NOT NEEDED) |
| G6 Dual-key rotation | MISSING | single-value keys (`JWT_SECRET`, `SECURELOGIC_SIGNING_SECRET`, …) | rotation = downtime or breakage | P2 | no | needed at the 2nd enterprise customer | PLATFORM-S1 |
| G7 Automated rotation | NOT NEEDED NOW | — | — | P3 | no | manual + runbook | — (DEFER) |
| G8 Rotation audit log | PARTIAL | precedent exists: [[prod-credential-rotation-2026-08-11]] | not systematised | P2 | no | runbook, not code | DOCUMENTATION ONLY |
| G9 Emergency revocation | PARTIAL | `users.session_epoch` revokes sessions; no API-key kill switch | — | P1 | yes | reuse the epoch pattern | PLATFORM-S1 |
| H1 IP/client rate limits | BUILT | `customerAuth.ts:68-98` four `express-rate-limit` limiters, `rateLimitKeyGenerator` from `infra/clientIp.ts` | — | P1 | met | keep | — (ALREADY BUILT) |
| H2 Account-specific limits | BUILT | `users.failed_login_attempts` + `lockout_until` (`customerAuth.ts:789-832`) | — | P1 | met | keep | — (ALREADY BUILT) |
| H3 Lockout | BUILT | `MAX_FAILED_ATTEMPTS`, `ATTEMPT_RESET_HOURS`, lockout email (`customerAuth.ts:347-387`), audit event | — | P1 | met | keep | — (ALREADY BUILT) |
| H4 Progressive delay | MISSING | binary lock, no escalation | low value given H1–H3 | P3 | no | skip | — (NOT NEEDED) |
| H5 MFA | BUILT | `src/api/routes/mfa.ts`, `MFA_SECRET_KEY` live on prod | — | P1 | met | keep | — (ALREADY BUILT) |
| H6 SSO | BUILT | `src/api/routes/sso.ts`, `sso_config`, `sso_login_codes` | schema validator is a no-op [[saml-schema-validator-noop]] | P1 | met for launch | close before 1st SSO customer | PLATFORM-S1 |
| H7 Suspicious-login detection | PARTIAL | `test/isolation/authAnomalyLedger.test.ts`; ledger empty in prod [[auth-anomaly-tier2-cloudflare-ip-fragmentation]] | detector groups on rotating edge IPs | P2 | no | fix after F1 lands | PLATFORM-S1 |
| H8 Session revocation | BUILT | `users.session_epoch` + `se` claim (#819) | — | P1 | met | keep | — (ALREADY BUILT) |
| H9 Bot/challenge controls | MISSING | no Turnstile/reCAPTCHA/hCaptcha in repo | credential stuffing is only IP-limited | **P1** | yes | Turnstile on login+signup — **needs F1 first** | PLATFORM-S1 |
| H10 Breached-password detection | MISSING | no HIBP integration | weak passwords accepted | P2 | no | k-anonymity HIBP at signup/reset | PLATFORM-S1 |
| H11 Auth audit events | BUILT | audit rows on lockout/login paths | — | P1 | met | keep | — (ALREADY BUILT) |
| I1 Webhook signature verification | BUILT | `src/api/webhooks/stripeWebhook.ts` (`constructEvent`), `infra/verifyWebhookSignature.ts`, `middleware/verifyLemonWebhook.ts` | — | P1 | met | keep | — (ALREADY BUILT) |
| I2 Outbound webhook signing | BUILT | `src/api/lib/webhookSigning.ts` (HMAC) | — | P1 | met | keep | — (ALREADY BUILT) |
| I3 Server-to-server auth | BUILT | `SCHEDULER_SECRET`, `SECURELOGIC_ISSUE_VERIFY_KEY` (`infra/verifyIssueSignature.ts`), AWS SigV4 (`lib/connectors/awsSigV4.ts`) | — | P1 | met | keep | — (ALREADY BUILT) |
| I4 Machine API auth | BUILT | `SECURELOGIC_API_KEYS` + `requireApiKey` + SHA-256-keyed limiter | no per-key rotation/revocation | P2 | no | see G9 | PLATFORM-S1 |
| I5 HMAC on browser mutations | **NOT NEEDED** | cookies + `SameSite` + `frame-ancestors 'none'` + `form-action 'self'` | no threat model requires it | P3 | no | **do not build** | — (NOT NEEDED) |
| J1 API versioning | MISSING | no `/v1` prefix on SecureLogic routes (`routes/index.ts`); the `/v1` hits are outbound third-party | cannot break anything safely | P2 | no | version at first external integrator | PLATFORM-E1 |
| J2 External API contract | MISSING | no OpenAPI/schema doc | — | P2 | no | ships with J1 | PLATFORM-E1 |
| J3 Deprecation/Sunset headers | MISSING (dead code exists) | `src/_frozen_prod/versioning/DeprecationPolicy.ts`, `lifecycle/ApiLifecycleV1.ts` — **nothing imports them** | policy exists on paper only | P2 | no | revive or delete | PLATFORM-E1 |
| K1 Semantic HTML / labels | PARTIAL | 68 of 431 `.tsx` files contain `aria-` | ad-hoc | P1 | partial | fix the 6 launch flows only | PLATFORM-E1 |
| K2 Automated a11y testing | MISSING | no `axe`/`jest-axe`/`eslint-plugin-jsx-a11y`/Playwright in `app/package.json` | regressions invisible | **P1** | yes | `eslint-plugin-jsx-a11y` + axe on 6 flows | PLATFORM-E1 |
| K3 WCAG 2.2 AA certification | DEFER | — | — | P2 | no | after first customer | — (DEFER) |
| L1 Tenant feature flags | PARTIAL | env-level flags (`render.yaml`) + one per-org override: `organizations.core_platform_capability` (`lib/corePlatformCapability.ts`) | 2 layers, not 4 | P2 | no | formalise the resolver | PLATFORM-E1 |
| L2 Tenant configuration | PARTIAL | `routes/orgSettings.ts`, `dashboard_preferences`, `risk_settings`, `alert_preferences` | per-feature, not general | P2 | no | keep per-feature for now | PLATFORM-E1 |
| L3 Entitlement | BUILT | `middleware/requireEntitlement.ts`, `infra/entitlementStore.ts`, `SECURELOGIC_ENTITLEMENTS` | — | P1 | met | keep | — (ALREADY BUILT) |
| L4 Custom fields | MISSING | no `custom_field_definitions` table | — | P2 | no | build at 1st enterprise ask, EAV-with-typed-columns | PLATFORM-E1 |
| L5 Per-tenant schema migrations | **NOT NEEDED** | — | — | P3 | no | **never** at this scale | — (NOT NEEDED) |
| M Tenant compute isolation | NOT NEEDED NOW | shared workers, org-concurrency cap already proven (#826 `org_concurrency.limit: 2`) | — | P3 | no | quotas before dedicated compute | — (DEFER) |
| N1 Read replicas | NOT NEEDED NOW | no replica references anywhere | — | P3 | no | **DEFER** | — (DEFER) |
| N2 Optimistic concurrency | MISSING | no version/`row_version` columns; no `If-Match` | last-write-wins on concurrent edits | P2 | no | add to contested aggregates only | PLATFORM-E1 |
| O1 AI model routing | MISSING | 39 hard-coded `claude-sonnet-4-6` refs; `claude-haiku-4-5` present but not policy-selected | no cost/complexity routing | P2 | no | classify first, route second | PLATFORM-AI1 |
| O2 Model fallback | PARTIAL | `infra/providerQuotaAlert.ts` observes the throw path | no cross-model fallback | P2 | no | ships with O1 | PLATFORM-AI1 |
| P1 Repeated context | PARTIAL | `lib/llm/verdictCache.ts` — digest-keyed, tenant-scoped, stampede-controlled | pattern exists for **one** capability | P2 | no | generalise | PLATFORM-AI1 |
| P2 Anthropic prompt caching | MISSING | no `cache_control` anywhere in `src/` or `services/` | leaving the cheapest win untaken | P2 | no | add to the long-prompt call sites | PLATFORM-AI1 |
| Q1 AI cost telemetry — capture | BUILT | `lib/llm/llmTelemetry.ts` — tokens, cache tokens, latency, model, estimated cost, `unpriced_calls` | — | P1 | met | keep | — (ALREADY BUILT) |
| Q2 AI cost telemetry — attribution | PARTIAL | `withLlmCallContext` used in only 3 files: `llmControlMatcher.ts`, `intelligenceBriefGenerator.ts`, `briefSynthesizer.ts` | SOC-2 extraction, Ask, evidence/assessment analyzers uninstrumented | **P1** | yes | wrap the remaining call sites | PLATFORM-AI1 |
| Q3 AI cost telemetry — sink | **PARTIAL — logs only** | `llmTelemetry.ts:221` `logger.info`; no `llm_*` table in `db/migrations/` | margin is not queryable | **P1** | yes | one append-only table | PLATFORM-AI1 |
| R1 Timeouts | PARTIAL | `lib/connectorHttpClient.ts:43` `AbortSignal.timeout`; `lib/webhookDispatcher.ts:147-148` 10 s | Stripe/Resend/Anthropic use SDK defaults | P1 | yes | one shared policy | PLATFORM-R1 |
| R2 Retry/backoff | PARTIAL | `lib/dataRightsWorkerPolicy.ts`, `lib/vendorExtractionWorkerPolicy.ts`, `webhookDispatcher` `next_retry_at` | per-worker, no shared jitter | P2 | no | consolidate | PLATFORM-R1 |
| R3 Circuit breakers | MISSING (dead code exists) | `src/_frozen_prod/resilience/CircuitBreakerV1.ts` — **nothing imports it** | — | P2 | no | **only** for AI + connectors | PLATFORM-R1 |
| R4 Concurrency limits | PARTIAL | Brief scheduler org-concurrency cap (#826) | not applied to outbound HTTP/AI | P2 | no | ships with R1 | PLATFORM-R1 |
| R5 Idempotency | BUILT | `__tests__/webhookIdempotency.test.ts`; `verdictCache` reserve/settle; ledger-deduped alert sweeps | — | P1 | met | keep | — (ALREADY BUILT) |
| S Bulkheads | MISSING | one unbounded pool shared by every path (C1) | one slow dependency can starve everything | **P1** | yes | ships with C1 | PLATFORM-R1 |
| T MCP tooling | NOT APPLICABLE | no `.mcp.json`, no in-repo MCP wrappers | nothing to inventory | P3 | no | **do not build** | — (NOT NEEDED) |
| — Dead code quarantine | ARCHITECTURAL DEBT | `src/_frozen_prod` 1.4 MB, `src/_excluded_prod` 524 KB, `src/_server_DISABLED` 188 KB — no live imports | ~2.1 MB that reads as built capability | P2 | no | delete or promote | DOCUMENTATION ONLY |
| — `services/delivery-worker` | ARCHITECTURAL DEBT | exists in `services/`; **not** a declared or live Render service; `.github/workflows/delivery-worker.yml.disabled` | phantom worker | P2 | no | delete or declare | DOCUMENTATION ONLY |

---

## 2. Area findings

### A. Observability / user experience

**Verdict on the end-to-end trace question — `browser → API → middleware/auth → database → cache → third-party → response`: NO. We cannot trace that today, and the break is at the second hop.**

`src/api/lib/sentry.ts` says so in its own header: the engine is an ES module, so `http` and
`express` are imported before `initSentry()` runs, and Sentry's incoming-HTTP tracing
instrumentation patches `http` at require time. Error capture works (it is wired independently
at `src/api/app.ts:478`); **automatic span creation on the engine does not.** `tracesSampleRate:
0.1` is set on both tiers, so the app produces browser spans that arrive with no server span to
attach to. The documented fix — a dedicated `--import ./instrument.mjs` preload wired into the
start command — is already identified in `docs/sentry-setup.md` and was deliberately deferred.

Beyond that break there is nothing to trace *into*: no DB span, no Redis span, no outbound-HTTP
span. So the chain fails at hop 2 and would fail again at hops 4, 5 and 6.

What is genuinely good here and should not be rebuilt:

- **Privacy controls are the strongest part of the observability stack.** `scrubEvent` +
  `deepScrub` (depth-capped, cycle-safe) strip `password/token/apikey/sessiontoken/mfacode/
  refreshtoken` at any nesting depth, delete `request.data` and `request.cookies` wholesale, and
  strip `authorization/cookie/x-api-key` headers. `httpLogger.ts` refuses to log bodies or
  querystrings at all (`safePathOnly`) — which is the correct standing answer to
  [[token-in-url-request-log-exposure]]. This is above the bar for a GRC vendor and needs no work.
- **Per-request latency already exists** in the pino-http completion record. A12/A13 is an
  aggregation problem, not an instrumentation problem — that distinction is the difference
  between a one-week package and a three-week one.

Session Replay, rage-click and dead-click are all one feature (`replayIntegration`) and all
`NOT NEEDED NOW`. They are support-burden tools. We have no customers generating support burden,
and replay on a GRC console is a data-governance question (it records tenant screens) that we
should not answer casually to buy a feature we cannot yet use.

### B. Application performance

**Finding: the cause of the reported slowness cannot currently be determined, and any
optimisation started today would be a guess.** That is the honest answer and it is also the
actionable one.

What was inspected and what it shows:

- **Frontend/bundle** — no bundle analyzer configured; no `web-vitals`. No field evidence exists.
- **Server rendering** — the app is a BFF: 20+ server-side modules call the engine via
  `ENGINE_API_URL` (`app/src/lib/api.ts:43` and the `actions.ts` files). Every page render is at
  least one internal network hop. Untimed.
- **N+1 / duplicate / sequential queries** — the shapes are present. Per-row `await client.query`
  inside `for…of` loops appears in `cyberSignalProcessingService.ts` (842, 916, 1102, 1215),
  `vendorEngagements.ts` (753, 1847), `findings.ts:2342`, `vendorAssuranceDocuments.ts:718`,
  `applicabilityAssessmentWriter.ts` (85, 138, 148). Most are **write** loops, where per-row
  round-trips are ordinary and often correct. `Promise.all` appears in 45 files, so parallelism
  is used deliberately in places. **Without query timing, none of this can be ranked**, and
  rewriting write loops on suspicion is the classic way to trade correctness for no measured gain.
- **Indexes** — 354 `CREATE INDEX` statements across 144 of 261 migrations. Index coverage is not
  obviously thin; missing-index claims need `pg_stat_statements`, which is not in use.
- **Connection acquisition / pool exhaustion** — see §C. This is the single most likely
  explanation for *intermittent* slowness that looks like a hang, and it is currently unmeasurable.

**Top instrumentation gaps blocking causal proof, in the order that pays:**

1. **DB query timing + pool-wait timing** (A15/A16). The `pg` Proxy at
   `src/api/infra/postgres.ts` already intercepts every `query()` and `connect()` — the seam
   exists, one wrapper populates the entire gap.
2. **Route latency aggregation** (A12/A13). The numbers are already in the logs.
3. **`pg_stat_statements`** (A19). Turns "some query is slow" into a ranked list.
4. **Engine tracing preload** (A6). Connects hops 1–2 and makes 1–3 attributable per request.
5. **Outbound dependency timing** (A14). Distinguishes "we are slow" from "Anthropic is slow".

Do not optimise before 1–3 exist. They are days of work and they convert every later performance
decision from opinion into evidence.

### C. Postgres / connection pooling

**The P0 in this area is one missing option.**

```ts
// src/api/infra/postgres.ts:50
const pool = new Pool({ connectionString: databaseUrl, ssl });
```

No `max`, no `idleTimeoutMillis`, no `connectionTimeoutMillis`. Under `node-postgres` defaults
that means `max: 10`, `idleTimeoutMillis: 10000`, and — the dangerous one —
**`connectionTimeoutMillis: 0`, which waits forever.** When the pool saturates, requests do not
fail; they queue silently until the client or Render's proxy gives up. That is
indistinguishable from "the app is slow", produces no error, no Sentry event and no log line,
and is a strong candidate for the reported slowness. It is also precisely why §B cannot be
answered without §C being fixed.

`pgElevated` (`postgres.ts:71`) is a second unbounded pool in the same process. Every worker
service importing the same module adds its own pair. Nobody has counted the total against the
Render Postgres connection limit.

**PgBouncer assessment.**

Compatible today:

- RLS context is **transaction-local** — `set_config('app.current_org_id', $1, true)` in
  `withTenant`. The `true` third argument is `SET LOCAL` semantics. This is the property that
  usually blocks transaction pooling for RLS applications, and we already have it right.
- Application advisory locks are **transaction-scoped**: `pg_advisory_xact_lock` at
  `lib/assetAutoCreation.ts:215`, `routes/findings.ts:1572`, `lib/applicabilityAssessmentWriter.ts:93`.
- A lint rule already polices session-scoped statements inside `asTenant`
  (`src/api/__tests__/lintRuleNoUnrewriteableStmt.test.ts`).

The one blocker:

- `src/api/infra/advisoryLock.ts` uses **session-scoped** `pg_try_advisory_lock($1)` and
  `pg_advisory_unlock($1)`, holding a checked-out client across the whole callback. Under
  transaction pooling the lock and the unlock are not guaranteed to land on the same backend, so
  the lock leaks or the unlock targets the wrong session. Callers:
  `services/intelligence-worker/src/runner.ts:110` and `services/delivery-worker/src/runner.ts:304`.
  Both are worker singleton guards — exactly the case `pg_advisory_xact_lock` cannot serve, and
  exactly the case a pooler breaks.

```
PGBOUNCER: RECOMMENDED LATER
```

Not now. We do not have a connection-count problem — we have an unbounded-pool problem, and
adding a pooler on top of an unbounded pool hides the bug rather than fixing it. Set explicit
pool bounds first, measure with A16, and revisit only if the measured connection budget is
actually the constraint. Convert `advisoryLock.ts` before any pooler is enabled.

### D. Redis / cache / rate limiting

Live: `REDIS_URL` is set on the production engine. Provider is not derivable without reading
the secret value, which this audit will not do — `NEEDS INFRASTRUCTURE VERIFICATION`, and worth
one line in a runbook.

Fourteen consumers, all in the engine: tier and API rate limiting, portal-exchange rate
limiting, admin rate limiting and lockout, usage caps, entitlement caching, feed ETag storage,
issue storage, account recovery, self-test. `src/api/infra/redis.ts` is a single lazy client
with a stampede-guarded connect promise, a 1500 ms connect timeout and a bounded reconnect
strategy (100 ms → 2 s, capped). Limiters wrap every Redis call in a 1200 ms timeout.

No distributed locks in Redis (they are in Postgres) and no sessions in Redis (JWT +
`session_epoch`). Both are correct choices, not gaps.

**The one real finding: every limiter fails open.** `apiRateLimiter.ts` returns `next()` when
`redisReady` is false or a Redis call times out, on the stated principle that "rate limiting must
never block the API". That is the right default for *quota* limiting and the wrong default for
*authentication* limiting: a Redis outage silently removes brute-force protection. Note the login
limiter itself is `express-rate-limit` in-memory (`customerAuth.ts:68-98`), so login is not
wholly dependent on Redis — but `adminLockout.ts` and `portalExchangeRateLimiter.ts` are.
Fail-closed belongs on those two only.

```
KEEP CURRENT — UPSTASH NOT NEEDED
```

Upstash would solve a problem we have not demonstrated. There is no evidence of Redis capacity
pressure, no multi-region requirement, and the failure behaviour we care about is in *our*
code, not the provider's. Swapping vendors would leave the fail-open defect exactly where it is.
Revisit only if a measured Redis constraint appears.

### E. Deployment platform

```
KEEP RENDER
```

Railway solves none of the deficiencies actually observed. The real operational problems are:

1. **`autoDeploy: true` on all six production services** (only `securelogic-website` is false).
   The engine → workers → app deploy order that R-5 requires is unachievable: only the engine
   runs `npm run migrate`, so workers boot on promoted code before their migrations land. This is
   a *configuration* defect and it exists identically on any platform with auto-deploy on.
2. **Declared ≠ live.** `render.yaml` declares 14 services; the API returns 17. `securelogic-demo-app`,
   `securelogic-demo-engine` and the suspended `securelogic-intelligence-api` are undeclared.
3. Render's `*.onrender.com` origins are publicly reachable (§0.2) and Render offers no inbound
   IP allowlist on these plans. **This is the one deficiency a platform migration could
   theoretically address** — and it is far better addressed by origin authentication than by
   moving the whole estate.

Everything else the brief lists — reliability, rollback, workers, Postgres, Redis, scaling — is
being served adequately. A migration now would consume the entire pre-launch window and
reset the operational knowledge encoded in a dozen runbooks. `EVALUATE RAILWAY` is not even
warranted yet; revisit only if origin authentication proves impossible on Render.

### F. Cloudflare / origin security

Current actual architecture:

```
Internet → ParkLogic wildcard DNS/TLS (172.237.129.x)   [branded hostnames — NOT us]
Internet → Render edge (216.24.57.7) → Render service   [*.onrender.com — the live product]
```

There is no `Internet → Cloudflare → Render` path. §0.1 and §0.2 carry the evidence.

Item-by-item:

- **Custom domains** — Render holds `app.securelogicai.com` (app), `securelogicai.com` +
  `www.securelogicai.com` (website), all `verified`. The engine and staging engine have **none**,
  so `api.securelogicai.com` was never wired to the engine at Render at all.
- **`onrender.com` origin exposure** — confirmed reachable. `/health` returns 200 unauthenticated.
- **Cloudflare proxy state** — not applicable; the zone is not at Cloudflare.
- **Origin IP/hostname leakage** — moot. The origin hostname is the public entry point.
- **Render inbound IP restrictions** — not available on these service plans.
- **Cloudflare IP allowlisting feasibility** — not feasible at Render without an allowlist feature.
- **Authenticated Origin Pull** — the correct fix, blocked on F1. Render terminates TLS itself
  and does not expose client-certificate verification, so the practical equivalent is a **shared
  secret header** injected by a Cloudflare Worker/transform rule and required by engine
  middleware, with a `/health` exemption.
- **Host header behaviour** — untested; belongs in the same package.
- **Health endpoints** — `/health` intentionally unauthenticated. Correct; keep it exempt.
- **API origin exposure** — the engine is fully public today.
- **SSL mode** — `NOT DETERMINABLE`. There is no Cloudflare zone, so the Flexible/Full/Full-strict
  question has no current answer. **When F1 is resolved, the target is Full (strict) and nothing
  less** — Render presents a valid publicly-trusted certificate, so Full (strict) works
  immediately and Flexible would be a security issue (plaintext Cloudflare→origin).

**Safe migration path, in strict order:**

1. Operator: repoint `securelogicai.com` nameservers away from ParkLogic to Cloudflare.
2. Cloudflare zone: SSL mode **Full (strict)** *before* proxying anything.
3. Add `api.securelogicai.com` as a Render custom domain on `securelogic-engine`; verify.
4. Proxy (orange-cloud) `app` and `api`; confirm the app still serves through the branded names.
5. Add the shared-secret origin header at the Cloudflare edge; deploy engine middleware in
   **log-only** mode; confirm 100 % of legitimate traffic carries it.
6. Flip the middleware to enforcing, `/health` exempt.
7. Only then: WAF rules, bot management, the `/admin` IP allowlist (ADR-0011), and re-run the
   Tier-2 auth-anomaly detector fix ([[auth-anomaly-tier2-cloudflare-ip-fragmentation]]).

Steps 1–4 are operator-owned. Steps 5–6 are the only engineering in this area.

### G. Secrets / credential management

The distinction the brief asks for, answered directly:

| Class | State |
|---|---|
| **Developer local `.env`** | Untracked by design — `.gitignore:4-6` ignores `.env` and `.env.*` with `!.env.example` |
| **Committed `.env`** | **None.** `git ls-files` returns only `.env.example`, `app/.env.example`, `website/.env.example` |
| **Production secret storage** | Render service environment. Every secret in `render.yaml` is `sync: false`, so values live in the dashboard, never the repo |

Inventory (keys only; no values were read): 70 keys on the prod engine, 16 on the prod app.
Third-party credentials present: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` +
4 price IDs + `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`, five `R2_*`
keys, `DATABASE_URL`, `REDIS_URL`, `ALERT_WEBHOOK_URL`. Signing/crypto: `JWT_SECRET`,
`SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `MFA_SECRET_KEY`, `SECURELOGIC_SIGNING_SECRET`,
`SECURELOGIC_ISSUE_VERIFY_KEY`, `SCHEDULER_SECRET`, `UNSUBSCRIBE_SECRET`.

**Scanning:** dependency auditing is real and gating — `.github/workflows/ci.yml:100-114` runs
`scripts/ci/auditGate.mjs`, fails on any non-waived advisory, with per-GHSA expiring waivers in
`.audit-waivers.json` and proofs in `src/api/__tests__/auditGate.test.ts`. **Secret scanning is
absent** — no gitleaks, no trufflehog, no detect-secrets. Given that the repo is clean today,
this is cheap insurance rather than remediation, and it is the single highest-value G item.

Of the five capabilities the brief asks about:

1. **External secret manager — NOT NEEDED NOW.** 70 keys, one platform, one operator. Render's
   env store is the right tool at this size; a Vault/Secrets-Manager migration would add an
   availability dependency to every boot for no current benefit.
2. **Dual-key rotation — P2, needed before the second enterprise customer.** `JWT_SECRET` and
   `SECURELOGIC_SIGNING_SECRET` are single-valued, so rotation invalidates every live token at
   once. An `_NEXT`-suffixed second key accepted on verify converts rotation from an incident
   into a deploy.
3. **Automated rotation — DEFER.** Manual rotation plus a runbook is proportionate.
4. **Rotation audit log — DOCUMENTATION ONLY.** The precedent exists
   ([[prod-credential-rotation-2026-08-11]]); systematise it as a runbook, not a feature.
5. **Emergency revocation — P1, partially built.** `users.session_epoch` gives instant global
   session revocation. There is no equivalent for `SECURELOGIC_API_KEYS`; reuse the epoch pattern.

### H. Credential-stuffing defense

Genuinely strong, and better than expected:

- **argon2id** with `memoryCost: 65536, timeCost: 3, parallelism: 4` (`customerAuth.ts:451-452`).
- **Four independent IP-keyed limiters** — signup, login, forgot-password, verify
  (`customerAuth.ts:68-98`), all keyed through `rateLimitKeyGenerator` from `infra/clientIp.ts`
  so the enforcing limiter and the audit trail agree on client identity.
- **Account lockout** — `failed_login_attempts`, `lockout_until`, `last_failed_login_at`, an
  `ATTEMPT_RESET_HOURS` decay window, a notification email to the account holder
  (`customerAuth.ts:347-387`), and an audit event carrying `reason: "lockout"` with the email
  truncated to four characters.
- **Timing equalisation** — a dummy argon2 hash is verified when the user does not exist
  (`customerAuth.ts:805`), so login does not leak account existence by response time.
- **MFA** (`routes/mfa.ts`), **SSO** (`routes/sso.ts`), and **global session revocation**
  (`session_epoch`, #819).

Two real gaps and one non-gap:

- **Bot/challenge controls — MISSING, P1.** No Turnstile, reCAPTCHA or hCaptcha anywhere. A
  distributed stuffing attack from many IPs defeats per-IP limiting and merely locks out the
  legitimate users whose accounts were targeted — the lockout becomes the attacker's DoS.
  **This depends on F1**: Turnstile is a Cloudflare product and there is no Cloudflare zone yet.
- **Breached-password detection — MISSING, P2.** The k-anonymity HIBP range API needs no key and
  no PII egress (five hash characters leave the building). Worth doing at signup and reset.
- **Progressive delay — NOT NEEDED.** With four limiters plus lockout plus argon2's inherent
  cost, incremental delay adds complexity and a new DoS surface for no meaningful gain.

**Smallest enterprise-ready defense stack:** what exists today, **plus** Turnstile on login and
signup, **plus** HIBP at signup/reset, **plus** fail-closed on the Redis-backed auth limiters
(D5). That is three additions, not a programme.

### I. Request signing

Already comprehensive. Inbound verification: Stripe (`webhooks/stripeWebhook.ts` via
`constructEvent`), Resend (`RESEND_WEBHOOK_SECRET`), Lemon Squeezy
(`middleware/verifyLemonWebhook.ts`), and the intelligence issue channel
(`infra/verifyIssueSignature.ts`). Outbound signing: `lib/webhookSigning.ts` HMACs customer
webhooks. Service-to-service: `SCHEDULER_SECRET` and AWS SigV4 for connectors
(`lib/connectors/awsSigV4.ts`). Machine API: `SECURELOGIC_API_KEYS` with a SHA-256-keyed limiter.

**The boundaries that should require cryptographic request signing — the complete list:**

1. **Inbound third-party webhooks** — already signed and verified. Non-negotiable, done.
2. **Outbound customer webhooks** — already signed. Customers must be able to verify us.
3. **Cross-service calls that cross a trust boundary** — the scheduler → engine call, and the
   proposed Cloudflare → Render origin header (§F step 5).
4. **Machine/API-key traffic** — signing (not just bearer keys) becomes appropriate when a
   customer integration handles data whose replay is itself harmful. Not yet.

**And the boundary that explicitly should NOT: authenticated browser mutations.**
The brief already flags this and the flag is right. Cookie-based session auth with `SameSite`,
`frame-ancestors 'none'` and `form-action 'self'` (all live, confirmed in the observed response
headers) covers the CSRF threat model. HMAC-signing browser mutations would require shipping a
signing key to the browser, which is not a secret, so it would add ceremony and zero security.
**Do not build it.**

### J. API lifecycle

No versioning today. SecureLogic's own routes are unversioned (`/api/...` in `routes/index.ts`);
the `/v1` matches in the codebase are all *outbound* third-party endpoints.

A lifecycle policy exists — but only as dead code. `src/_frozen_prod/lifecycle/ApiLifecycleV1.ts`,
`src/_frozen_prod/lifecycle/assertApiActive.ts` and `src/_frozen_prod/versioning/DeprecationPolicy.ts`
are in a quarantined tree that nothing imports (`package.json:31` runs its tests in isolation as
`test:prod`). Reading the repo, it is easy to conclude API lifecycle management is built. It is not.

**Minimum policy before exposing a supported enterprise integration API** — five items, no more:

1. **Version in the path** (`/api/v1/...`), with the current unversioned routes aliased so nothing
   breaks.
2. **A written compatibility contract**: additive changes ship any time; removals and semantic
   changes require a new version.
3. **`Deprecation` and `Sunset` headers** on any route scheduled for removal — the
   `_frozen_prod` implementations are a starting point, but they should be reviewed rather than
   revived blindly.
4. **A minimum sunset window** — 180 days for enterprise, announced by email, not only by header.
5. **A published changelog** with a migration note per breaking change.

None of this is needed for Sept 15, because no external integrator exists. It is needed the day
we sign one.

### K. Accessibility

Target: **WCAG 2.2 AA**.

Current engineering state is ad-hoc. 68 of 431 `.tsx` files contain any `aria-` attribute.
Focus management and modal semantics appear in a handful of components
(`GovernanceDecisionPanel.tsx`, `AskClient.tsx`, `PostureDashboard.tsx`, `ConsentInterstitial.tsx`,
`FieldOverrideModal.tsx`, `LifecyclePanel.tsx`) — evidence of care in places, not a standard.
Testing tooling: `@testing-library/*` is present; **`axe-core`, `jest-axe`,
`eslint-plugin-jsx-a11y` and Playwright are all absent**. There is no automated check, so there
is no way to know whether accessibility is improving or regressing.

**Required before first real customer** (a GRC buyer is disproportionately likely to be a
regulated entity with a VPAT/508 question in procurement):

- `eslint-plugin-jsx-a11y` in the lint gate — catches missing labels, bad roles, non-interactive
  handlers at zero runtime cost.
- `axe` assertions on the **six flows we actually sell**: login, dashboard, findings list,
  finding detail, vendor list, Brief view.
- Keyboard-only traversal of those same six flows, done by hand once, defects filed.
- Visible focus indicators and contrast verified against AA on the shared component set.

**Deferred to later maturity:** full-catalogue remediation, screen-reader certification, a
published VPAT, charts and data-table accessibility beyond a text alternative. Those are
certification work; the four items above are engineering hygiene.

### L. Tenant customization / extension model

What exists:

- **Entitlement** — real and central: `middleware/requireEntitlement.ts`,
  `infra/entitlementStore.ts`, `SECURELOGIC_ENTITLEMENTS`.
- **A genuine two-layer override** — `lib/corePlatformCapability.ts` implements
  *entitlement default → explicit per-org grant* (`organizations.core_platform_capability`),
  additively, replaying the original denial body when neither leg admits. This is the correct
  shape and its "STOP GATE" comment shows the commercial cutover was deliberately reserved.
- **Per-feature tenant configuration** — `routes/orgSettings.ts`, plus `dashboard_preferences`,
  `risk_settings`, `alert_preferences`, `brief_subscriber_preferences`, and the assignment/SLA
  alert preferences.

What does not exist: a general effective-configuration resolver, and custom fields.

**On the proposed `global default → environment → plan/entitlement → tenant override` model:**
adopt it as the *stated* model, because two of its four layers are already implemented and
the code is consistent with it. But implement the resolver only when a third layer is actually
needed. Formalising four layers today would be architecture ahead of requirement — and this
codebase's standing rule is to prefer the shared abstraction *when a second caller exists*, not
before.

**On custom fields** — the constraints in the brief are correct and should be held:

- **No customer-specific core columns.** Non-negotiable.
- **No per-tenant schema migrations.** `NOT NEEDED` at this scale and probably ever — 261
  migrations applied in order is already the tightest constraint in the release process
  (see the R-1 rehearsal); multiplying it per tenant would end the ability to promote safely.
- The right model is `custom_field_definitions` (org-scoped, typed, validated at write) plus a
  value table with **typed columns rather than a single JSON blob** — `value_text`,
  `value_numeric`, `value_date`, `value_boolean`, exactly one non-null, enforced by a CHECK. That
  keeps values indexable and comparable, which a JSON blob does not.
- **Tenant isolation via RLS on both tables**, same channel as every other tenant table.
- **Index strategy:** partial indexes per `(organization_id, definition_id)` on the populated
  typed column. Do not index all four speculatively.

Build it when the first enterprise prospect asks, not before. Design it now, in one page.

### M. Tenant compute isolation

**NOT NEEDED NOW.** Shared workers with an org-concurrency cap is the correct architecture at
this scale, and the cap is already proven to work — #826's Tier-1 evidence shows the Brief
scheduler reporting `org_concurrency: { limit: 2, peak_in_flight: 0 }`.

Future ladder, in the order it should be climbed, each step justified by evidence rather than
anticipation:

1. **Shared workers** (today).
2. **Workload concurrency quotas per org** — the first real step; prevents one large tenant's
   backfill from starving everyone. Build when a tenant's job volume is measurably outsized.
3. **Tenant-scoped queues** — only if quotas prove insufficient because head-of-line blocking,
   not capacity, is the problem.
4. **Dedicated worker pool** — a commercial feature (an Enterprise SKU promise), not a technical
   necessity.
5. **Dedicated enterprise compute** — a contractual/compliance requirement (data residency,
   isolation attestation), never a performance decision.

Do not build 2–5 speculatively.

### N. Read replicas / consistency

**DEFER.** No replica references exist anywhere in the codebase, and no measured read load
justifies one. A replica added now would introduce staleness bugs into a system that has no
read-your-writes handling and would be debugging pain for zero benefit.

Documented future architecture, for when load justifies it:

- **Write → primary affinity.** All writes to the primary; the pool that serves a mutation
  continues to serve that request.
- **Read-your-writes window.** After a write, pin that user's (or org's) reads to the primary for
  a bounded window — a short per-session marker is sufficient and avoids a distributed
  consistency protocol.
- **Replica routing** by query intent, declared explicitly at the call site. Never by heuristic
  SQL inspection.
- **Replica lag monitoring** as a hard gate: if lag exceeds the read-your-writes window, route
  everything to the primary and alert. A replica that silently exceeds its lag budget is worse
  than no replica.

**On concurrency control today — a real P2 finding.** There are **no version or `row_version`
columns anywhere** in the domain schema and no `If-Match`/`ETag` on mutations. Concurrent edits
to the same record are last-write-wins by default. That is tolerable for most objects and
**not** tolerable for the ones where two people genuinely collaborate under governance:
findings (decision state), risks (treatment/acceptance), assessments and control responses,
vendor engagement responses. Add optimistic concurrency to **those aggregates specifically** —
a `version` column, checked on update, returning `409` on mismatch. Do not add it globally;
global optimistic concurrency taxes every write for a problem most tables do not have.

And per the brief: **do not implement global last-write-wins as a policy.** It is the current
*default* by omission; making it a stated policy would be the wrong ruling.

### O. AI model routing

No routing exists. `claude-sonnet-4-6` is referenced 39 times as a hard-coded literal;
`claude-haiku-4-5` appears but is not selected by any policy. Model choice is a constant at each
call site, so it cannot vary by complexity, cost, latency, sensitivity or task type. Fallback is
limited to `infra/providerQuotaAlert.ts`, which observes the *throw* path (429s, credit
exhaustion) — it alerts, it does not reroute.

**Where a cheaper model would plausibly be safe** — to be *tested*, not assumed, and not changed
in this window:

- Signal normalisation and classification (`services/intelligence-worker/src/pipeline/normalizeSignal.ts`)
  — structured extraction against a fixed schema.
- Brief item *enrichment* passes, as distinct from synthesis.
- Ask provenance/citation passes (`lib/ask/provenancePass.ts`), which verify rather than reason.

**Where it would not**: SOC 2 extraction (`lib/claudeSocExtractor.ts`) and CUEC matching, where a
formatting slip already cost us every clean report (#855); control matching, which writes
suggestions against a customer's control set; and Brief synthesis, which is the paid product.

Future router shape — `task classification → model policy → execution → fallback → verification`
— is the right design. The **prerequisite is Q**: routing decisions without per-task cost and
quality telemetry are unfalsifiable, and we would be unable to tell a successful downgrade from a
silent quality regression. **Q before O. Do not change model selection yet.**

### P. AI context / cache

**The pattern is already built — for exactly one capability.** `src/api/lib/llm/verdictCache.ts`
is a content-digest-keyed, tenant-scoped, stampede-controlled cache whose key is:

```ts
type VerdictKey = {
  organizationId: string;          // tenant identity IS part of the key
  signalDedupHash: string;         // content digest
  controlInventoryDigest: string;  // slowly-changing context digest
  promptVersion: string;           // invalidates on prompt change
};
```

It runs on the tenant channel inside `withTenant`, so RLS enforces scoping rather than the
application alone, and its reserve/settle split deliberately commits the reservation *before* the
multi-second LLM call so three separate matcher invocation paths cannot stampede — and so a
tenant transaction is never held open across an LLM call. This is a well-designed piece of
infrastructure that currently serves one caller.

**Repeated static or slowly-changing context that is rebuilt on every call and is not cached:**
organization profile, control inventory (digested for the matcher, not reused elsewhere), policy
set, assessment methodology, vendor context, risk taxonomy, framework/requirement text.

Two distinct, complementary wins:

1. **Generalise `verdictCache` into a shared digest-keyed context cache.** The key template above
   is correct and reusable as-is. **Tenant identity must remain part of every cache key** — the
   brief is right to make this a MUST, and the existing implementation already honours it.
2. **Anthropic prompt caching (`cache_control`) — completely unused.** No occurrence of
   `cache_control` anywhere in `src/` or `services/`. For calls carrying a long stable prefix
   (framework text, control inventories, extraction instructions), this is the cheapest available
   reduction and requires no architectural change. `llmTelemetry.ts` already prices cache reads at
   ~0.1× input and cache writes at ~1.25× input, so **the measurement for this optimisation is
   already built** — we would see the saving the day it ships.

### Q. AI cost telemetry

**Captured today** — `src/api/lib/llm/llmTelemetry.ts` is genuinely good work and its own header
explains why it landed before any optimisation: "an optimization you cannot measure is a story."
It records per call: model, purpose, organization, input/output tokens, cache-read and
cache-write tokens, latency, and an estimated cost from a hard-coded per-model price table — with
the discipline that an **unknown model yields `costUsd: null`, never `0`**, and increments an
`unpriced_calls` counter so a totals line can never read `$0.00` when the truth is "we do not know".

Against the brief's checklist:

| Field | State |
|---|---|
| tenant | ✅ via `withLlmCallContext({ organizationId })` |
| capability | ✅ `purpose` |
| model | ✅ |
| provider | ⚠️ implicit — Anthropic only; OpenAI calls are not routed through this |
| input tokens | ✅ |
| output tokens | ✅ |
| cached tokens | ✅ read and write, separately |
| latency | ✅ |
| failures | ⚠️ partial — `infra/providerQuotaAlert.ts` sees the throw path |
| retries | ❌ |
| estimated cost | ✅ |
| actual cost | ❌ — no provider invoice reconciliation |

**Two gaps make it unusable for margin work:**

1. **Attribution covers 3 of ~12 call sites.** `withLlmCallContext` appears only in
   `lib/llmControlMatcher.ts:439`, `lib/intelligenceBriefGenerator.ts:1276` and
   `lib/briefSynthesizer.ts:301,494`. Uninstrumented: `lib/claudeSocExtractor.ts`,
   `lib/vendorAssuranceCuecMatcher.ts`, `lib/claudeEvidenceAnalyzer.ts`,
   `lib/claudeAssessmentAnalyzer.ts`, `lib/ask/orchestrator.ts`, `lib/ask/provenancePass.ts`,
   `workers/askProvenanceWorker.ts`, `services/intelligence-worker/src/pipeline/llmClient.ts`.
   **The entire Vendor Assurance document path — our most expensive per-call workload — is dark.**
2. **The sink is a log line** (`llmTelemetry.ts:221`), not a table. There is no `llm_*` table in
   `db/migrations/`. Cost per tenant can only be reconstructed by scraping structured logs, which
   means margin cannot be queried, joined to billing, or trended.

**Minimum weekly AI gross-margin report** — the smallest thing that answers "are we making money
on this tenant, on this capability":

One append-only table, `llm_call_events`, written by the existing `recordLlmUsage` seam
(no call-site changes beyond the attribution wraps):

```
organization_id, purpose, model, provider, occurred_at,
input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
latency_ms, outcome (ok|error|retry), estimated_cost_usd (nullable), price_version
```

Org-scoped, RLS-enabled, written on the elevated channel (some calls are legitimately org-less).
The weekly report is then three queries:

1. **Cost by tenant** — sum `estimated_cost_usd`, plus a separate `unpriced_calls` count so an
   incomplete price table is visible rather than silently understated.
2. **Cost by capability × tenant** — the number that says which *feature* is unprofitable, which
   is the actionable one.
3. **Margin** — (2) joined against the tenant's subscription revenue from Stripe, producing gross
   margin per tenant and per capability.

Add one honesty rule, matching the module's existing discipline: **any report row containing
unpriced calls is labelled incomplete, never rounded to zero.**

### R. Circuit breakers / dependency resilience

**Do not put a circuit breaker around every function** — the brief is right, and the current
state is the opposite risk: `src/_frozen_prod/resilience/CircuitBreakerV1.ts` and
`assertCircuitClosed.ts` exist but **nothing imports them**. There is no live circuit breaker.

Inventory of every external dependency and what it actually has:

| Dependency | Timeout | Retry | Backoff | Jitter | Breaker | Concurrency limit | Idempotency | Telemetry | Failure classification |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic (LLM) | SDK default | SDK default | SDK default | — | ✗ | ✗ | ✅ verdict reserve/settle | ✅ `llmTelemetry` (3 sites) | ⚠️ quota only |
| OpenAI | SDK default | SDK default | SDK default | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| Stripe | SDK default | SDK default | SDK default | — | ✗ | ✗ | ✅ webhook idempotency | ✗ | ⚠️ webhook only |
| Resend (email) | ✗ | ✗ | ✗ | — | ✗ | ✗ | ⚠️ ledger dedupe on sweeps | ✅ provider events | ⚠️ suppression only |
| Scanner connectors | ✅ `connectorHttpClient.ts:43` | ⚠️ worker-level | ⚠️ | ✗ | ✗ | ✗ | ⚠️ | ✅ connector health | ✅ dead-letter |
| External intelligence feeds | ⚠️ per-adapter | ⚠️ | ⚠️ | ✗ | ✗ | ✗ | ✅ ETag/dedup | ✅ feed health | ✅ |
| Outbound webhooks | ✅ 10 s (`webhookDispatcher.ts:147`) | ✅ `next_retry_at` | ✅ | ✗ | ✗ | ✗ | ✅ | ✅ | ✅ |
| Redis | ✅ 1.2–1.5 s | ✅ bounded reconnect | ✅ capped | ✗ | ✗ | n/a | n/a | ⚠️ | ✅ fails open |
| Postgres | ✗ **unbounded acquire** | ✗ | ✗ | — | ✗ | ✗ **unbounded pool** | ✅ txns | ✗ | ✗ |
| Service-to-service HTTP (app→engine) | ⚠️ `AbortController` in places | ✗ | ✗ | — | ✗ | ✗ | n/a | ✗ | ✗ |

**Standardised outbound dependency policy** — one module, applied by classification, not
universally:

```
Every outbound call declares: { name, class, timeoutMs, retries, idempotent }

class = FAST_CRITICAL   (Redis, Postgres)
        → tight timeout, no retry, fail fast, bulkhead
class = SLOW_EXTERNAL   (Anthropic, OpenAI, connectors, feeds)
        → generous timeout, bounded retry with full jitter, breaker, concurrency cap
class = TRANSACTIONAL   (Stripe, Resend)
        → moderate timeout, retry ONLY when idempotent, no breaker (breaking billing
          is worse than a slow response), full telemetry
class = CUSTOMER_EGRESS (outbound webhooks)
        → already correct; keep as the reference implementation
```

Circuit breakers belong on **SLOW_EXTERNAL only** — AI providers and connectors. Those are the
dependencies where a stalled upstream converts into unbounded local resource consumption.
Breaking Stripe or Postgres would turn a degradation into an outage.

Every retry gets **full jitter**. Uniform exponential backoff across a worker fleet
resynchronises the fleet into a thundering herd, which is the failure mode retries are supposed
to prevent.

### S. Connection / resource bulkheads

**Yes — one failing dependency can exhaust shared resources today, and the mechanism is
identified.**

| Resource | Can one dependency exhaust it? | Mechanism |
|---|---|---|
| **DB pool** | **YES** | Unbounded `connectionTimeoutMillis` (§C1). Slow queries hold all 10 default connections; every subsequent request queues forever. No error, no metric, no alert. |
| HTTP sockets | Likely | Node's default agent has no global socket cap; a stalled upstream with no timeout accumulates sockets. Only `connectorHttpClient` and `webhookDispatcher` set timeouts. |
| Redis connections | No | Single shared client, bounded reconnect, hard timeouts. Correctly built. |
| Worker concurrency | Partially | Brief scheduler has an org-concurrency cap; other workers do not. |
| AI concurrency | **YES** | No cap on concurrent Anthropic calls. A slow-provider episode pins event-loop tasks and DB connections held by their callers. |
| Event loop | Indirectly | Unbounded pending promises from the above rather than CPU-bound work. |

**Recommended bulkheads — three, evidence-backed, not a blanket policy:**

1. **DB pool bounds** (`max`, `idleTimeoutMillis`, and above all a finite
   `connectionTimeoutMillis`) — converts a silent hang into a fast, loggable, alertable error.
   This is the P0 and everything else in §B depends on it.
2. **A separate, small pool for background/worker work** so a slow batch cannot consume the
   connections serving interactive requests. The `pgElevated` split is already the natural seam.
3. **A concurrency cap on outbound AI calls**, per process. A semaphore, not a queue service.

Do not bulkhead Redis (already safe) or add per-route pools (complexity without evidence).

### T. MCP / internal tooling

**NOT APPLICABLE — and this is a finding worth stating rather than an empty section.**

There is no `.mcp.json` in the repository and no MCP server or tool wrapper under `src/`,
`services/`, `scripts/` or `.claude/`. `.claude/` contains agents, skills and worktrees only.
There is therefore **nothing to inventory, and no CLI-duplicating wrapper to criticise**.

The brief's own warning — *do not assume every CLI needs an MCP wrapper* — is the right standing
answer, and the correct action is to keep it that way. An MCP wrapper earns its place only when
it adds at least one of: typed structure over free text, an authorization boundary the CLI does
not have, sandboxing, enforced context, auditability, stable machine-readable output, or remote
capability. A wrapper that shells out to a command a human could run adds token cost, a failure
mode and a maintenance burden, and returns nothing.

**If tooling is ever built, measure it from day one** — the design, recorded here so it is not
re-derived later:

- invocation count by tool name and caller
- latency p50/p95 per tool
- failure count by classification (bad input / upstream / timeout)
- retry count
- **result payload size in bytes** — the dominant hidden cost, and the one most often unmeasured
- tool-schema and tool-result tokens where the provider reports them (`llmTelemetry.ts` already
  captures usage, so the sink exists)

Two derived numbers make the keep/kill decision falsifiable: **tokens per successful invocation**
and **the ratio of result tokens to schema tokens**. A tool whose schema costs more than its
results return is a tool that should be deleted.

---

## 3. Proposed package roadmap

Grouped as requested. **Not every finding is in a package** — §4 lists what is deliberately excluded.

### PLATFORM-R1 — Observability / Performance / Resilience

*Rationale: this is the package that makes every later performance and reliability decision
evidence-based instead of speculative. It also contains the single P0 defect in the codebase.*

| # | Item | Type | Priority | Notes |
|---|---|---|---|---|
| R1-1 | Bound the DB pools — `max`, `idleTimeoutMillis`, finite `connectionTimeoutMillis` | code | **P0** | `postgres.ts:50` and `:71`. Convert a silent hang into a fast error |
| R1-2 | DB query + pool-wait timing via the existing `pg` Proxy | code | P1 | The seam already exists; slow-query threshold logging + fingerprinting ride along |
| R1-3 | Route latency aggregation → p50/p95/p99 | code | P1 | Data is already in the pino-http record — aggregate, do not re-instrument |
| R1-4 | Engine tracing preload (`--import ./instrument.mjs`) | code + config | P1 | Fixes the ESM ordering break; unblocks the end-to-end trace |
| R1-5 | `Sentry.setUser` with **org id only** — never email or name | code | P1 | Answers "which tenant is failing" without putting tenant identity in a third-party |
| R1-6 | Verify/enable `pg_stat_statements` | CONFIGURATION ONLY | P1 | Turns "something is slow" into a ranked list |
| R1-7 | Set `NEXT_PUBLIC_RENDER_GIT_COMMIT` on the prod app | CONFIGURATION ONLY | P2 | One env var; app errors become release-attributable |
| R1-8 | Web Vitals (LCP/INP/CLS) reporting | code | P2 | Near-zero once R1-4 lands |
| R1-9 | Shared outbound dependency policy module (timeout/retry/jitter by class) | code | P1 | §R table; replaces per-call-site ad-hoc handling |
| R1-10 | Breaker on SLOW_EXTERNAL only (AI + connectors) | code | P2 | Explicitly **not** on Stripe, Redis or Postgres |
| R1-11 | Bulkheads: separate worker pool + AI concurrency semaphore | code | P1 | Depends on R1-1 |
| R1-12 | Fix `autoDeploy` deploy ordering (engine → workers → app) | CONFIGURATION ONLY | P1 | Long-standing; workers can boot ahead of their migrations |

**Sequencing note:** R1-1 → R1-2 → R1-6 → R1-3 → R1-4 must go in that order. Each one makes the
next measurable. Do not start any optimisation work until R1-1 through R1-3 are live and have
produced a week of data.

### PLATFORM-S1 — Edge / Identity / Credential Security

*Rationale: contains both P0 infrastructure findings. Note that most of the P0 work is operator-owned,
and that several engineering items are blocked on the operator action.*

| # | Item | Type | Priority | Notes |
|---|---|---|---|---|
| S1-1 | Repoint `securelogicai.com` DNS away from ParkLogic to Cloudflare | **operator** | **P0** | §0.1. Blocks S1-2, S1-3, S1-6 |
| S1-2 | Cloudflare zone: SSL **Full (strict)**, then proxy `app` + `api` | **operator** | **P0** | Never Flexible |
| S1-3 | Origin authentication (shared-secret header at the edge, enforced in engine middleware, `/health` exempt) | code + config | **P0** | The durable fix for §0.2; ship log-only first |
| S1-4 | Set `NEXT_PUBLIC_ENGINE_URL` on the prod app and rebuild | CONFIGURATION ONLY | P1 | Removes `http://localhost:4000` from the production CSP |
| S1-5 | Set `ENGINE_URL_BASE` on the prod engine | CONFIGURATION ONLY | P1 | Prod twin of the known staging defect |
| S1-6 | Turnstile on login + signup | code | P1 | **Blocked on S1-1** |
| S1-7 | Secret scanning in CI (gitleaks) | CI | P1 | Repo is clean today — this is insurance |
| S1-8 | Fail-closed on Redis-backed **auth** limiters only | code | P1 | `adminLockout`, `portalExchangeRateLimiter`. Quota limiters stay fail-open |
| S1-9 | HIBP breached-password check at signup/reset | code | P2 | k-anonymity; no key, no PII egress |
| S1-10 | API-key revocation (reuse the `session_epoch` pattern) | code | P1 | Closes the emergency-revocation gap |
| S1-11 | Dual-key rotation for `JWT_SECRET` / `SECURELOGIC_SIGNING_SECRET` | code | P2 | Before the second enterprise customer |
| S1-12 | Close the no-op SAML schema validator | code | P1 | Before the first real SSO customer ([[saml-schema-validator-noop]]) |
| S1-13 | Re-run the Tier-2 auth-anomaly detector fix | code | P2 | **Blocked on S1-1** — detector groups on rotating edge IPs |

### PLATFORM-E1 — Enterprise Experience / Extensibility

| # | Item | Type | Priority | Notes |
|---|---|---|---|---|
| E1-1 | `eslint-plugin-jsx-a11y` in the lint gate | code | P1 | Zero runtime cost; stops regressions |
| E1-2 | `axe` assertions on the six sold flows | code | P1 | login, dashboard, findings list, finding detail, vendors, Brief |
| E1-3 | Manual keyboard traversal of those six flows; file defects | manual | P1 | One pass, then fix what it finds |
| E1-4 | Optimistic concurrency on contested aggregates only | code | P2 | findings, risks, assessments, engagement responses. **Not global** |
| E1-5 | Effective-configuration resolver (formalise the existing 2 layers) | code | P2 | Only when a third layer is genuinely needed |
| E1-6 | `custom_field_definitions` + typed value storage | code | P2 | **Design now, build at the first enterprise ask** |
| E1-7 | API versioning `/api/v1` + compatibility contract | code + docs | P2 | At the first external integrator, not before |
| E1-8 | `Deprecation`/`Sunset` headers | code | P2 | Review `_frozen_prod` implementations; do not revive blindly |

### PLATFORM-AI1 — AI Routing / Cost / Context Efficiency

*Strict internal order: **Q before P before O.** Measure, then cache, then route.*

| # | Item | Type | Priority | Notes |
|---|---|---|---|---|
| AI1-1 | Wrap the ~9 uninstrumented LLM call sites in `withLlmCallContext` | code | **P1** | Vendor Assurance extraction is our most expensive path and is currently dark |
| AI1-2 | `llm_call_events` table + write from the existing `recordLlmUsage` seam | code + migration | **P1** | Makes margin queryable. **Consumes a migration number — not 20261059** |
| AI1-3 | Weekly gross-margin report (cost by tenant, by capability, vs revenue) | code | P1 | Three queries; incomplete rows labelled, never zeroed |
| AI1-4 | Anthropic prompt caching (`cache_control`) on long stable prefixes | code | P2 | Cheapest available win; telemetry to prove it already exists |
| AI1-5 | Generalise `verdictCache` into a shared digest-keyed context cache | code | P2 | Tenant id stays in every key |
| AI1-6 | Task classification + model policy + fallback + verification | code | P2 | **Only after AI1-1..3 produce data** |

### PLATFORM-SCALE1 — Future Scaling

*Nothing here should be built now. It is recorded so it is not re-derived under pressure.*

| # | Item | Trigger that would justify starting it |
|---|---|---|
| SCALE1-1 | Convert `advisoryLock.ts` to transaction-scoped | Any decision to adopt a pooler |
| SCALE1-2 | PgBouncer | A **measured** connection-count constraint after R1-1/R1-2 |
| SCALE1-3 | Per-org workload concurrency quotas | A tenant whose job volume measurably starves others |
| SCALE1-4 | Tenant-scoped queues | Quotas proving insufficient because of head-of-line blocking |
| SCALE1-5 | Dedicated worker pool | A commercial Enterprise SKU commitment |
| SCALE1-6 | Read replicas + read-your-writes + lag gating | Measured read saturation of the primary |
| SCALE1-7 | Dedicated enterprise compute | A contractual isolation/residency requirement |

---

## 4. Explicitly NOT a package

Recorded so these are not quietly re-proposed later.

**NOT NEEDED (do not build):**

- **HMAC signing of authenticated browser mutations** (I5) — cookies + `SameSite` +
  `frame-ancestors 'none'` + `form-action 'self'` already cover the threat model. Signing would
  require shipping a key to the browser.
- **Per-tenant schema migrations** (L5) — 261 ordered migrations is already the tightest release
  constraint; multiplying it per tenant ends safe promotion.
- **MCP tool wrappers** (T) — nothing exists, and nothing should until a wrapper adds
  authorization, typing, sandboxing, auditability or remote capability that a CLI cannot.
- **Progressive login delay** (H4) — four limiters + lockout + argon2 already cover it; adds a DoS
  surface.
- **Redis-based distributed locks / sessions** (D3, D4) — Postgres advisory locks and
  `session_epoch` are the correct implementations already in place.
- **Upstash** (D7) — solves no demonstrated problem and would leave the fail-open defect intact.
- **A migration to Railway** (E) — the deficiencies observed are configuration and DNS, not platform.

**DEFER (right idea, wrong time):**

- Read replicas (N1) · PgBouncer (C8) · dedicated tenant compute (M) · automated secret rotation
  (G7) · WCAG certification and VAPT/VPAT (K3) · external secret manager (G5).

**NOT NEEDED NOW (revisit on a specific trigger):**

- Session Replay and its rage/dead-click derivatives (A4/A5/A9/A10) — trigger: a real support
  burden, plus a data-governance ruling on recording tenant screens.

**ALREADY BUILT (protect, do not rebuild):**

- Telemetry scrubbing and log hygiene (A20) · transaction-local RLS context (C6) · connection
  release discipline and the savepoint/after-commit transaction model (C4/C5) · the full
  credential-stuffing stack minus bot control (H1–H3, H5, H8, H11) · webhook signature
  verification and outbound signing (I1–I3) · idempotency (R5) · entitlement enforcement (L3) ·
  the dependency-audit CI gate (G4) · origin security headers (F5) · LLM usage capture (Q1) ·
  the `verdictCache` design (P1) · clean secret hygiene in the repo (G1/G2).

**CONFIGURATION ONLY (no code):**

- `NEXT_PUBLIC_ENGINE_URL` on prod app (S1-4) · `ENGINE_URL_BASE` on prod engine (S1-5) ·
  `NEXT_PUBLIC_RENDER_GIT_COMMIT` on prod app (R1-7) · `pg_stat_statements` (R1-6) ·
  `autoDeploy` deploy ordering (R1-12) · Cloudflare DNS/SSL steps (S1-1, S1-2).

**DOCUMENTATION ONLY:**

- Record the Redis provider (D1) · document the Redis tenant key convention (D6) · rotation
  runbook (G8) · declare-or-delete the 3 undeclared Render services (E2) · delete-or-promote the
  2.1 MB `_frozen_prod`/`_excluded_prod`/`_server_DISABLED` quarantine · delete-or-declare
  `services/delivery-worker`.

---

## 5. Constraint compliance

- #826 untouched — read only, via the GitHub API.
- Frozen candidate `65cd3330` untouched — read only (`git show`).
- No held PR head moved; no branch pushed; nothing merged; nothing deployed.
- Production not modified. Render API calls were `GET` only; env **values** were never read, only
  key names. Network probes were unauthenticated `GET`/`HEAD` against public endpoints.
- **Migration `20261059` not consumed.** AI1-2 will need a number; it must be allocated at build
  time from the ledger, after the merge train's 20261037–58 land.

---

*Related memory: [[merge-train-dryrun-2026-08-24]], [[release-boundary-freeze-r1]],
[[render-yaml-declared-not-synced]], [[admin-ip-allowlist-unwired]],
[[auth-anomaly-tier2-cloudflare-ip-fragmentation]], [[staging-engine-url-base-unset]],
[[saml-schema-validator-noop]], [[token-in-url-request-log-exposure]],
[[prod-credential-rotation-2026-08-11]], [[va3-clean-soc2-extraction-defect]].*
