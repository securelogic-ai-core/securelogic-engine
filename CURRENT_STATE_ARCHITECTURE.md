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
- Redis (sessions, rate-limit state, feed ETag short-circuit)
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
- LemonSqueezy webhook signing remains wired as a legacy artifact and is slated for removal — Stripe is authoritative
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
Current expectation:
- multi-tenant SaaS model
- organization-scoped data
- user access tied to organization context
- no customer data commingling permitted

Status:
- organization scoping exists conceptually and in domain design
- tenant isolation standards must remain explicit and enforced in all future work

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
