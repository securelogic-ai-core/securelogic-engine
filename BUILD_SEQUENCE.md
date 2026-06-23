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
`pillar1-vendor-assurance-worker` — the vendor-assurance durable extraction worker (four-pillar roadmap **Pillar 1 / Vendor & Third-Party Risk, Option B**: build the worker properly before prod enablement). It replaces the in-process `setImmediate` SOC-extraction runner (`src/api/lib/vendorAssuranceExtractionRunner.ts`, whose own header says *"do not promote this runner to production"*) with a dedicated durable worker that mirrors `securelogic-data-rights-worker`: the generic `jobs` queue + a new `vendor_assurance_extract` job_type, `UPDATE … FOR UPDATE SKIP LOCKED` claim with a 15-min visibility-timeout reclaim, retry/backoff/dead-letter, and a SIGTERM drain — so an engine redeploy can no longer strand an in-flight extraction in `extracting` with no retry.

Governing sequence: the four-pillar build roadmap (`docs/roadmap/four-pillar-build-roadmap.md`, #226) sets Pillar 1 as the next pillar; the finalized, decisions-locked build spec is `docs/roadmap/pillar1-vendor-assurance-worker-spec.md` (#227). **Those two docs are the controlling detail for this package** — read them before building.

Authorized scope: **spec §E Part 1 (steps 1–7) ONLY — staging-validated, zero prod changes:**
1. migration adding the `vendor_assurance_extract` job_type to the existing `jobs` table (reuse — no new queue table);
2. worker core (`src/api/workers/vendorExtractionWorker.ts`) reusing `dataRightsWorkerPolicy.ts`, satisfying the §B.7 idempotency hard-requirement with its gating reclaim-after-commit test;
3. worker service `services/vendor-extraction-worker/` (single serial instance, SIGTERM drain);
4. route flip — `uploadVendorAssuranceDocument` enqueues a job instead of `setImmediate(scheduleExtraction)`;
5. entitlement-gate change **in-package** — `requireEntitlement("standard")` → `requireEntitlement("premium")` across the vendor-assurance routes + `vendors.ts`;
6. render.yaml prod + staging twin worker blocks (`ANTHROPIC_API_KEY` worker-only);
7. staging soak — redeploy-kill reclaim, terminal-vs-retry semantics, idempotent re-run, queue-depth alerting.

Locked decisions (operator, 2026-06-20): rank-4 / premium gate shipping in-package — **the first fix of the documented entitlement inversion and the rank-4 precedent for all four platform pillars**; reuse the generic `jobs` table; single serial worker instance; queue-depth alerting over a hard per-org cap; `pdf_image_only` / `llm_invalid_json` terminal (non-retryable); `ANTHROPIC_API_KEY` worker-only.

Scope guard: **spec §E Part 2 — prod enablement (prod R2, `ANTHROPIC_API_KEY` on worker / removed from engine web, the `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` flip, prod smoke) — is NOT in this package.** It is a separately authorized step that runs only after Part 1 soaks green in staging. Do NOT flip the prod flag, do NOT touch prod env, and do NOT build the other Pillar 1 roadmap tasks (concentration risk, nth-party cascade, inherent/residual split) — those are separate, later packages.

Deferred follow-up (recorded from step 5, 2026-06-21): the step-5 gate flip covers `vendorAssuranceDocuments.ts` (18 routes) + `vendors.ts` (8 routes) and reconciles the 11 vendor/vendor-assurance UI pages to redirect rank-2 users. **Three vendor-adjacent route files remain at rank-2 `requireEntitlement("standard")` and are NOT flipped here: `src/api/routes/vendorAssessments.ts`, `src/api/routes/vendorReviews.ts`, `src/api/routes/findings.ts`.** Their UI pages (assess / framework / review / findings-new) now redirect rank-2 users, but their **APIs stay rank-2-accessible to a direct API-key caller** — a known, deliberate scope boundary (operator-accepted), not a silent gap. Flip these to `premium` in a later step so the entire vendor surface is consistently rank-4 at the API layer.

Deferred follow-up (recorded from step 6, 2026-06-22): the prod `securelogic-data-rights-worker` and `securelogic-posture-worker` blocks run `region: oregon` but reach the **virginia** prod Postgres — a pre-existing **cross-region** divergence, surfaced while adding the step-6 vendor-extraction-worker blocks (which are correctly pinned `region: virginia` per the region-pin rule). **NOT fixed here.** Evaluate re-provisioning those two prod workers to `virginia` in a later step (region is immutable post-provision, so it requires a re-create, not an edit).

## Completed (since last update)
- `vendor-assurance-intelligence-phase-0-blob-storage` — Cloudflare R2 blob primitive shipped to staging.
- `vendor-assurance-intelligence-phase-1` — superseded as the Active package by `gdpr-data-subject-rights`. The four-table schema, seven-route surface, in-process extraction runner, projection-at-read-time vendor card, and queue/review UI shipped to staging behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`. NOTE: the ≥30-SOC-report / ≥3-auditor acceptance gate is **not verified in this doc-sync** — confirm before marking truly done.
- GDPR data-subject-rights increments (all merged):
  - **PR #1** (`#182`) — schema foundation for data-subject rights (`db/migrations/20260621_gdpr_foundations.sql`).
  - **PR #2a** (`#184`) — export engine query + streaming core.
  - **PR #2b** (`#188`) — export executor + `org_full` query layer (pure functions; executor `org_full` path unwired pending #2c).
  - **PR #2c** (`#192` → develop; promote `#193` → main `11c6969f`, prod-verified 2026-06-13T14:59:09Z) — org_full export executor wiring (wires the `runExport` `org_full` path). Tables-only; R2 attachment streaming deferred.
  - **PR #2d** (`#196` → develop `07d8c63c`; promote `#197` → main `0dd01f91`, prod-verified 2026-06-13T20:49:33Z) — R2 attachment streaming for the org_full export. Streams `vendor_assurance_documents` blobs from R2 into `attachments/vendor-assurance/<docId>.pdf` (one at a time, bounded memory), cross-checks each streamed sha256 against the upload-time digest. `GENERATOR_VERSION 2.1.0`; confirmed-absent blob → disclosed `status:"unavailable"` manifest gap, indeterminate R2 error / sha256 mismatch → fail-whole.

  - **PR #3** — data-rights worker, EXPORT-ONLY (shipped to prod). New `services/data-rights-worker/` (thin runner) over `src/api/workers/dataRightsWorker.ts` (testable core): claims `data_export_self` / `data_export_org` jobs from `jobs` via `UPDATE … FOR UPDATE SKIP LOCKED` on the elevated channel (with a 15-min visibility-timeout reclaim of crashed jobs), resolves the self-export subject email from `users.email` inside `withTenant` (never the payload), runs `runExport`, and streams the bundle to R2 via the `@aws-sdk/lib-storage` multipart sink (`blobStorage.createObjectWriteStream` + `dataExportStorage.ts`, key `org/{orgId}/data-exports/{exportId}.zip`). Terminal write was `jobs.result` (`{r2_key, file_size_bytes, scope}`) + `status='succeeded'`; the `data_export_files` row + token were deferred to PR #5 (Decision D-1) — PR #5 now folds that row-write back into the worker success path. Retry/backoff → `queued`; non-retryable → `failed`; exhausted → `dead_lettered`. Carried a cross-org-isolation test proving org-A jobs never read org-B rows and the payload-email-poison case. The R2-sink-open failure was hardened at the job level in `#204`.

  - **PR #5** — self-export intake + delivery (`user_self` scope), **shipped + prod-verified 2026-06-18 (main `acb7c271`).** `src/api/routes/dataExports.ts` (authenticated intake + list + owner download) and a session-optional tokenized download route, plus `src/api/lib/dataExportDownloadToken.ts` (256-bit `randomBytes` token, plain SHA-256 hash, customerApiKeys convention) and a `getDataExportSignedUrl` read helper on `dataExportStorage.ts`. The worker `recordSuccess` mints the token + INSERTs the `data_export_files` row inside `withTenant(orgId)`. Migration `download_token_hash` comments corrected HMAC→SHA-256. No new migration (the `jobs` + `data_export_files` schema from PR #1 already suffices; the one-pending guard is a conditional INSERT, not a new constraint). Route-level cross-org + cross-user isolation tests, the one-pending 409 guard, and token-expiry rejection. Self-export **UI shipped alongside** (`#213` → promote `#214`). Exports are inert end-to-end only where the email sender is absent (deferred — PR #4).

**`gdpr-data-subject-rights` is COMPLETE as an active package** — the export path (PR #2a–#2d), the EXPORT-ONLY worker (PR #3), and self-export intake + delivery + UI (PR #5) are all shipped and prod-verified. The umbrella has deferred tails carried below for orientation only; none is authorized, and selecting any of them is a fresh active-package decision.

GDPR umbrella — deferred tails (NOT authorized; orientation only):
- **Export-delivery email (PR #4)** — emails the tokenized download link built in PR #5; uses a shared `sendEmail()`, no new Resend sender (Decision E). Next likely launch lever, but not authorized.
- **Deletion reaper** — Art. 17 erasure; destructive, heavy Phase 0 (10 locks settled, D-9 cleared → buildable, gated). Candidate, not authorized.
- **`org_full` intake + admin authz cluster** (Decision A: with admin member-delete + last-admin authz). Candidate, not authorized.
- **Export-file purge** — the O-11 7-day R2 bundle reaper (`export_file_purge` jobs). Candidate, not authorized.

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

- **PG integration test for the entity-cap webhook transition (PR #248).** Prerequisite: a Postgres-backed integration test lane (the unit suite mocks `pg`). The cap-transition logic is in SQL (`GREATEST(max_monitored_entities, 50)` on a paid grant, never lowered) and is currently **source-asserted only** — no execution-level proof. Once a real-PG lane exists, add a test for the past_due round-trip: `premium→starter→premium` preserves an admin-elevated cap.

- **Codify link-slice template in CLAUDE.md.** Prerequisite: all four link tables landed AND HTTP test harness package landed. **First prerequisite met; second pending.** Once landed, distill the link-slice rules into a one-page CLAUDE.md section so future link work and future-Claude don't re-derive the pattern from prior commits: standard middleware chain, global-signal asymmetry on cross-row pre-flight, semantically informative relationship line in `CANONICAL_DOMAIN_MODEL.md`, hardened insert template (parseLimit returning null on non-integer, `INSERT ... ON CONFLICT` against the partial unique index, named handler exports), and behavioral test scope (referencing the harness, not the per-slice direct-handler tests, once the harness is in). Pulled from the recurring "default-yes" answers given on each slice — codifying eliminates the per-slice re-asking.
