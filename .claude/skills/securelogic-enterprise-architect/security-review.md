# Security Review

SecureLogic AI sells trust to security and compliance leaders. The product must be able
to answer client and auditor scrutiny about how it handles their data. This file is the
SecureLogic-specific security model and the lens to apply to every change.

Authoritative companion: `TENANT_ISOLATION_STANDARD.md` (wins on any tenant question).
Use the `/security-review` slash command for a structured review of a diff; use this
file to know *what matters here specifically*.

---

## 1. Authentication

- **Customer auth** is email/password → JWT (HS256, `JWT_SECRET`, 32–512 chars enforced
  at boot). JWTs carry `sub`, `org`, `role`, `iat`. Verified in
  `src/api/middleware/requireApiKey.ts` (`verifyJwt`).
- **JWT invalidation:** every JWT request checks `users.password_changed_at`; a token
  minted before the last password change is rejected. This check **fails closed** (DB
  error → 503), correctly.
- **API keys** are SHA-256 hashed at rest (`api_keys.key_hash`), never stored plaintext.
  They are admin-equivalent for the org.
- **MFA** via TOTP (`otplib`); **SSO** via SAML 2.0 (`samlify`) with JIT provisioning.
- **Sessions (app)** use `iron-session` encrypted HttpOnly cookies (`SESSION_SECRET`),
  `Secure` in prod, `sameSite=lax`. The JWT lives in the encrypted cookie; it never
  reaches browser JS.

**Review focus:** any new auth path must audit-log every state change
(`signup`, `login`, `login_failed`, `password_reset`, `account_unlocked`, MFA events).
Don't trust a raw JWT `org` claim for downstream queries — the bridge swaps to an API
key; downstream code reads `req.organizationContext.organizationId`.

## 2. Authorization (entitlements + roles)

- **Entitlement gating** is `requireEntitlement(level)`; the source of truth is
  `organizations.entitlement_level` (Stripe-written). Pick the gate level by citing the
  §9 mapping table in `TENANT_ISOLATION_STANDARD.md`. The `2→4` rank gap is intentional.
- **Role gating** is JWT-only: `viewer` can't mutate (blocked both in `requireApiKey` and
  via `requireNotViewer`). **API keys bypass role checks** (R9) — they're admin. Don't
  hand a viewer/analyst an API key.
- **Admin surface** (`/admin/*`) is staff-only: `adminLockout → requireAdminKey →
  adminRateLimit → adminAudit`, `SECURELOGIC_ADMIN_KEY` (timing-safe), CIDR allowlist
  (`0.0.0.0/0` forbidden). Admin reads/mutations of customer data must audit-log the
  staff actor *and* the affected `organizationId`; mutations require a reason payload.

**Review focus:** a missing or wrong-tier entitlement gate is a revenue + access bug.
Confirm the chain order: `requireApiKey → attachOrganizationContext → requireEntitlement`.

## 3. Tenant isolation (the headline risk)

This is the most consequential security property. See `architecture.md` §7 and
`database-guidelines.md` for mechanism.

- **Live defense:** `WHERE organization_id = $n` on **every** customer-data statement,
  with `organization_id` sourced from `req.organizationContext.organizationId` — never
  from body/param. Mandatory even when filtering by a UUID `id` (anti-IDOR).
- **Cross-row refs** (`vendor_id`, etc.) verified same-org via pre-flight `SELECT 1 …`.
- **RLS is inert** today (owner cred, `NOT FORCE`) — defense-in-depth that activates only
  after the `app_request` flip. New tables should still ship an RLS policy
  (`USING/WITH CHECK` on `NULLIF(current_setting('app.current_org_id', true), '')::uuid`),
  but you cannot rely on it for isolation yet.
- **Open code risks** (`TENANT_ISOLATION_STANDARD.md` §11, R1–R11): no central
  enforcement yet (R1/R8), 26 routes don't reference `organization_id` and need a
  per-route benign/leak classification (R2), JWT→key actor-attribution loss (R3),
  entitlement-vocabulary collision (R4), unverified worker→brief per-org filtering (R5),
  unaudited LLM prompt batching (R6), uneven audit coverage (R7), per-upload quotas
  missing (R11).

**Review focus — the negative path:** for any new customer-data route, the test that
matters is "org A cannot read/modify org B." The cross-org isolation harness
(`test/isolation/`) exists for exactly this — add a case.

## 4. Secrets handling

- Secrets live in env vars (Render dashboard / `render.yaml`), never in code or git.
  `validateEnv.ts` enforces required prod secrets at boot (DB, Redis, JWT, admin key +
  allowlist, Stripe set, unsubscribe + Resend webhook secrets, app URLs).
- **Never inline credentials in bash** (hard rule — repeated Postgres password exposures
  in the past). Prefer `/health` and `/version` over `PGPASSWORD=…` in argv. `/tmp` is
  not a durable trail; use `docs/investigation/` for evidence.
- `ANTHROPIC_API_KEY` is on **workers only** in prod, not the engine web service. R2 keys
  are **staging-only**. Don't add prod secrets to a service that shouldn't hold them.
- Field-level encryption uses `FIELD_ENCRYPTION_KEY` (required in prod).

**Review focus:** scan diffs for any secret, key, password, or token in source,
`render.yaml` literals, test fixtures, or log lines. Rotate-and-don't-commit if found.

## 5. Logging, audit, and auditability

- **Operational logging:** `pino` / `pino-http` (`src/api/infra/logger.ts`). Never log
  secrets, auth headers, full request bodies with PII, or full LLM prompts. `errorHandler`
  must not leak stack traces to clients in prod.
- **Audit log:** `writeAuditEvent` (`src/api/lib/auditLog.ts`) → `security_audit_log` via
  `pgElevated`, fire-and-forget, append-only (immutability trigger). Required fields on
  mutations: `organizationId`, actor (`actorUserId`/`actorApiKeyId`), `eventType`
  (dot-namespaced), `resourceType`, `resourceId`, `ipAddress`.
- **Coverage is uneven (R7)** — every new mutation MUST add an audit call. This is a
  product-credibility feature, not optional.

**Review focus:** does every mutation in the diff call `writeAuditEvent` with the actor
and the affected org? Per-org work logs should include `organizationId`.

## 6. Encryption & transport

- Postgres connects with TLS (`ssl: { rejectUnauthorized: false }`); full `verify-full`
  is blocked by Render not publishing a CA (deferred, A02-G1). `DATABASE_SSL_DISABLED` is
  for the local/CI isolation harness only — never in prod.
- HTTPS terminates at Render; helmet sets HSTS + CSP. App secrets stay server-side.

## 7. Uploaded evidence / file handling

- Customer files (SOC PDFs) stream from the in-memory multer buffer to **Cloudflare R2**
  via `src/api/lib/blobStorage.ts` — never to local disk. Every object key is prefixed
  `org/{organizationId}/…` (the wrapper enforces this before any I/O — don't bypass it).
- Pre-signed read URLs are single-org (key-encoded) and TTL ≤ 120s (wrapper clamps).
- **Per-org upload quotas are not yet enforced (R11)** — multer holds the upload in
  memory. Be conscious of memory pressure on new upload routes; enforce a size cap before
  bytes reach the wrapper.
- Generated artifacts (CSV/PDF/zip) stream to the response without server persistence
  unless a package explicitly persists via R2.

**Review focus:** any file route must (a) cap size, (b) key by org, (c) stream not spool
to disk, (d) validate content type, and (e) be entitlement-gated.

## 8. AI safety & prompt injection

LLM calls touch the brief synthesizer, signal enrichment, assessment analysis, and
control-matcher suggestions. SecureLogic-specific rules:

- **Tenant scope in prompts (R6):** an LLM call that includes customer-private inputs
  (vendor names, control text, internal findings, assessment narratives) MUST scope to a
  **single** `organizationId`. **Never batch multiple orgs' private inputs** into one
  request — that risks one org's text appearing in another's output. Public-source
  enrichment (summarizing a CVE) may be batched (input isn't customer-private).
- **Persist back to the same org only.** LLM output is written only into rows scoped to
  the org whose inputs produced it.
- **Prompt-injection posture:** ingested signal text and uploaded document text are
  **untrusted**. Treat model output derived from them as untrusted too — it may contain
  attacker-planted instructions. Don't let model output drive privileged actions, SQL,
  shell, or tool calls without validation. Constrain outputs to the expected structured
  shape and validate before persisting (the pipeline already falls back to templated text
  when the model returns unusable output — preserve that).
- **Log for auditability:** LLM call sites should log `organizationId` + model id +
  prompt-hash, not raw prompt content.
- **Degrade safely:** absence of `ANTHROPIC_API_KEY` must not crash — brief generation
  returns 503 / falls back to templates. Keep that behavior.

## 9. SSRF & outbound requests

- The ingestion pipeline fetches arbitrary external feed URLs. Outbound HTTP uses
  `undici`; SSRF protection depends on the pinned-agent connect path
  (`buildPinnedAgent`). **On any `undici` major bump, re-verify** the single-address
  callback still matches the connect path (recorded follow-up). Don't let a user-supplied
  URL reach an un-pinned fetch.

## 10. Dependency management & production hardening

- Dependabot targets `develop` (not `main`). The CI `audit` path / `npm audit` gates HIGH
  vulns. App and engine are separate dep trees (and the website is a third).
- SHA-pin GitHub Actions where practical (checkout/setup-node are pinned; the memory
  notes some commands aren't).
- Hardening already in place: helmet, hpp, strict content-type, oversized-input rejects,
  per-IP + admin rate-limits with Redis-backed lockout (fail-closed in prod), drain mode,
  request timeouts, webhook idempotency (fail-closed). Preserve these when editing
  `app.ts`.

## 11. The review questions to ask on any change

1. Does every customer-data query carry `WHERE organization_id = $n` from
   `req.organizationContext`?
2. Is the entitlement gate present and at the right tier (per the §9 mapping)?
3. Does every mutation audit-log the actor + org?
4. Are secrets absent from code, config literals, fixtures, and logs?
5. If files are involved: size-capped, org-keyed, streamed, type-validated, gated?
6. If an LLM is involved: single-org scope, untrusted-output handling, safe degradation?
7. If outbound HTTP: is the URL trusted / the agent pinned?
8. Is there a **negative-path** (cross-org / cross-role) test proving the boundary holds?
9. Did you weaken any existing control (RLS policy, rate-limit, lockout, idempotency)
   without a documented compensating control?
