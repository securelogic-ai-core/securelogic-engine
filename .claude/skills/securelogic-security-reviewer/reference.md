# Reference — Security Reviewer

Enforcement map for SecureLogic AI security review. Every item is **VERIFIED** in the repo
unless tagged otherwise. Authority: `TENANT_ISOLATION_STANDARD.md`.

## 1. Authentication (VERIFIED)
- `src/api/middleware/requireApiKey.ts` — two paths, one downstream shape:
  - **API key** (`X-Api-Key` / `Authorization: Bearer`) → SHA-256 → `api_keys.key_hash`;
    admin-equivalent.
  - **JWT** (contains dots) → `verifyJwt` → `users.password_changed_at` check (fail-closed,
    503 on DB error) → viewer-mutation block → swap to org's most recent active API key.
- Customer-auth routes `/api/auth/*` are pre-API-key; use `req.jwtPayload`; must audit every
  state change. No `req.user` — it's `req.jwtPayload`.
- MFA TOTP (`otplib`), SAML SSO (`samlify`) with JIT provisioning + seat-cap enforcement.

## 2. Authorization (VERIFIED)
- `requireEntitlement(level)` ranks: `starter=1`, `standard`=`professional`=2, `premium`=4
  (=platform/team). Source of truth `organizations.entitlement_level`, Stripe-written, read
  only via `attachOrganizationContext`. The `2→4` gap is intentional.
- Roles (`users.role`, JWT-only): viewer (read) / analyst (read+workflow) / admin (all).
  `viewer` blocked in `requireApiKey` + `requireNotViewer`. **API keys bypass role checks (R9).**
- Pick a gate by citing `TENANT_ISOLATION_STANDARD.md` §9 — the only authoritative mapping.

## 3. Tenant isolation (VERIFIED mechanism; RLS INERT)
- Live: `WHERE organization_id = $n` discipline (route-by-route). See
  `api-guidelines.md`/`database-guidelines.md` in the architect skill for patterns.
- Runtime `src/api/infra/postgres.ts`: `pg` (tenant proxy), `pgElevated` (cross-org),
  `pgRaw` (escape hatch), `withTenant` (tx + GUC), `asTenant` (commit-before-respond).
- RLS policy template (canonical, `NULLIF` + `NOT FORCE`) on ~22 tables, inert until the
  `app_request` flip. Proven by `test/isolation/*Rls.test.ts` via `SET ROLE app_request`.

## 4. Secrets & config (VERIFIED)
- Env-only; `src/api/startup/validateEnv.ts` enforces required prod secrets at boot
  (DB, Redis, `JWT_SECRET`, admin key + allowlist, Stripe set, `UNSUBSCRIBE_SECRET`,
  `RESEND_WEBHOOK_SECRET`, app URLs). `FIELD_ENCRYPTION_KEY` required in prod.
- Placement: `ANTHROPIC_API_KEY` = workers only (prod); R2 (`R2_*`) = staging only;
  `render.yaml` is the source — confirm a secret lands on the right service.
- **Standing rule:** never inline credentials in bash; rotate-and-don't-commit on exposure.

## 5. Logging & audit (VERIFIED; coverage uneven = R7)
- pino/pino-http; never log secrets, auth headers, PII bodies, or full LLM prompts.
- `writeAuditEvent` required fields on mutations: `organizationId`, actor
  (`actorUserId`/`actorApiKeyId`), `eventType` (dot-namespaced), `resourceType`,
  `resourceId`, `ipAddress`. Admin mutations also log staff actor + a reason payload.

## 6. Uploaded evidence / files (VERIFIED; R11 open)
- Stream multer buffer → R2 via `blobStorage.ts`; keys `org/{orgId}/…` (wrapper-enforced,
  do not bypass). Pre-signed URLs single-org, TTL ≤ 120s. Generated artifacts stream to the
  response unless a package explicitly persists. **No per-org upload quota yet (R11)** — cap
  size before bytes reach the wrapper.

## 7. AI safety & prompt injection (VERIFIED rules; R6 open)
- LLM call with customer-private inputs → single `organizationId`; **never batch orgs** (R6).
  Persist output only into same-org rows. Public-source enrichment (CVE summary) may batch.
- Ingested feed text + uploaded doc text are **untrusted**; treat model output derived from
  them as untrusted — never let it drive SQL/shell/privileged actions unvalidated. Constrain
  to the expected structured shape; the pipeline already falls back to templated text — keep
  that. Log `organizationId` + model id + prompt-hash, not raw prompt.
- Degrade safely: no `ANTHROPIC_API_KEY` → 503 / template fallback, never a crash.

## 8. Outbound / SSRF (VERIFIED concern)
- Ingestion fetches arbitrary feed URLs via `undici`; SSRF protection rides the pinned-agent
  connect path (`buildPinnedAgent`). **Re-verify on every `undici` major bump.** Don't let a
  user-supplied URL hit an un-pinned fetch.

## 9. Dependencies & hardening (VERIFIED)
- Dependabot → `develop` (not `main`); `npm audit` / CI audit path gates HIGH. App, engine,
  website are three separate dep trees. helmet/hpp/strict-content-type/rate-limits/lockout/
  drain/timeout/webhook-idempotency in `app.ts` — preserve when editing.

## 10. Code-risk register (from the standard, §11) — VERIFIED list, treat as live
R1 no central scope enforcement · R2 26 routes w/o org ref · R3 JWT actor attribution loss ·
R4 entitlement vocab collision · R5 worker→brief filtering unverified · R6 LLM batching
unaudited · R7 audit coverage uneven · R8 no live RLS · R9 API keys bypass roles · R10 admin
reason-payload uneven · R11 no upload quota.

## Cross-references
Tenancy/entitlement design → **securelogic-enterprise-architect**. Pipeline-specific
prompt/tenant questions → **securelogic-intelligence-pipeline-engineer**. PR-level release
risk → **securelogic-release-pr-reviewer**.
