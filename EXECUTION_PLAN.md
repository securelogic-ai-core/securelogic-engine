> **DEPRECATED — non-governing**
>
> This document is legacy. It does not govern current build work.
>
> The governing source of truth is (read in this order):
> 1. PRODUCT_VISION.md
> 2. CURRENT_STATE_ARCHITECTURE.md
> 3. CANONICAL_DOMAIN_MODEL.md
> 4. BUILD_SEQUENCE.md
> 5. FINAL_PRODUCT_STANDARD.md
> 6. CLAUDE.md
>
> Content below is preserved for historical reference only and may conflict with the governing docs above. The "Phase 0 — Complete and Launch Intelligence Brief" framing in particular contradicts the platform-first stance in PRODUCT_VISION.md and FINAL_PRODUCT_STANDARD.md. Do not use this document for product, architecture, or sequencing decisions.

---

# SecureLogic AI — Execution Plan

Read this after `CLAUDE.md`.
For UI work, also read `SECURELOGIC_UI_BRIEF.md`.

This document converts the SecureLogic platform vision into an execution sequence that Claude Code and ChatGPT can follow.

---

## Core Roles

### Claude Code
Owns:
- repo inspection
- implementation planning inside the repo
- code generation
- refactors
- route creation
- backend service wiring
- frontend implementation
- typed contracts and interfaces
- tests and local code changes

Claude Code must:
- read `CLAUDE.md` first
- read `SECURELOGIC_UI_BRIEF.md` for UI work
- propose the smallest safe plan before editing
- identify real vs mocked
- list files before editing
- wait for approval before major code changes
- never commit or push unless explicitly told

### ChatGPT
Owns:
- product architecture
- roadmap and sprint planning
- monetization design
- UX and information architecture
- implementation review
- prioritization
- debugging strategy
- validating whether Claude's plan matches the SecureLogic vision

---

## Strategic Sequence

## Phase 0 — Complete and Launch Intelligence Brief
This is the immediate priority.

Objective:
Ship the first live SecureLogic service as a paid, low-touch product.

Why this is first:
- it is the most mature service already in the build
- monetization is already in progress
- it creates the first real user path and revenue proof
- it validates entitlements, billing, delivery, and product UX
- it prevents platform sprawl before first launch

Success criteria:
- a user can land on the site
- understand the Intelligence Brief offer
- create an account or subscribe
- pay through Stripe
- receive correct entitlements
- access allowed brief content
- be blocked from premium content when not entitled
- view latest brief and archive
- have a stable production experience on Render

### Phase 0 Epics

#### Epic 0.1 — Billing and Subscription Completion
Goals:
- finish Stripe checkout flow
- finish webhook handling
- complete subscription lifecycle updates
- map Stripe state to SecureLogic entitlements
- support plan-aware access states

Deliverables:
- checkout session creation
- webhook endpoint
- subscription status persistence
- plan state resolution logic
- billing error handling

#### Epic 0.2 — Entitlement and Access Gating
Goals:
- ensure free vs paid access is enforced consistently
- define locked vs unlocked brief behavior
- make archive and detail pages entitlement-aware

Deliverables:
- entitlement middleware / gating logic
- archive access rules
- detail page access rules
- locked-content UI states
- fallback states for missing or stale billing data

#### Epic 0.3 — Intelligence Brief Product Surface
Goals:
- complete the user-facing product experience for the first service

Deliverables:
- latest brief page
- brief detail page
- archive page
- locked content states
- billing/upgrade flow entry points
- basic account/subscription visibility

#### Epic 0.4 — Delivery Path Hardening
Goals:
- make the Intelligence Brief generation and retrieval path production-grade

Deliverables:
- reliable generation workflow
- storage and retrieval validation
- stable API delivery path
- logging and error handling
- failure visibility for scheduled runs

#### Epic 0.5 — Launch Readiness
Goals:
- make the service launchable

Deliverables:
- production env validation
- Render deployment verification
- plan/pricing decision locked
- public entry page / website routing
- smoke test checklist
- launch checklist

---

## Phase 1 — Shared Platform Primitives
Only begin after Phase 0 is stable enough to launch or is launched.

Objective:
Build the shared platform foundation that all future modules will reuse.

Deliverables:
- organization model
- user model
- role/membership model
- subscription and entitlement model
- shared assessment entity
- shared finding entity
- shared recommendation entity
- shared audit event structure
- shared document/evidence structure

Why this matters:
Without this, Vendor Risk, Compliance, and AI Governance will become disconnected apps instead of one platform.

---

## Phase 2 — SaaS Shell
Objective:
Create the authenticated product surface that will eventually host all modules.

Deliverables:
- auth flow
- app shell
- dashboard shell
- settings
- billing
- intelligence surfaces inside app
- live vs mocked state handling

This phase should follow `SECURELOGIC_UI_BRIEF.md`.

---

## Phase 3 — Vendor Risk Module
Objective:
Build the first major operational module.

Why Vendor Risk first:
- closest to current scoring + intelligence strengths
- strongest near-term buyer pain
- easiest bridge from current capability into an enterprise workflow product
- supports powerful natural-language questions early

Deliverables:
- vendor inventory
- vendor profile
- vendor assessment history
- vendor findings
- vendor posture aggregation
- monitoring events
- vendor ranking and risk summaries

---

## Phase 4 — Compliance / Control Intelligence
Objective:
Build control and framework posture capabilities.

Deliverables:
- framework registry
- control library
- control mappings
- gap analysis
- evidence status
- remediation planning
- reports

---

## Phase 5 — AI Governance Module
Objective:
Build AI governance workflows and scoring.

Deliverables:
- AI system inventory
- AI assessments
- governance scoring
- policy mapping
- findings
- remediation plan

---

## Phase 6 — Unified Query Layer
Objective:
Enable cross-domain natural-language risk queries.

Deliverables:
- query surface
- domain routing
- grounded answer generation
- explainable evidence linkage
- action-oriented outputs

---

## Phase 0 Detailed Build Order

Use this exact order unless a dependency forces a change.

1. Inspect current Stripe, billing, and entitlement code paths
2. Confirm exact current brief generation and retrieval architecture
3. Lock plan model and access tiers
4. Complete checkout session path
5. Complete webhook handling
6. Persist and resolve subscription state
7. Finish entitlement checks for brief endpoints/pages
8. Finish latest brief and archive UX
9. Finish locked content and upgrade UX
10. Validate deployment and production env
11. Launch website entry path for the Intelligence Brief
12. Launch

---

## Required Public Website Surface for Phase 0

Before the full marketing site, build the minimum viable public acquisition layer for the Intelligence Brief.

Required pages:
- Home or product landing page
- Intelligence Brief page
- Pricing page
- Login / Get Started
- Upgrade / Subscribe path

The public site for Phase 0 should answer:
- what this product is
- who it is for
- why it matters
- what paid access gets
- how to subscribe

Do not overbuild the marketing site before the product flow works.

---

## Required In-App Surface for Phase 0

Required screens:
- sign in
- latest brief
- brief detail
- archive
- billing / subscription
- basic account/settings
- locked content states

Must support states:
- loading
- empty
- error
- success
- locked
- billing-pending
- no-entitlement

---

## Monetization Path

### Product 1
Intelligence Brief

Purpose:
- first paid service
- first low-touch offer
- monetization unlock
- proof of distribution and entitlement flow

### Product 2
Vendor Risk Monitoring

### Product 3
Compliance / Control Intelligence

### Product 4
AI Governance

### Product 5
Unified Risk Exposure Platform

Revenue sequence:
1. launch and monetize Intelligence Brief
2. add first serious module: Vendor Risk
3. expand into compliance/control intelligence
4. expand into AI governance
5. unify into a single enterprise platform

---

## Working Rules for Claude Code

At the start of any task:
1. read `CLAUDE.md`
2. read `EXECUTION_PLAN.md`
3. read `SECURELOGIC_UI_BRIEF.md` if UI work is involved
4. identify which phase the task belongs to
5. identify whether the task is backend, frontend, billing, entitlement, delivery, or platform-infrastructure work
6. list files to inspect
7. propose the smallest safe implementation plan
8. wait for approval before editing

When implementing:
- keep changes tightly scoped
- favor shared primitives
- do not invent future module logic in Phase 0
- do not treat mocked UI as real backend completion
- do not break the engine-first architecture
- do not commit or push unless explicitly told

---

## What ChatGPT Should Be Used For During Execution

Use ChatGPT to:
- pressure-test Claude's plans
- prioritize the next task
- turn vague goals into concrete milestones
- define page structure and UI priorities
- define pricing and monetization flows
- review whether a proposed implementation matches the platform vision
- break down bugs or architectural drift
- decide when to move from one phase to the next

---

## Phase 0 Exit Criteria

Do not declare Phase 0 complete until all are true:

- Stripe checkout works
- webhook handling updates app state correctly
- subscription state maps to entitlements correctly
- premium content is gated correctly
- latest brief works
- archive works
- upgrade path works
- key errors are handled cleanly
- deployment is stable
- there is a public path for users to discover and subscribe
- the product can be used end-to-end without manual intervention

---

## Immediate Next Sprint

The very next sprint should focus only on:

1. inspect existing billing + entitlement + brief-delivery code
2. identify exact missing pieces for launch
3. finish checkout and webhook plumbing
4. finish archive/latest/detail entitlement behavior
5. finish billing/subscription UI states
6. verify production readiness

Do not start Vendor Risk, Compliance, AI Governance, or the full SaaS shell until this is materially done.
