# TENANT_ISOLATION_STANDARD.md

## Purpose
This document defines the tenant model and the isolation rules every package must follow. It is the authoritative source for how customer data is scoped, accessed, processed, and audited across the SecureLogic AI platform.

It governs:
- the shape of tenant identity
- the request-time context model
- the role model
- query scoping rules
- file/object storage rules
- background job and AI job rules
- internal SecureLogic AI staff access
- audit logging expectations
- the entitlement vocabulary that gates tenant-tier behavior
- the verification rules every PR must satisfy

If any other document contradicts this one on tenant isolation, this document wins until explicitly amended.

---

## §1. Identity and scope

The tenant unit is the **organization**, identified by `organizations.id` (UUID).

- There is exactly one tenant concept. There is no nested tenant, no team-within-org tenant, no shared workspace, and no cross-org sharing surface.
- Every customer-data row carries `organization_id UUID NOT NULL REFERENCES organizations(id)`.
- Cross-row references between customer-data records (e.g. an assessment referencing a vendor) MUST be same-org by construction. Validation MUST reject cross-org references at the application layer.
- A user belongs to exactly one organization. Multi-org membership is not supported and MUST NOT be introduced without amending this standard.

Tables that are intentionally **not** org-scoped:
- shared/global signal tables (`signals`, KEV cache, CVE cache) — public-source data
- platform-internal tables (migrations, system jobs, email suppression list)
- the `organizations` table itself

Any other table that holds customer-derived content MUST be org-scoped.

---

## §2. Authenticated request context

Every authenticated request MUST resolve to a single `organizationId` before any handler logic runs.

### Authentication paths
Two paths feed the same downstream chain:

1. **API key** — `X-Api-Key` / `Authorization: Bearer <key>` header. Hash-matched against `api_keys.key_hash` (SHA-256). Treated as admin-level for the org.
2. **JWT bridge** — JWTs from `/api/auth/*` are detected in `requireApiKey` (token contains dots), verified, and exchanged for the org's most recent active API key row, which is then injected as `req.apiKey`. All downstream middleware sees a uniform shape.

### Required middleware chain (customer-data routes)
```
requireApiKey → attachOrganizationContext → requireEntitlement(<level>) → handler
```

- `attachOrganizationContext` is the **sole loader** of `organizations.entitlement_level` on the request path. Routes MUST NOT query `organizations` directly to derive context.
- After this chain, `req.organizationContext.organizationId` is the canonical tenant identifier for the request.
- Handlers MUST early-return `403 organization_context_missing` if `organizationId` is null.
- The JWT bridge MUST always swap to an active API key. No path may rely on the raw JWT's `org` claim for downstream queries.

### Customer auth surface
The `/api/auth/*` routes (`requireAuth`-gated) are exempt from `requireApiKey` because they are pre-API-key by definition (signup, login, verification, password reset, MFA challenge). They use `req.jwtPayload.org` directly. Every state change in this surface MUST audit-log.

---

## §3. Role model

Roles live on `users.role` and travel inside the JWT payload.

| Role | Read | Workflow mutations | API key mgmt | Billing | Org settings |
|---|---|---|---|---|---|
| `viewer` | yes | **no** | no | no | no |
| `analyst` | yes | yes | no | no | no |
| `admin` | yes | yes | yes | yes | yes |

### Rules
- Role enforcement is JWT-only. API keys are admin-equivalent and MUST NOT be issued to non-admin actors.
- `viewer` mutation blocks are enforced in two places: `requireApiKey` (JWT path, blanket) and `requireNotViewer` (explicit decorator). New mutation routes SHOULD use `requireNotViewer` for clarity.
- `analyst` is the default working role for customer staff who operate the platform but do not administer it.
- `admin` is reserved for org owners and explicitly delegated administrators.
- Internal SecureLogic AI staff access is **not** a customer role. It uses the parallel admin chain documented in §7.

### Role assignment
- The first user of an organization (created at signup) is `admin`.
- Subsequent users default to `viewer` until promoted by an `admin`.
- Role changes MUST be audit-logged with both actor and target user IDs.

---

## §4. Query scoping

Every customer-data SQL statement MUST scope by `organization_id`.

### Required patterns
**SELECT**
```sql
SELECT ... FROM <table> WHERE organization_id = $1 AND ...
```

**INSERT**
```sql
INSERT INTO <table> (organization_id, ...) VALUES ($1, ...)
```
The `organization_id` value MUST come from `req.organizationContext.organizationId`. It MUST NOT be read from the request body or from any user-supplied parameter.

**UPDATE / DELETE by id**
```sql
UPDATE <table> SET ... WHERE id = $1 AND organization_id = $2
DELETE FROM <table>     WHERE id = $1 AND organization_id = $2
```
The `organization_id` predicate is mandatory even when `id` is a UUID. UUIDs are unique by construction but the predicate is the defense against IDOR-style cross-org reads.

**Cross-row references**
When a column references another customer-data row (`vendor_id`, `control_id`, etc.), the handler MUST verify same-org membership before persisting. A pre-flight `SELECT 1 FROM <referenced_table> WHERE id = $refId AND organization_id = $orgId` is the canonical pattern.

### Anti-patterns (forbidden)
- `WHERE id = $1` without an `organization_id` clause on customer-data tables
- `INSERT` taking `organization_id` from the request body
- `JOIN` chains that lose org scoping at any join (every join into customer data must carry org context)
- `req.body.organization_id` — never trust client-supplied tenant identity

### Defense-in-depth (out of scope, recommended next)
Postgres Row-Level Security on customer-data tables, gated by a `app.current_org_id` session variable set per request. This is **not** part of the current standard — it is the next-step recommendation that future packages should plan toward. Until RLS is in place, the discipline above is the only protection.

---

## §5. File / object storage

### Current state
The platform has no persistent customer file storage.
- Multer uploads use `multer.memoryStorage()` only (e.g. `vendorAssessmentAnalysis.ts`, `transcribe.ts`). Files are parsed in-memory and discarded.
- Generated artifacts (CSV, PDF, audit packages) stream to the response and are never persisted server-side.
- `evidence` is metadata only — no binary attachments are stored.

### Rules while there is no blob layer
- File uploads MUST stay in `memoryStorage()`. Do not introduce disk-backed multer storage without amending this standard.
- Per-request memory limits MUST be enforced on every upload route to prevent a single tenant from exhausting worker memory.
- Generated artifacts that read multiple rows MUST filter every query by `organization_id`. Verify this on every export route.

### Rules when a blob layer is introduced (future)
- Every object key MUST be prefixed with `org/{organizationId}/...`.
- Read access MUST require an org-context match between the requesting principal and the key prefix.
- Pre-signed URLs MUST scope to a single `organizationId` and MUST NOT be reusable across orgs.
- The blob layer choice and migration MUST be a discrete package; do not ship blob storage as a side effect of a feature.

---

## §6. Background jobs / AI jobs

### Per-org jobs (canonical pattern: posture worker)
- Enumerate via `SELECT id FROM organizations WHERE status = 'active'`.
- Loop per-org. Each iteration MUST be wrapped in a try/catch so one tenant cannot poison the cycle.
- Every log line for per-org work MUST include `organizationId` for traceability.
- Per-org jobs MUST NOT share mutable in-process state across iterations.

### Cross-org jobs (intelligence ingestion, KEV polling, public-source feeds)
- Allowed only for genuinely public/global data (CVEs, KEV entries, public vendor advisories, regulatory feeds).
- Output MUST be persisted to shared signal tables. It MUST NOT be persisted to org-scoped tables directly.
- Per-org fan-out MUST happen at consumption time (brief generation, finding creation, signal-to-vendor linkage) — and the consumption step is itself an org-scoped operation under §4.

### LLM and AI jobs
- Any LLM call that includes customer-private inputs (vendor names, control text, internal findings, assessment narratives) MUST scope its prompt context to a single `organizationId`.
- Prompt construction MUST NOT batch inputs from multiple orgs into a single request.
- LLM responses MUST be persisted only into rows scoped to the same `organizationId` whose inputs produced them.
- Public-source enrichment (e.g. summarizing a CVE description) MAY be batched across orgs because the input is not customer-private.
- LLM call sites SHOULD log `organizationId` alongside the model identifier and prompt-hash for auditability.

---

## §7. Internal SecureLogic AI staff access

Staff (SecureLogic AI employees) access customer data only via the `/admin/*` surface.

### Required controls (in series)
1. `SECURELOGIC_ADMIN_KEY` — rotatable, min 16 chars, set in environment, never in code.
2. IP allowlist — `SECURELOGIC_ADMIN_ALLOWED_IPS` (CIDR, comma-separated). `0.0.0.0/0` is forbidden.
3. Admin session — cookie-based, distinct from customer JWTs.

### Rules
- Every admin route that reads customer data MUST audit-log the staff actor identity AND the affected `organizationId`.
- Every admin route that mutates customer data MUST audit-log the staff actor, the affected `organizationId`, the resource type and id, AND a reason payload supplied by the operator.
- Admin routes MUST NOT bypass the org-scoping rules in §4. A staff actor performing a customer-impersonation read MUST still go through org-scoped queries; the difference is the actor identity, not the data shape.
- Admin sessions MUST be short-lived. Long-running admin tokens are forbidden.

---

## §8. Audit logging

`writeAuditEvent` is the canonical sink. It is the only path that should write to the audit log.

### Required fields on customer-data mutations
- `organizationId` — the affected tenant
- `actorUserId` (or `actorApiKeyId` for service-to-service calls) — the actor
- `eventType` — dotted-namespace identifier, e.g. `vendor.created`, `auth.login`
- `resourceType` — the canonical object type
- `resourceId` — the affected row id
- `ipAddress` — request source

### Coverage rules
- Every package that introduces a customer-data mutation MUST add audit-log calls.
- Every auth-flow event (signup, login, login_failed, password_reset, account_unlocked, MFA enrollment) MUST audit-log. Existing routes are the pattern.
- Admin-side mutations MUST log the staff actor identity in addition to the affected `organizationId`.
- Audit-log reads are themselves org-scoped. Customer-side reads MUST filter by `organization_id`. Staff-side reads MUST go through the admin chain in §7.

---

## §9. Entitlement vocabulary (canonical mapping)

Three vocabularies refer to the same concept across the codebase. Any tenant-tier gating logic MUST consult this table; this is the only authoritative mapping.

| Customer-facing | Stripe key | `organizations.entitlement_level` | `requireEntitlement` rank |
|---|---|---|---|
| Intelligence Brief — Free | (none) | `starter` | 1 |
| Brief Pro | `professional` | `professional` (legacy alias `standard`) | 2 |
| Team Professional | `teams` | `premium` (collapsed) | 4 |
| Platform Professional | `platform` | `premium` (collapsed) | 4 |
| Platform Annual | `platform_annual` | `premium` (collapsed) | 4 |
| Enterprise | (custom contract) | `premium` or custom | 4 |

### Notes
- The rank gap (`2 → 4`) is intentional in current code. Do not change it as part of an unrelated package.
- Code references: `src/api/middleware/requireEntitlement.ts`, `src/api/webhooks/stripeWebhook.ts`, `src/api/routes/billing.ts`, `src/api/startup/validateEnv.ts`.
- Customer-visible labels follow `PRODUCT_VISION.md` §Commercial model. Internal keys are kept stable to avoid Stripe price-ID migration risk.
- A future package may consolidate the vocabulary. Until then, any new feature gate MUST cite this table when choosing a level.

---

## §10. Verification rules

Every PR that touches customer data MUST satisfy these checks before merge.

### A. New customer-data route
- Mounts the standard middleware chain (`requireApiKey → attachOrganizationContext → requireEntitlement(...)`).
- Early-returns `403 organization_context_missing` if `organizationId` is null.
- Includes `WHERE organization_id = $orgId` in every SQL clause that touches customer data.
- Uses `req.organizationContext.organizationId` as the source of `organization_id` on INSERTs.
- Audit-logs every mutation via `writeAuditEvent` with the fields in §8.

### B. New customer-data table
- Schema includes `organization_id UUID NOT NULL REFERENCES organizations(id)`.
- Has an index on `organization_id` (or a composite index leading with `organization_id` for hot query paths).
- The migration is reviewed for tenant scoping before merge.

### C. New per-org background job
- Uses the per-org loop pattern from §6 (enumerate active orgs, per-org try/catch, `organizationId` on every log line).
- Does not share mutable in-process state across iterations.

### D. New LLM call site that includes customer-private data
- Scopes prompt context to a single `organizationId`.
- Does not batch inputs from multiple orgs.
- Logs `organizationId` alongside the model identifier.

### E. New admin route
- Goes through the admin chain (`requireAdminKey + requireAdminNetwork + requireAdminSession`).
- Audit-logs the staff actor and the affected `organizationId`.
- For mutations, requires a reason payload.

---

## §11. Code risks register

Risks the standard surfaces but does not itself fix. These are inputs to follow-on enforcement work, not deliverables of this package.

| # | Risk | Where | Severity |
|---|---|---|---|
| R1 | Org-scoping is route-by-route discipline only; no central enforcement (no RLS, no helper, no PR-time test) | All `src/api/routes/*.ts` | High |
| R2 | 26 of 100 route files do not reference `organization_id`. Mostly health/public/auth/admin. Needs an explicit sweep to confirm each one is genuinely tenant-irrelevant. | `src/api/routes/` | Medium — likely benign but unverified |
| R3 | JWT bridge swaps to the org's most recent active API key. Multiple active keys per org collapse all JWT actions onto the same canonical key in audit logs — actor attribution loss. | `src/api/middleware/requireApiKey.ts:95–104` | Medium |
| R4 | Three-vocabulary entitlement collision (Stripe key / `entitlement_level` / `requireEntitlement` rank). Easy to gate a feature at the wrong tier. Mapping is now codified in §9 but the code itself is unchanged. | `requireEntitlement.ts`, `stripeWebhook.ts`, `billing.ts` | Medium |
| R5 | Intelligence worker is global; per-org fan-out occurs at brief generation. Not yet verified that the fan-out path enforces org filtering on signal-to-org linkage. Needs a one-pass inspection in the enforcement package. | `services/intelligence-worker/...`, `briefScheduler.ts`, `intelligenceBriefGenerator.ts` | Unknown — verify in enforcement package |
| R6 | LLM prompt construction is not yet audited for cross-tenant text bleed. If any future call batches multiple orgs' inputs, one org's text could appear in another org's output. | `claudeAssessmentAnalyzer.ts`, `briefSynthesizer.ts`, `intelligenceBriefGenerator.ts` | Medium |
| R7 | Audit-log coverage is partial. Some mutations write events; some do not. The standard now requires it but the code is uneven. | `src/api/routes/*.ts` | Medium |
| R8 | No Postgres RLS. A single missed `WHERE organization_id = $1` leaks. Defense-in-depth is absent. Out of scope for this package; flagged for a future package. | DB layer | High (deferred) |
| R9 | API keys are admin-equivalent and bypass role checks. An org cannot issue a `viewer`- or `analyst`-scoped API key for service integrations. | `requireApiKey.ts`, `requireRole.ts` | Low/Medium |
| R10 | Internal admin actions on customer data do not yet uniformly require a reason payload. Standard now requires it; code is uneven. | admin routes | Low |
| R11 | Multer in-memory uploads have no per-org quota enforcement. A large tenant could exhaust worker memory. | `vendorAssessmentAnalysis.ts`, `transcribe.ts` | Low |

---

## §12. Out of scope / explicitly deferred

This package writes the standard. It does not change code, schema, or config. The following are deferred to follow-on packages:

- Postgres RLS rollout (defense-in-depth for §4).
- Sweep of the 26 routes that do not reference `organization_id` (R2).
- Verification of intelligence-worker → brief-generation per-org filtering (R5).
- LLM prompt-batching audit (R6).
- Entitlement vocabulary consolidation (R4) — mapping is codified here; renaming is a separate package.
- Per-API-key role scoping (R9).
- Audit-log coverage sweep (R7).
- Per-org upload quotas (R11).

---

## §13. Recommended next package

`tenant-isolation-enforcement` — a focused engineering pass driven by R1–R11. Scope outline:

1. Sweep the 26 non-org-referencing routes; classify each as "tenant-irrelevant" or "leak risk" with evidence (R2).
2. Verify the intelligence-worker → brief-generation path enforces per-org filtering at consumption time (R5).
3. Add a PR-time check (lint rule or test) that customer-data SQL strings include `organization_id` filtering (R1).
4. Audit LLM prompt construction sites for cross-tenant batching (R6).

Defer to subsequent packages:
- Postgres RLS (R8) — its own package after the sweep is clean.
- Vocabulary consolidation (R4) — its own package; touches Stripe webhook and migration.
- Per-API-key role scoping (R9) — its own package; touches `api_keys` schema.

---

## §14. Amendment protocol

To amend this standard:
1. Open a docs-only package proposing the change.
2. State which §section is affected and why current rules no longer fit.
3. If the amendment relaxes a rule, document the compensating control.
4. Update §11 (risks) if the amendment closes or opens a risk.
5. The amendment lands before any code that depends on the new rule.
