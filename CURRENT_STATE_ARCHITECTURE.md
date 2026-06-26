# CURRENT_STATE_ARCHITECTURE.md

## Purpose
This document describes what SecureLogic AI has actually built today, what is partial, what is missing, and what should be treated as current reality rather than aspiration.

## Stack
### Frontend
- React / Next.js application
- marketing website work in progress
- application UI includes briefs, dashboard, and selected product surfaces

### API
- Node.js + TypeScript
- Express-based API
- PostgreSQL-backed domain model
- Redis (rate-limit state, feed ETag short-circuit)
- route-based modular architecture
- email/password customer authentication with JWT bridge for cross-service identity (engine ↔ app)
- SAML SSO (samlify) and TOTP-based MFA (otplib) for enterprise authentication

### Worker / Intelligence pipeline
- intelligence worker service
- feed collection and normalization pipeline
- insight generation pipeline
- newsletter / brief generation pipeline
- LLM enhancement path for richer brief synthesis
- posture worker service (computes posture snapshots every 6 hours, deployed as a separate Render service)

### Hosting and infrastructure
- Render for application and service hosting
- PostgreSQL database
- Redis (Render-hosted)
- GitHub for source control
- Resend for email delivery
- Stripe is the active billing system (subscriptions, webhooks, customer portal)
- LemonSqueezy webhook handler is retained as dormant code, but the `/webhooks/lemon` route is unmounted (returns 404); Stripe is authoritative and Lemon is slated for full removal
- Google Workspace and Microsoft 365 are expected business systems
- Zoho tools are part of the expected business operating environment

## Environment model
SecureLogic AI currently operates two deployed environments (Production and Staging) and one logical demo surface (Demo).

### Production
- live client-facing environment
- real customer data
- revenue environment
- deployed on Render

### Staging
- pre-production environment
- deployed on Render, tracks the `develop` branch
- intended to mirror production closely enough for real validation
- all development changes should be validated here before promotion to production

### Demo
- currently implemented as a seeded organization inside a non-production database, not a separately deployed peer environment
- created by `scripts/seed-demo.ts` (e.g. seeded org "Meridian Financial Services")
- used for sales walkthroughs, screenshots, training, and internal showcase use
- must not contain real client data
- must not be treated as a substitute for staging
- a future package may promote Demo to a separately deployed environment; until then, treat Demo as a logical surface, not an environment peer to Staging

## Release flow
All product development is validated in Staging before promotion to Production.
Demo is for presentation, not production release validation.

Operating rule:
- Staging is for validation.
- Demo is for presentation.
- Production is for clients.

## Release state (2026-06-26 — matcher-R5 release)

Current branch heads:
- **Production (`main`)** is at `a1ab67f4` (the curated "matcher-R5" release, PR #363).
- **Staging (`develop`)** is at `12f7a77c` and **fully contains `main`** (`origin/develop..origin/main` = 0).

Now live in **production (`main`)**:
- **Matcher GAP-3 worker reachability (#354 / #355).** Phase-5 risk-exposure flagging and the risk→action generator are lifted into `runMatcherForSignal` (`src/api/lib/cyberSignalProcessingService.ts`) so the worker fan-out path reaches them; risk-action telemetry is included.
- **R5 closed.** The worker→brief per-org fan-out is verified org-isolated against a real Postgres by `test/isolation/r5PipelineIsolation.test.ts` (the `cross-org-isolation` CI lane). This resolves risk **R5** in `TENANT_ISOLATION_STANDARD.md` §11 and satisfies Priority-4 prerequisite **#5** in `BUILD_SEQUENCE.md`. Note: this proves the *route/worker `WHERE organization_id` discipline*; Postgres RLS remains inert pre-flip (defense-in-depth, separate A04-G1 track).

`develop`/staging-only — **NOT in production** (#356–#360): the marketing-website rebuild, pricing-model reconcile, `/platform` module availability, the website-staging service, and the app-landing retire (`app/src/app/page.tsx` → `/login`). These await their own marketing-release decision and have **not** been promoted to `main`.

Sequencing: **Priority 4 (Signal Ingestion Hardening) remains BLOCKED** pending operator authorization of the build scope. All three technical prerequisites (#5/#6/#7) are satisfied; clearing them makes the package ready to authorize, not authorized — Active ≠ Implementation Authorized.

## Current product areas
### 1. Primitive platform domains
Implemented or materially present:
- vendors
- AI systems
- obligations
- controls
- evidence
- risks
- dependencies
- findings
- actions / linkages
- posture snapshots and scoring outputs

### 2. Workflows
Implemented or materially present:
- vendor review workflow
- AI governance review workflow
- obligation compliance review workflow
- dependency review workflow
- risk treatment workflow
- evidence linkage workflow

### 3. Read surfaces
Implemented or materially present:
- dashboard summary
- compliance posture summary
- risk intelligence read surface
- intelligence brief web views
- selected posture and summary routes

### 4. Intelligence Brief pipeline
Current chain:
raw source item -> normalized signal -> stored insight -> LLM enhancement -> final brief item -> rendered brief

Current recent hardening work has focused on:
- preserving richer raw content
- reducing generic template leakage
- adding CVE and vendor context
- expanding rationale enrichment
- projecting final brief items into a cleaner output shape

## Current commercial packaging
The current offer stack is:
- Intelligence Brief — Free
- Brief Pro
- Team Professional
- Platform Professional
- Enterprise

Billing note:
- Platform Annual is only the annual billing option for Platform Professional

### Internal vs. external tier vocabulary
Customer-facing package names map to internal Stripe / entitlement keys as follows:

| External (docs, UI, marketing) | Internal (Stripe key, entitlement_level) |
|---|---|
| Intelligence Brief — Free | `free` |
| Brief Pro | `professional` |
| Team Professional | `teams` |
| Platform Professional | `platform` |
| Platform Annual (billing variant) | `platform_annual` |
| Enterprise | no Stripe key (custom contract) |

The internal keys predate the current naming and are kept stable to avoid Stripe price-ID migration risk. All customer-visible labels follow PRODUCT_VISION.md §Commercial model. Code references: `src/api/routes/billing.ts`, `src/api/webhooks/stripeWebhook.ts`, `src/api/startup/validateEnv.ts`.

## Current strengths
- platform domain model is materially real
- read/write workflows are no longer purely aspirational
- major objects have been modeled explicitly
- platform is moving beyond static admin records into workflow-backed state
- brief generation pipeline is materially richer than a generic digest path
- tests are present and used actively
- API surfaces are increasingly deterministic and scoped

## Current weaknesses
### 1. External signal ingestion is still immature relative to the final vision
The platform still needs a stronger external intelligence layer:
- broader source coverage
- stronger deduplication
- richer normalization
- source qualification
- stronger signal-to-platform linkage
- more reliable relevance logic

### 2. Some surfaces are ahead of underlying signal depth
Certain summaries and read surfaces now exist, but the signal intelligence layer beneath them is not yet fully mature.

### 3. Product and build documents have historically drifted
A recurring problem has been stale planning documentation and incomplete alignment between:
- product vision
- canonical model
- build sequence
- current code reality

### 4. Multi-tenant enterprise hardening must be treated as mandatory
The final product must support strict tenant isolation, but this must remain an active architectural standard rather than a casual assumption.

## Current architectural reality by area
### Identity and tenanting
The authoritative source for the tenant model, identity, query scoping, role model, file/object storage rules, background-job rules, internal-admin access, audit logging, and entitlement vocabulary is `TENANT_ISOLATION_STANDARD.md`.

Current expectation:
- multi-tenant SaaS model
- organization-scoped data (`organizations.id` is the tenant unit)
- user access tied to organization context, resolved via the standard middleware chain (`requireApiKey → attachOrganizationContext → requireEntitlement`)
- no customer data commingling permitted

Status (honest):
- the request-time tenant model is real: `attachOrganizationContext` is the sole loader of `entitlement_level`, JWT bridge always swaps to an active API key, and customer auth is in production
- query scoping is route-by-route discipline; an approximate ~74% of route files reference `organization_id` directly, the rest are health/public/auth/admin (figure is an unverified estimate — not re-measured this cycle)
- Postgres Row-Level Security is being rolled out table-by-table under A04-G1 (findings pilot, then batch A.1: `risks` + `posture_snapshots`); policies exist but are INERT pre-flip (owner cred, NOT FORCE), so route-by-route query scoping remains the only *live* tenant defense until the `app_request` role flip
- a Cloudflare R2 blob layer has shipped (`src/api/lib/blobStorage.ts`); vendor-assurance document storage is its first consumer (staging-gated)
- per-org background jobs follow the canonical posture-worker pattern; the intelligence worker is global and fans out per-org at consumption time — the consumption path is now verified (brief and digest schedulers enumerate per-org on `pgElevated` with per-org `withTenant` bodies)
- audit logging is wired but coverage across mutations is uneven
- the standard surfaces 11 specific code risks (R1–R11 in `TENANT_ISOLATION_STANDARD.md` §11) that drive the recommended `tenant-isolation-enforcement` follow-on package

### Data-subject rights (GDPR/CCPA)
Status (honest):
- schema foundation shipped (`db/migrations/20260621_gdpr_foundations.sql`): a tombstone-delete model (the `users` row is never hard-deleted — PII is scrubbed in place and the UUID is preserved for audit-trail integrity), `pending_deletion` / `deleted` status states, and a generic `jobs` table for async data-rights work
- the export engine exists as query + streaming core plus an executor (`src/api/services/dataExport/`): self-export read lists (Art. 15), full-organization read lists, NDJSON streaming, and `runExport`
- the `org_full` executor path is built but DELIBERATELY UNWIRED pending PR #2c (org_full export wiring); there is no route, worker, or UI yet
- the data-rights worker and the deletion reaper are not built; PR numbering beyond #2c referenced in code comments is not a committed roadmap

### Brief generation
Current expectation:
- richer than a summarized digest
- issue-level analysis with:
  - title
  - severity
  - category
  - audience
  - why it matters
  - analysis
  - recommendation / action
  - CVE when relevant
  - vendor when relevant
  - rationale for higher-risk items

Status:
- materially improved
- must continue to be treated as a premium intelligence product, not generic content output

### Platform UI
Current expectation:
- premium enterprise UX
- platform-first positioning
- brief as wedge, platform as core
- no placeholder or garbled copy
- no fake proof, vanity stats, or misleading certification implications

Status:
- partial
- some strong visual work exists
- still needs tighter product hierarchy and enterprise clarity

## Known gaps
The following should be treated as active gaps unless explicitly closed:
- stronger external signal ingestion and synthesis
- enterprise-grade tenant isolation standardization
- fuller operational controls and evidence discipline for SecureLogic AI as a company
- clearer service packaging and product distribution architecture
- stronger customer-facing proof of platform context beyond brief alone
- continued hardening of final brief quality

## What is partial
The following should be treated as partial even if code exists:
- some read surfaces
- some brief intelligence quality layers
- some workflow-to-context integrations
- UI completeness across all platform modules
- enterprise operating controls for SecureLogic AI itself

## What is not acceptable
Do not treat any of the following as finished merely because they technically exist:
- a route with no product-grade use case
- a dashboard section with weak underlying data
- a workflow without evidence traceability
- a brief output that still sounds generic
- a tenant model that depends on discipline without explicit standards
- planning documents that do not match shipped reality
