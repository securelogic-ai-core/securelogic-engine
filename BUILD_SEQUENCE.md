# BUILD_SEQUENCE.md

## Purpose
This document defines the build order for SecureLogic AI. It exists to stop architectural drift, local optimization, and out-of-sequence package work.

## Execution rules
- Build one package at a time.
- Do not infer the next package from convenience.
- Do not broaden scope beyond the active package.
- Do not commit without explicit authorization.
- Stop after package completion and present exact commit scope.
- Keep the current working tree and these docs aligned.

## Environment and release discipline
SecureLogic AI uses:
- Production for live customer operations
- Staging for pre-production validation
- Demo for presentation and seeded showcase use

Release rules:
- all production-bound work must be validated in Staging first
- Demo is not a substitute for Staging
- no production release decision should be based solely on Demo behavior
- seeded demo data belongs in Demo unless a non-production seed package explicitly targets another environment

## Current strategic phase
Phase: Product hardening from strong foundations into enterprise-ready intelligence operations

This phase assumes:
- foundational domain objects materially exist
- major workflows materially exist
- read surfaces exist in several areas
- the next work must prioritize signal quality, tenant isolation, product coherence, and enterprise operating readiness

## Completed foundation categories
These categories are treated as materially established:
- core domain primitives
- workflow layer across vendor, AI governance, obligation, dependency, and risk treatment areas
- core summary/read surfaces
- basic intelligence brief generation path
- several route integration and helper test packages

## Current commercial alignment
The commercial model that all future product and packaging work must respect is:
- Intelligence Brief — Free
- Brief Pro
- Team Professional
- Platform Professional
- Enterprise

Billing note:
- Platform Annual is not a product tier; it is the annual billing option for Platform Professional

## Active package
`gdpr-data-subject-rights` — the GDPR/CCPA data-subject-rights capability (umbrella workstream: Arts. 15 / 17 / 20 + CCPA equivalents). It delivers, across an enumerated sequence of increments, the schema foundation, the export engine, the deletion/tombstone model, the async data-rights worker, and supporting query layers.

Increment status: the export path (PR #2a / #2b / #2c / #2d) is shipped to prod — export capability complete (tables + attachments). **NO increment is currently authorized — the next increment must be explicitly selected and scoped at next session start before any code.**

Scope guard: no increment is authorized under this package right now. Do not begin the data-rights worker, the deletion reaper, the route surface, or the UI.

Increment caveat: the increment numbering that appears in code comments and migration headers (a worker PR, a reaper "PR #6", etc.) is aspirational shorthand, not a committed roadmap. The tail (#4 / #6 / #7 / #8) is unenumerated — do not treat those numbers as a plan of record.

Candidate next increments (NOT authorized — listed for orientation only; selection and scoping happen at next session start):
- Data-rights worker — async job runner for data-subject requests. Candidate, not authorized.
- Deletion reaper — Art. 17 erasure; destructive, requires heavy Phase 0 before any code. Candidate, not authorized.
- Route/intake + UI surface — data-subject-request intake routes and UI. Candidate, not authorized.

## Completed (since last update)
- `vendor-assurance-intelligence-phase-0-blob-storage` — Cloudflare R2 blob primitive shipped to staging.
- `vendor-assurance-intelligence-phase-1` — superseded as the Active package by `gdpr-data-subject-rights`. The four-table schema, seven-route surface, in-process extraction runner, projection-at-read-time vendor card, and queue/review UI shipped to staging behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`. NOTE: the ≥30-SOC-report / ≥3-auditor acceptance gate is **not verified in this doc-sync** — confirm before marking truly done.
- GDPR data-subject-rights increments (all merged):
  - **PR #1** (`#182`) — schema foundation for data-subject rights (`db/migrations/20260621_gdpr_foundations.sql`).
  - **PR #2a** (`#184`) — export engine query + streaming core.
  - **PR #2b** (`#188`) — export executor + `org_full` query layer (pure functions; executor `org_full` path unwired pending #2c).
  - **PR #2c** (`#192` → develop; promote `#193` → main `11c6969f`, prod-verified 2026-06-13T14:59:09Z) — org_full export executor wiring (wires the `runExport` `org_full` path). Tables-only; R2 attachment streaming deferred.
  - **PR #2d** (`#196` → develop `07d8c63c`; promote `#197` → main `0dd01f91`, prod-verified 2026-06-13T20:49:33Z) — R2 attachment streaming for the org_full export. Streams `vendor_assurance_documents` blobs from R2 into `attachments/vendor-assurance/<docId>.pdf` (one at a time, bounded memory), cross-checks each streamed sha256 against the upload-time digest. `GENERATOR_VERSION 2.1.0`; confirmed-absent blob → disclosed `status:"unavailable"` manifest gap, indeterminate R2 error / sha256 mismatch → fail-whole.

## In-Flight Infrastructure
Cross-cutting hardening that runs in parallel with the active product package — neither queued nor blocked. It is not a feature increment, so it does not pass through the Active-package one-at-a-time discipline; it is sequenced internally by its own rollout plan.

- **A04-G1 — Postgres Row-Level Security rollout.** Table-by-table RLS enablement toward an eventual `owner → app_request` role flip. Landed: the route-wrap mechanism (`asTenant`), the commit-before-respond shim, the findings/risks/posture route wraps, and the findings pilot + batch A.1 (`risks` + `posture_snapshots`) policies. All policies are INERT pre-flip (owner cred, NOT FORCE). Remaining: continue per-table batches, then the `DATABASE_URL` `app_request` flip (phase-3) and the staging flip. Tracked in `TENANT_ISOLATION_STANDARD.md` and the A04-G1 rollout docs. Genuinely parallel to the active product package — do not fold it into the priority queue.

## Current build priorities
Priority order is fixed unless explicitly changed in this document.

### Priority 1 — Product and architecture alignment
#### Package: docs-product-alignment
Objective:
Bring PRODUCT_VISION.md, CURRENT_STATE_ARCHITECTURE.md, BUILD_SEQUENCE.md, FINAL_PRODUCT_STANDARD.md, and existing canonical documents into one coherent source of truth.

Why this matters:
Claude cannot build the platform correctly if the governing docs are stale, ambiguous, or overlapping.

Done when:
- product vision is clear
- current state is honest
- next packages are explicitly sequenced
- standards are defined
- docs are usable as operational build guidance

### Priority 2 — Tenant isolation standard
#### Package: tenant-isolation-standard
Objective:
Define and enforce the SecureLogic AI tenant model at the product and engineering level.

Required outcomes:
- every customer-data domain is organization-scoped
- tenant access rules are explicit
- storage/file handling rules are explicit
- job/AI processing tenant rules are explicit
- internal/admin access rules are explicit
- architectural standard is documented for all future packages

Likely files:
- FINAL_PRODUCT_STANDARD.md
- architecture/security docs
- auth and organization-context code references if needed
- any tenant-related route middleware docs

Hard rules:
- no new feature package should proceed without clarity here if it materially touches customer data

Done when:
- the tenant isolation approach is documented clearly enough that a developer cannot accidentally build cross-tenant behavior

### Priority 3 — External signal architecture
#### Package: external-signal-architecture
Objective:
Define the target external signal model for SecureLogic AI so future ingestion work follows a coherent design rather than adapter-by-adapter improvisation.

Required outcomes:
- external signal object definition
- source qualification model
- normalization expectations
- deduplication expectations
- linkage expectations into vendors, AI systems, obligations, risks, findings, and briefs
- distinction between raw source item, normalized signal, enriched signal, and brief item

Done when:
- the platform has a documented external intelligence architecture that matches the product vision

### Priority 4 — Signal ingestion hardening
#### Package: signal-ingestion-hardening
Objective:
Improve the actual quality and reliability of ingested signal data before expanding more output surfaces.

Required outcomes:
- stronger source breadth or better source quality
- normalization depth improvement
- better deduplication
- better severity/context extraction
- stronger signal preservation for downstream brief synthesis

Done when:
- inputs to the intelligence pipeline are materially richer and more reliable

### Priority 5 — Signal-to-platform linkage
#### Package: signal-to-platform-linkage
Objective:
Map external signals into real platform context.

Required outcomes:
- signals can resolve against vendors
- signals can resolve against AI systems
- signals can resolve against obligations
- signals can resolve against dependencies and risks
- linkage can support findings, reassessment triggers, and brief relevance

Done when:
- external intelligence no longer floats separately from the platform operating model

### Priority 6 — Intelligence Brief premiumization
#### Package: brief-premiumization
Objective:
Make the Intelligence Brief a real premium intelligence product, not a polished digest.

Required outcomes:
- issue quality feels analyst-grade
- cross-signal synthesis is stronger
- relevance/context logic is stronger
- executive and operator value is obvious
- free vs paid brief differentiation is clear across:
  - Intelligence Brief — Free
  - Brief Pro
  - Team Professional
- platform relationship remains explicit

Done when:
- a paid user would reasonably perceive the brief as decision support worth paying for

### Priority 7 — Platform context surfaces
#### Package: platform-context-surfaces
Objective:
Ensure the product visibly demonstrates how intelligence becomes action, evidence, and posture.

Required outcomes:
- stronger product proof surfaces
- more visible context linkage in UI/API where needed
- no “platform attached to newsletter” ambiguity

Done when:
- the platform’s core operating-layer value is obvious in the product itself

### Priority 8 — Enterprise customer distribution model
#### Package: customer-distribution-and-isolation
Objective:
Formalize how the platform is distributed to clients and how data segregation is enforced operationally.

Required outcomes:
- default shared SaaS model documented
- logical tenant isolation documented
- dedicated or customized deployment path documented for enterprise where needed
- customer-facing explanation available
- internal operational standard defined

Done when:
- SecureLogic AI can credibly answer client security reviews about tenant separation and deployment models

### Priority 9 — SecureLogic AI internal control environment
#### Package: securelogic-internal-controls
Objective:
Build the minimum auditable operating environment for SecureLogic AI as a service organization.

Required outcomes:
- system boundary
- asset inventory
- vendor inventory
- access review process
- minimum security requirements
- evidence repository structure
- risk/control baseline
- management review cadence

Done when:
- SecureLogic AI begins operating like a service organization that expects client and auditor scrutiny

## Package template for future use
Every new package must define:
- package name
- objective
- why it matters
- dependencies
- files likely involved
- required behavior
- hard rules
- validation required
- done definition

## Validation policy
Default validation:
- run only the minimum checks required for the active package
- prefer targeted tests over repo-wide verification
- typecheck only when needed
- app builds only when the package affects app behavior materially

## Commit policy
- default is one commit per completed package
- batching only by explicit authorization
- stop after package completion and present exact commit scope
- do not continue accumulating completed packages without permission

## Anti-drift rules
Do not:
- choose the next package because it is easy
- build UI polish ahead of missing architectural layers
- build read surfaces that outrun weak underlying data
- confuse the Brief with the core platform
- allow docs to become stale after major package work

## Backlog (deferred until prerequisites land)
Items surfaced during package work that are out of scope for the active package and waiting on a specific prerequisite. Not a wishlist — each entry must name the prerequisite and the reason it cannot be done now.

- **HTTP test harness for link routes.** Prerequisite: all four link tables landed — **prerequisite met** (signal-to-vendor, signal-to-AI-system, signal-to-control, signal-to-obligation all shipped). Pullable now. Behavioral coverage on the four shipped link routes is currently limited to the `parseLimit` fractional-input path and the `ON CONFLICT` insert-race path (per `link-route-template-hardening` — see the "Behavioral tests" section in `signalVendorLinks.test.ts`, `signalAiSystemLinks.test.ts`, `signalControlLinks.test.ts`, and `signalObligationLinks.test.ts`). The harness package will introduce a uniform behavioral test surface across all four routes — first behavioral test infrastructure in the repo that doesn't follow the existing template, so it needs its own scoping conversation before build. **Sequence after pull: this package first, then `Codify link-slice template in CLAUDE.md` (so the codified template can reference real behavioral coverage, not aspirational coverage).**

- **Codify link-slice template in CLAUDE.md.** Prerequisite: all four link tables landed AND HTTP test harness package landed. **First prerequisite met; second pending.** Once landed, distill the link-slice rules into a one-page CLAUDE.md section so future link work and future-Claude don't re-derive the pattern from prior commits: standard middleware chain, global-signal asymmetry on cross-row pre-flight, semantically informative relationship line in `CANONICAL_DOMAIN_MODEL.md`, hardened insert template (parseLimit returning null on non-integer, `INSERT ... ON CONFLICT` against the partial unique index, named handler exports), and behavioral test scope (referencing the harness, not the per-slice direct-handler tests, once the harness is in). Pulled from the recurring "default-yes" answers given on each slice — codifying eliminates the per-slice re-asking.
