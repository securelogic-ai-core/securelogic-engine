# Production Readiness Checklist

Companion to `docs/DR_PLAN.md` and `docs/launch/PRIVATE_BETA_GO_LIVE.md`.
Each unchecked box is an open item; nothing here is aspirational boilerplate — every line maps to something verified in code, IaC, or requiring a one-time dashboard confirmation.

## Infrastructure
- [x] All 14 services declared in `render.yaml` (Blueprint = source of truth); staging tracks `develop`
- [x] Staging/production separation (separate DBs, Redis, R2 buckets via per-service env)
- [ ] **[OPERATOR]** Blueprint sync state clean in dashboard (no drifted services)
- [ ] **[OPERATOR]** Production service plans sized (engine + app at least 1 GB; workers per queue depth)

## Authentication & sessions
- [x] Argon2id hashing; password policy (12–128 + complexity) on signup/reset/invite/change (#732)
- [x] Account lockout (5 fails / 15 min) + admin unlock + audit events
- [x] MFA (TOTP) + org-level `require_mfa`
- [x] SAML SSO with seat-cap-gated JIT; inactive users blocked on all three login surfaces (#732)
- [x] Stale-session enforcement: status + current role checked per request (#732)
- [x] Portal cookie idle 30 min / absolute 12 h (env-tunable: SESSION_IDLE_SECONDS / SESSION_ABSOLUTE_SECONDS)
- [ ] Known limitation (accepted): 7-day engine JWT TTL, no refresh/sign-out-everywhere — post-launch session-architecture workstream

## Secrets
- [x] All secrets `sync: false` (dashboard-only, never in repo); ~40 distinct keys
- [ ] **[OPERATOR]** Sealed offline copy in password manager (DR_PLAN §3)
- [ ] **[OPERATOR]** JWT_SECRET / SESSION_SECRET / SECURELOGIC_ADMIN_KEY confirmed distinct between staging and prod

## Feature flags (state at go-live)
- [x] Webhook wave-1 events: **OFF in prod** (merge ≠ enablement — separate decision)
- [x] Risk acceptance: staging ON, **prod OFF** (GATE B)
- [x] Enterprise context/registry: staging ON, prod per rollout plan
- [x] Ops brakes exist on every worker (RETRY/PURGE/etc. `_DISABLED` envs)
- [ ] **[OPERATOR]** Flag-state review against `docs/launch/PENDING_ENABLEMENT` before go-live

## Monitoring, alerting, logging
- [x] Sentry on engine + app (DSNs per env); structured pino logging with request IDs
- [x] Queue-depth alert, scheduler run-ledger + stale cleanup, failure alerting (ALERT_WEBHOOK_URL)
- [x] Health check: `GET /health` (db connectivity included)
- [ ] **[OPERATOR]** Render health-check path configured on both web services + alert notification target confirmed reachable

## Backups & rollback
- [ ] **[OPERATOR]** DR_PLAN §3 verification boxes + §6 first restore test — **go-live gate**
- [x] Service rollback = Render previous-deploy (stateless services)
- [x] Migrations are filename-tracked, idempotent, additive-only discipline (no destructive migration shipped this cycle)

## Security validation
- [x] Tenant isolation: 858 real-SQL isolation tests green on merged develop (2026-07-30)
- [x] Audit WORM (DB triggers); every mutating register route writes audit events
- [x] SSRF-pinned webhook egress; rate limiting (tiered, hashed-key); admin network allowlist
- [x] Staging smoke incl. RBAC negative test passed 2026-07-30 (`docs/validation/staging-smoke-2026-07-30.md`)
- [ ] **[OPERATOR DECISION]** npm-audit: 19 highs need breaking majors (eslint@10, archiver@8, exceljs) — ruled before or shortly after go-live; not customer-data-path packages but will appear in prospect scans

## CI/CD
- [x] Lanes: test, typecheck, lint, build, url-drift, tenant-coverage, cross-org-isolation (all green on develop)
- [x] Known red: `audit` lane (see npm decision above) — documented, not silent
- [ ] **[OPERATOR]** Promotion flow develop → main → prod deploy confirmed (staging soak period decided)

## Required environment variables (dashboard-managed, per `render.yaml`)
Core: DATABASE_URL · REDIS_URL · JWT_SECRET · SESSION_SECRET · FIELD_ENCRYPTION_KEY · MFA_SECRET_KEY · SECURELOGIC_ADMIN_KEY · SECURELOGIC_ADMIN_ALLOWED_IPS · SECURELOGIC_SIGNING_SECRET · SCHEDULER_SECRET
Integrations: RESEND_API_KEY(+WEBHOOK_SECRET) · ANTHROPIC_API_KEY · OPENAI_API_KEY · LEMON_WEBHOOK_SECRET · R2_{ACCOUNT_ID,ACCESS_KEY_ID,SECRET_ACCESS_KEY,BUCKET,ENDPOINT} · SENTRY_DSN_{ENGINE,APP}
URLs: APP_BASE_URL · ENGINE_URL_BASE · ENGINE_API_URL · NEXT_PUBLIC_{APP_URL,API_URL,ENGINE_URL,SITE_URL} · NEWSLETTER/BRIEF from-addresses
Sessions: SESSION_IDLE_SECONDS · SESSION_ABSOLUTE_SECONDS · LOG_LEVEL

## Third-party dependencies (runtime)
Render (compute+Postgres) · Cloudflare R2 · Upstash/Redis · Resend · Anthropic · OpenAI · Sentry · Lemon Squeezy — each has a fail-open or degraded mode except Postgres (hard dependency, covered by DR_PLAN).
