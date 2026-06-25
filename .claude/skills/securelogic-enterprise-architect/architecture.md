# Architecture

Verified map of the SecureLogic AI platform. Everything here is grounded in the
repository; where a claim is inferred rather than directly confirmed it is marked
**(inferred)**. When in doubt, the code wins — re-read and correct this file.

---

## 1. Architectural style

A **modular monolith engine + satellite workers + two Next.js frontends**, deployed as
separate Render services over a shared PostgreSQL database and Redis.

- The engine is a single Express application (`src/api`) organized by route modules and
  shared `lib/` services — not microservices. It owns all persistence, auth, billing,
  SSO, PDF generation, and external integrations.
- Background work runs as **separate worker processes** (`services/*`) that share the
  same database and reuse engine code (`src/api/workers/`, `src/api/lib/`) as their
  testable cores.
- The frontends are **API clients only** — the app talks to the engine server-side; no
  secret or API key reaches the browser.

There is **no ORM**: data access is raw `pg` with hand-written SQL. Validation is
hand-written per domain. This is deliberate (fine-grained control of SQL and error
shapes) and is the established pattern — follow it; do not introduce an ORM or a schema
library for routes without an explicit architecture decision.

---

## 2. The four buildable surfaces + workers

```
securelogic-engine/                 (repo root — Node 20, type: module, ESM)
├── src/                  ENGINE API  — Express 5 / TS. The core. Builds to dist/.
├── app/                  CUSTOMER APP — Next.js 15.5 / React 18 / iron-session.
├── website/              MARKETING    — Next.js 15.5 / React 19 / static export.
├── packages/contracts/   CONTRACTS    — shared types, published as securelogic-contracts.
└── services/             WORKERS      — 5 thin runners over src/api cores:
    ├── intelligence-worker/      signal ingestion + brief generation (hourly + 15-min KEV)
    ├── posture-worker/           posture snapshots every 6h, per active org
    ├── data-rights-worker/       GDPR export / deletion jobs from the `jobs` queue
    ├── vendor-extraction-worker/ SOC-report extraction jobs (Anthropic) from `jobs`
    └── delivery-worker/          legacy newsletter delivery — NOT in render.yaml (dead)
```

Each worker `tsc`-compiles to its own `dist-*` dir and runs a poll/schedule loop. The
**logic** lives in `src/api/` and is imported by the runner, so it is unit-testable
without spinning up a process. Follow this split for any new worker.

---

## 3. Engine internal layers and dependency direction

Dependencies point **inward and downward**. Higher layers may call lower ones; lower
layers must not import upward.

```
HTTP edge        src/api/server.ts → app.ts (global middleware) → routes/index.ts
   │             (helmet, cors, rate-limit, hpp, body parsers, Sentry, error handler)
   ▼
Route modules    src/api/routes/*.ts   (~112 files; one HTTP surface each)
   │             mount: requireApiKey → attachOrganizationContext → requireEntitlement → handler
   ▼
Middleware       src/api/middleware/*  (auth, org context, entitlement, admin chain, asTenant)
   │
   ▼
Lib services     src/api/lib/*         (validation, business logic, feedAdapter, alerting,
   │             briefScheduler, matcher, scoring glue, blobStorage, auditLog, jwt)
   ▼
Workers core     src/api/workers/*     (dataRightsWorker, vendorExtractionWorker)
   ▼
Pure engine      src/engine/**         (scoring V2/V1, frameworks, report builders) — NO I/O
   ▼
Infra            src/api/infra/*       (postgres.ts: pg / pgElevated / pgRaw / withTenant;
                                        logger.ts; redis; tenantContext.ts)
```

**Rules that fall out of this:**
- Routes orchestrate; they validate input, scope by org, call `lib/` and `infra/`, and
  shape the response. Keep heavy logic in `lib/`, not inline in the route.
- `src/engine/**` is **pure** (no DB, no network). All I/O for scoring lives in
  `src/api/lib/posture*.ts` / `postureComputation.ts`, which fetch rows and hand them to
  the engine. Preserve this — it's why the same engine powers posture, assessments, and
  reports identically.
- `infra/postgres.ts` is the only place that constructs Pools. Everything else imports
  `pg` / `pgElevated` / `pgRaw` / `withTenant` from it. The tenant-coverage census
  (`scripts/check-tenant-coverage.sh`) watches for stray `new Pool(...)`.

---

## 4. Request lifecycle (engine)

1. **Global middleware** (`src/api/app.ts`, in order): trust-proxy → request timeout
   (30s) → security headers + helmet + hpp → custom request-shape guards (oversized
   header/url/body, bad method-override, chunked-body rejects) → CORS allowlist →
   global rate-limit (300/min/IP) + slow-down → cache-control no-store → strict
   `Content-Type` enforcement → request-id + audit correlation → pino-http logging →
   drain-mode 503 gate → **Stripe webhook (raw body, mounted before the JSON parser)** →
   `express.json` (256 kb) → cookie parser → static assets → routes → 404 → Sentry
   capture → central `errorHandler` (last).
2. **Per-route auth chain**: `requireApiKey` (API key *or* JWT bridge) →
   `attachOrganizationContext` (loads `entitlement_level` + billing flags; the **sole**
   loader of entitlement) → `requireConsent` (JWT sessions, mounted globally before
   platform routes) → `requireEntitlement(level)` → optional `requireNotViewer` /
   rate-limit / usage-cap → handler.
3. **Handler**: early-return `403 organization_context_missing` if no org → validate body
   → org-scoped SQL via `pg` → `writeAuditEvent` on mutations → JSON response.
4. **Errors**: handlers catch and return shaped errors (`{ error: "..." }`); unexpected
   throws propagate to the central `errorHandler`, which logs and returns a clean 500
   without leaking stack traces in prod.

See `api-guidelines.md` for the exact route template and `examples/route-handler.md`.

---

## 5. Authentication & identity

Two credential paths converge on one downstream shape (`src/api/middleware/requireApiKey.ts`):

- **API key** — `X-Api-Key` or `Authorization: Bearer <key>`; SHA-256 hashed and matched
  against `api_keys.key_hash`. Treated as **admin-equivalent** for the org.
- **JWT bridge** — a customer-auth JWT (detected because it contains dots) is verified,
  checked against `users.password_changed_at` (fail-closed on DB error), viewer
  mutations are blocked, and then it is **exchanged for the org's most recent active API
  key**, which is injected as `req.apiKey`. All downstream middleware sees the same
  shape regardless of path.
  - **Known limitation (R3):** multiple active keys per org collapse JWT actions onto one
    canonical key in audit logs — actor attribution loss.

Customer auth routes (`/api/auth/*`) are pre-API-key by definition and are exempt from
`requireApiKey`; they use `req.jwtPayload` directly and must audit every state change.

**Roles** (`users.role`, in the JWT): `viewer` (read only), `analyst` (read + workflow
mutations), `admin` (everything incl. keys/billing/settings). Role enforcement is
JWT-only; API keys bypass role checks (R9). New mutation routes should add
`requireNotViewer`.

**Internal staff** never use a customer role. They use the `/admin/*` surface, gated by
`[adminLockout → requireAdminKey → adminRateLimit → adminAudit]`, authenticated by the
service-level `SECURELOGIC_ADMIN_KEY` (timing-safe compare) + a CIDR IP allowlist. No
per-staff identity, no admin session cookie.

See `security-review.md` for the full model.

---

## 6. Entitlement & subscription architecture

- **Single source of truth:** `organizations.entitlement_level`, written **only** by the
  Stripe webhook (`src/api/webhooks/stripeWebhook.ts`) and read **only** via
  `attachOrganizationContext`. Routes must not query `organizations` directly for
  entitlement.
- **Ranks** (`src/api/middleware/requireEntitlement.ts`): `starter=1`,
  `standard=2` (legacy alias of `professional=2`), `premium=4` (also matches
  `platform`/`team`). The `2 → 4` gap is intentional; don't change it in an unrelated
  package.
- **Three vocabularies** map to one concept (customer label / Stripe key /
  `entitlement_level` / rank). The authoritative table is `TENANT_ISOLATION_STANDARD.md`
  §9 — **cite it whenever you pick a gate level.**
- **Stripe flow:** checkout/portal in `routes/billing.ts`; webhook grants on
  `checkout.session.completed` + subscription created/updated(active|trialing), revokes
  to `free` on deleted/canceled/past_due/unpaid, flags `payment_failed_at` on
  `invoice.payment_failed`. Webhook is **idempotent** (claims the event id, fails closed
  on DB error so Stripe retries).
- **Metering:** entity caps (`organizations.max_monitored_entities`, default 50) enforced
  by `enforceEntityLimit` on vendor/AI-system creation (409 on exceed); webhook raises
  the cap on a paid grant via `GREATEST(...)` and never lowers it.

> **Known display drift (deferred, do NOT fix casually):** in-app price labels
> (`app/src/components/UpgradeCard.tsx`, `app/src/app/pricing/page.tsx`) disagree with
> the website pricing source (`website/src/lib/pricing.ts`). This is a *display-label*
> backlog item parked behind a Stripe-price decision — see `roadmap-assumptions.md`.
> Don't touch price IDs or labels without explicit authorization.

---

## 7. Tenant isolation runtime

The mechanism lives in `src/api/infra/postgres.ts` + `tenantContext.ts`:

- `pg` — a `Proxy` over the app Pool. Inside a `withTenant` scope, `pg.query()` and
  `pg.connect()` route to the scoped tenant client; outside, to the pool. Routes just use
  `pg` and get the right client transparently.
- `withTenant(orgId, fn)` — checks out a client, `BEGIN`, sets
  `app.current_org_id` via `set_config(..., true)` (SET LOCAL semantics), runs `fn` in an
  `AsyncLocalStorage` scope, `COMMIT` on success / `ROLLBACK` on throw.
- `asTenant(handler)` (`src/api/middleware/asTenant.ts`) — the route wrap: runs the
  handler inside `withTenant`, **buffers the response and flushes only after COMMIT**
  (commit-before-respond, via `deferredResponse.ts`), so a 2xx can never precede a failed
  commit. It throws loudly if a handler tries to stream (streaming routes must opt out).
- `pgElevated` — owner pool for legitimately cross-org work (audit writes, worker org
  enumeration, signup org-insert, admin reads). Bypasses tenant scope.
- `pgRaw` — documented escape hatch for `ISOLATION LEVEL`, advisory locks, `LISTEN/NOTIFY`,
  `COPY`; the caller sets its own GUC. A custom eslint rule
  (`eslint-rules/no-unrewriteable-stmt-in-tenant-wrap.js`) forbids un-rewriteable
  statements inside an `asTenant` handler.

**Today this is defense-in-depth only** — RLS is inert pre-flip. The **live** isolation
guarantee is the `WHERE organization_id = $n` discipline in every route. Treat both as
mandatory.

---

## 8. The intelligence pipeline (ingestion → brief)

Full detail in `source-ingestion.md`. The flow:

```
public feeds (RSS + KEV + NVD + reg feeds)         src/api/lib/feedAdapter/* (8 registered feeds)
        │  fetch + map (pure helpers)
        ▼
cyber_signals  (GLOBAL rows, organization_id = NULL, dedup via ON CONFLICT)
        │  per-org fan-out at CONSUMPTION time (pgElevated enumerates active orgs)
        ▼
runMatcherForSignal(signal, orgId)  inside withTenant(orgId)   src/api/lib/cyberSignalProcessingService.ts
        │   matches vendors / AI systems / controls / obligations → signal_match_suggestions
        │   creates findings, flags exposed risks, triggers a posture snapshot
        ▼
intelligenceBriefGenerator (pure) → briefSynthesizer (Anthropic LLM enrichment)
        ▼
intelligence_briefs + intelligence_brief_items → briefEmailRenderer → Resend
```

- **Three matcher invocation paths:** the worker pipeline
  (`services/intelligence-worker/src/pipeline/runPipeline.ts`), the KEV poller
  (`kevPoller.ts`, 15-min cadence), and the daily brief scheduler
  (`src/api/lib/briefScheduler.ts`, ~08:00 UTC). Keep all three in sync when changing
  matcher behavior.
- **Cross-org rule:** global ingestion writes only to **shared** signal tables
  (`organization_id IS NULL`). Per-org fan-out happens at consumption time and is itself
  org-scoped. Never write public-source ingestion straight into org-scoped tables.
- **Alerting** (`src/api/lib/alerting/alertService.ts`, `createAlertBatcher`) coalesces
  one Critical/High email per org per cycle — flag-gated by
  `SECURELOGIC_MATCHER_ALERTS_ENABLED` (default OFF).

---

## 9. Background jobs (the generic `jobs` queue)

`data-rights-worker` and `vendor-extraction-worker` share one durable pattern over the
`jobs` table:

- **Claim:** `UPDATE jobs SET status='processing', locked_by=…, locked_at=now() WHERE …
  FOR UPDATE SKIP LOCKED` on `pgElevated`, with a **15-min visibility-timeout reclaim** of
  crashed jobs.
- **Policy** (shared): `src/api/lib/dataRightsWorkerPolicy.ts` — exponential backoff,
  `decideFailureState`, `NonRetryableJobError`. Non-retryable → `failed`; attempts
  exhausted → `dead_lettered`; else re-`queued` with backoff.
- **Job types:** `data_export_self`, `data_export_org`, `account_deletion_reap`
  (flag-gated, reaper not fully built), `export_file_purge` (deferred),
  `vendor_assurance_extract`.
- **SIGTERM drain** so a redeploy can't strand an in-flight job.

Any new async work that can be retried should reuse this queue + policy, not a bespoke
`setImmediate`. See `examples/worker-job.md`.

The **posture worker** is the canonical *per-org scheduled* pattern (no queue): enumerate
active orgs on `pgElevated`, then `withTenant(orgId)` per org with per-org try/catch so
one tenant can't poison the cycle.

---

## 10. Risk / posture engine architecture

- `src/engine/scoring/v2/DomainRiskAggregationEngineV2` — per-domain score from open
  findings (max severity weight + log2 density boost, clamped 0–100) × context multiplier
  (regulated / safety-critical / handles-PII / scale).
- `OverallRiskAggregationEngineV2` — weighted blend of the top domains → overall score +
  severity.
- **Inputs** (assembled in `src/api/lib/postureComputation.ts` / `posture.ts`): open
  findings (severity, domain), open risks mapped to a finding shape
  (`source_type='risk'`), open + overdue action counts, org context profile.
- **Null rule:** zero open findings ⇒ overall score is `NULL`, presented as "insufficient
  data", never 0.
- Same engines power posture snapshots, assessments, and executive reports — one scoring
  brain, many surfaces. Don't fork it per output.

`risk_scoring_weights` (one row/org, customer-configurable) drives the *matcher* relevance
score (`computeRiskScore`), a separate concern from posture aggregation. Note its
deliberate **two-vocabulary design** (PascalCase severity vs lowercase criticality) — see
`domain-model.md`; do not "canonicalize" it.

---

## 11. Output / reporting surfaces

- **PDF / export:** `src/report/**` (Executive Risk Report V2 builder + PDFKit
  renderers), `src/reporting/**` (audit sprint), `routes/gapReport.ts`,
  `routes/auditPackage.ts`, `routes/executiveReport.ts`, `routes/findingsExport.ts`,
  ExcelJS for vendor exports.
- **Read surfaces:** `routes/dashboard.ts`, `posture.ts`, `topRisks*.ts`, `trends.ts`,
  `intelligenceBriefs.ts`, plus the app pages that render them.
- All outputs **consume** canonical domain objects; none may become the source of truth
  for them (`CANONICAL_DOMAIN_MODEL.md` governing principle).

---

## 12. Deployment architecture

`render.yaml` defines **7 production services** (engine web, intelligence-worker,
posture-worker, data-rights-worker, vendor-extraction-worker, app, website) and **6
staging mirrors** (tracking `develop`).

- **Regions:** engine + intelligence-worker + vendor-extraction-worker (prod) and **all
  staging** run in **Virginia** (primary DB region). App, website, posture-worker, and
  data-rights-worker (prod) run in **Oregon** — a known cross-region divergence for the
  two workers (region is immutable post-provision; fix requires re-provision). Pin
  `region:` on every block.
- **Secrets placement:** `ANTHROPIC_API_KEY` is on the **workers only** in prod, not the
  engine web service. **R2** (Cloudflare blob) is **staging-only**; prod engine R2 env
  stays unset until a dedicated enablement package.
- **Migrations** run on engine boot (`startCommand: npm run migrate && npm start`), so any
  `main` push redeploys all connected services and applies pending migrations
  idempotently.
- **Feature flags** are `SECURELOGIC_*_ENABLED` env vars (e.g. `_ACTION_ENGINE_`,
  `_LLM_CONTROL_MATCHER_`, `_FUZZY_VENDOR_MATCH_`, `_VENDOR_ASSURANCE_`,
  `_MATCHER_ALERTS_`). New risky behavior ships dark behind a flag and is enabled in
  staging first.

---

## 13. Code zones (live vs. dead) — authoritative

**LIVE (in the prod build / running services):**
`src/api/**`, `src/engine/**`, `src/runtime/**`, `src/reporting/**`, `src/report/**`,
`src/reports/**`, `src/contracts/**`, `src/templates/**`, `src/frameworks/**`,
`src/scheduler/**`, `src/types|schema|utils|patterns|product|adapters|tools/**`,
`services/{intelligence,posture,data-rights,vendor-extraction}-worker/**`,
`app/src/**`, `website/src/**`, `packages/contracts/**`, `db/migrations/**`.

**DEAD / EXCLUDED (don't read for patterns, don't extend):**
`src/_frozen_prod/`, `src/_excluded_prod/`, `src/_disabled/`, `src/_dev_DISABLED/`,
`src/_product_DISABLED/`, `src/_report_DISABLED/`, `src/_server_DISABLED/`,
`src/signals/`, `src/ingestion/`, `_legacy_disabled/`, `_quarantine/`,
`packages/_legacy_engine_core/`, `services/delivery-worker/` (unwired), and root scratch
files (`dashboard.jsx`, `*-run.js`, loose fixtures).

`src/_frozen_prod/__tests__` is the exception — `npm run test:prod` runs it as a frozen
regression snapshot — but the non-test code there is not shipped.
