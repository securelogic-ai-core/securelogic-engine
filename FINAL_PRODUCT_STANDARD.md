# FINAL_PRODUCT_STANDARD.md

## Purpose
This document defines what “enterprise-grade final product” means for SecureLogic AI. It is the quality bar for architecture, workflows, intelligence output, security, product execution, and release discipline.

## Core final-product truth
SecureLogic AI must ship as a serious cyber risk intelligence platform.
It must not ship as a collection of half-connected admin surfaces, generic AI text, or shallow summaries.

## Product standards
### 1. Platform-first standard
The Platform is the main product.
The Intelligence Brief is the wedge.
All product decisions must reinforce that hierarchy.

### 2. Commercial model standard
The active commercial packaging is:
- Intelligence Brief — Free
- Brief Pro
- Brief Team
- Platform Professional
- Enterprise

Billing note:
- Platform Annual is only the annual billing option for Platform Professional
- Platform Annual must not be treated as a separate product tier in product docs, pricing logic, architecture assumptions, or build prompts

### 3. Operating-layer standard
The product must connect:
- external signals
- vendors
- AI systems
- obligations
- controls
- risks
- findings
- evidence
- actions
- posture

If a feature does not reinforce this operating-layer model, it is suspect.

#### Supportability (added 2026-08-21)

A capability is not finished when it works — it is finished when someone can
support it. For any package changing customer-facing behaviour, ask once:

> Does this change introduce or materially change a customer-visible failure mode,
> an operator recovery action, a security escalation path, or a support diagnostic?

If **yes**, the corresponding support runbook is created or updated in the same
package. If **no**, nothing is required and nothing should be said — a ritual
answer to a question nobody asked turns a real check into noise.

Behaviour behind a flag that is **off in production** is not yet reachable by a
customer: the runbook belongs to the package that turns the flag **on**.

See `docs/runbooks/support/` — `DEFINITION-OF-DONE.md` for the boundary,
`SUPPORT-AUTHORITY-MODEL.md` for what each support level may do. The standing
principle is that **support does not manipulate production database state to solve
customer problems**; any exception must be a named, documented procedure.

### 4. Decision-quality standard
Every premium intelligence output must help a user:
- understand what changed
- understand why it matters
- understand what exposure it creates
- understand what should happen next
- understand who should act and by when

### 5. Read-surface taxonomy standard (ratified 2026-07-21, Briefing Initiative)
The platform has three distinct kinds of read surface. They answer different
questions and must never be collapsed into one experience:

- **The Briefing** (`/dashboard`, the opening experience) — *"What matters to
  me now?"* Personalized, priority-ordered, assignment-aware. Every number
  carries an explicit scope ("You" vs "Organization"); a personal count is
  omitted — never faked as zero — when the session has no user identity.
- **Operational Views** (queues and explorers: Operations Workspace, Finding
  Explorer, Actions, Approvals, Review Links) — *"What do I want to inspect or
  investigate?"* Where work is listed, filtered, and acted on.
- **Dashboards** (`/posture`, `/executive`, framework readiness, heatmaps,
  reports) — *"How is the organization performing?"* Analytical, org-wide.

Rules:
- A Briefing module SUMMARIZES and LINKS to an operational view or dashboard;
  it never reproduces a data explorer or an analytical grid on the opening
  screen.
- Operational views and dashboards remain first-class destinations; the
  Briefing must preserve clear access to them, and personalization never
  removes a user's authorized access to any of them.
- Permissions override personalization: a saved layout, template, or profile
  never grants access to data the session is not authorized to read.
- Every module/tile number must link to a destination that reproduces it, at
  the same scope it displays.

## Environment and release standards
### 1. Environment roles
SecureLogic AI operates:
- Production
- Staging
- Demo

Definitions:
- Production = live client environment
- Staging = pre-production validation environment
- Demo = presentation and seeded showcase environment

### 2. Release discipline
Required:
- all production-bound changes must be validated in Staging before promotion to Production
- Staging must mirror Production closely enough for meaningful validation
- Demo must not be used as the primary validation environment for production release decisions

### 3. Demo safety
Required:
- no real client data in Demo
- Demo data must be seeded, synthetic, or otherwise safe for showcase use
- Demo may be optimized for presentation, but must not become the informal source of truth for production readiness

## Architecture standards
### 1. Tenant isolation
No customer data commingling is acceptable.

The authoritative source for the tenant model and isolation rules is `TENANT_ISOLATION_STANDARD.md`. The summary requirements below are non-exhaustive; every package that touches customer data MUST conform to that standard in full.

Required (summary):
- every customer-data table must be tenant-scoped
- every authenticated request must resolve organization context
- every query must enforce tenant boundaries
- every file/object storage path must be tenant-scoped
- every background job and AI job must preserve tenant context
- internal/admin access must be controlled and auditable

If `TENANT_ISOLATION_STANDARD.md` and any other doc disagree on a tenant rule, `TENANT_ISOLATION_STANDARD.md` wins until explicitly amended via its §14 protocol.

### 2. Deterministic data model
Every major platform object must be explicitly modeled.
No critical workflow should depend on undefined or ad hoc objects.

### 3. Traceable linkage
Signals, findings, evidence, obligations, risks, and actions must be linkable in a way that is explainable to customers and auditors.

### 4. Safe deployment progression
SecureLogic AI may begin with shared SaaS multi-tenancy, but the design must support stronger isolation and dedicated or customized deployment for enterprise customers.

## Workflow standards
### 1. Workflow usefulness
A workflow is not “done” because it has routes and tables.
It is done when:
- it supports a real use case
- it has usable state transitions
- it supports evidence or action
- it can feed posture or intelligence outputs when relevant

### 2. Evidence discipline
Any workflow that claims operational value must support evidence or evidence linkage where appropriate.

### 3. Auditability
High-value actions must be explainable after the fact:
- what changed
- who changed it
- what was linked
- what evidence exists
- what decision was made

## Intelligence standards
### 1. No generic language
The platform must not ship premium intelligence that sounds like:
- “this development may affect posture”
- “organizations should review”
- “this highlights governance questions”
- “could potentially”
- “this underscores the importance”

Generic AI language is unacceptable.

### 2. Rich signal context
The intelligence layer must preserve enough source context to support:
- vendor naming
- product naming
- CVE naming
- actor naming
- operational implications
- business implications
- concrete action

### 3. Premium brief standard
Every published premium brief item must support:
- title
- severity
- category or section
- audience
- whyItMatters
- analysis
- recommended action
- affected CVE when available
- affected vendor when available
- rationale for higher-risk items

### 4. Signal quality before presentation polish
Improving renderers without fixing shallow signal synthesis is out of sequence.

## UI and UX standards
### 1. Premium enterprise feel
The product and marketing surfaces must feel:
- premium
- deliberate
- enterprise-ready
- restrained
- high-trust

### 2. No placeholder quality
Unacceptable:
- garbled text
- placeholder copy
- unsupported vanity metrics
- fake issue counts
- fake subscriber counts
- misleading certification implications

### 3. Product proof
The UI must visibly demonstrate that intelligence becomes action, evidence, and posture.
The product must not feel like a newsletter with software attached.

## Testing standards
### 1. Targeted validation required
No meaningful package is complete without targeted validation.

### 2. Output-shape tests
For intelligence and summary surfaces, test the actual output shape, not just helpers.

### 3. Negative-path tests where trust matters
Tenant isolation, access control, and key workflow boundaries must include negative-path verification where relevant.

## Documentation standards
### 1. Docs must match reality
Stale docs are treated as defects.

### 2. Each doc must have a distinct purpose
- PRODUCT_VISION.md = what the product is
- CURRENT_STATE_ARCHITECTURE.md = what exists now
- CANONICAL_DOMAIN_MODEL.md = what objects exist
- TENANT_ISOLATION_STANDARD.md = the tenant model and isolation rules every package must follow
- BUILD_SEQUENCE.md = what gets built next and in what order
- FINAL_PRODUCT_STANDARD.md = what “done right” means
- CLAUDE.md = how Claude should execute

### 3. No overlapping ambiguity
If multiple docs say different things, the contradiction must be resolved before major package work continues.

## Security and enterprise readiness standards
SecureLogic AI must be able to credibly answer future client and auditor questions about:
- tenant isolation
- access control
- evidence handling
- logging and traceability
- vendor reliance
- platform workflows
- deployment model
- handling of customer data

## Not acceptable
The following are explicitly unacceptable as a final product state:
- customer data that can leak across tenants
- “done” features with no product-grade use case
- read surfaces backed by weak or misleading data
- premium intelligence that reads like generic AI filler
- platform claims unsupported by the actual workflow layer
- build work chosen for convenience rather than sequence
- docs that are stale, conflicting, or aspirational instead of accurate
- marketing that overstates certifications, proof, or traction
- production release decisions made without real staging validation
- real client data present in Demo

## Final bar
SecureLogic AI is ready when:
- the platform behaves like an operating layer, not a feature pile
- the intelligence is decision-grade
- the data model is coherent
- tenant isolation is defensible
- evidence and workflows are traceable
- the UI feels premium and trustworthy
- the docs accurately govern future work
- staging, demo, and production are used for their correct purposes
