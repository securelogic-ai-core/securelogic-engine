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

- **HTTP test harness for link routes.** Prerequisite: all four parallel link tables in place (signal-to-vendor done; signal-to-AI-system in flight; signal-to-control and signal-to-obligation pending). Reason to defer: structural source-pattern tests are the right call per slice; introducing a behavioral HTTP harness mid-pattern would be architectural drift. Once the four are landed, backfill behavioral tests as one focused harness package covering all four route surfaces uniformly.
