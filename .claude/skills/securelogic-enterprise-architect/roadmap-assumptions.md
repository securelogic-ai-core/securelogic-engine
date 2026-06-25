# Roadmap & Assumptions

This file orients you to the build sequence, what is genuinely done, what is deferred, and
what you must NOT build yet. The **authoritative** source is `BUILD_SEQUENCE.md` (and the
governing docs); this is a navigational summary. Where they differ, the governing docs win
— and `BUILD_SEQUENCE.md` can change the active package at any time, so **re-read it before
acting**, don't trust this summary's "active package" line on its own.

> ⚠️ **Assumptions in this file are clearly separated from facts.** Facts are grounded in
> the repo. Anything labeled *assumption* / *inferred* is my reading, not confirmed truth —
> verify before relying on it.

---

## 1. Strategic phase (fact, from `BUILD_SEQUENCE.md`)

> "Product hardening from strong foundations into enterprise-ready intelligence operations."

The foundation is treated as materially built: core domain primitives, the workflow layer
(vendor / AI governance / obligation / dependency / risk treatment), core read surfaces,
and a basic brief path. The next work prioritizes **signal quality, tenant isolation,
product coherence, and enterprise operating readiness** — not new feature breadth.

## 2. The fixed build priority order (fact)

`BUILD_SEQUENCE.md` priorities, in order (do not reorder without changing that doc):

1. **docs-product-alignment** — governing docs into one coherent truth.
2. **tenant-isolation-standard** — defined; enforcement is the follow-on
   (`tenant-isolation-enforcement`, driven by R1–R11).
3. **external-signal-architecture** — design the target signal model.
4. **signal-ingestion-hardening** — source breadth/quality, dedup, normalization.
5. **signal-to-platform-linkage** — resolve signals to vendors/AI/obligations/risks.
6. **brief-premiumization** — analyst-grade brief; clear free-vs-paid differentiation.
7. **platform-context-surfaces** — make "intelligence → action → evidence → posture"
   visible.
8. **customer-distribution-and-isolation** — SaaS isolation + enterprise deployment story.
9. **securelogic-internal-controls** — SecureLogic AI's own auditable control environment.

A04-G1 (Postgres RLS rollout) runs as **in-flight infrastructure in parallel**, sequenced
by its own rollout plan — it is *not* in the one-at-a-time package queue.

## 3. Active package (fact at time of writing — RE-VERIFY)

`BUILD_SEQUENCE.md` names **`pillar1-vendor-assurance-worker`** as the active package: a
durable extraction worker for SOC reports, replacing the in-process `setImmediate` runner.
The doc authorizes **§E Part 1 (steps 1–7) only — staging-validated, zero prod changes**,
and explicitly fences off Part 2 (prod enablement) and the other Pillar-1 tasks.

> This will move over time. The MEMORY index and recent commits suggest later work has
> landed (vendor-assurance worker shipped + prod-flipped; GDPR data-rights; seat/entity
> metering; matcher→action bridge). **Always re-read `BUILD_SEQUENCE.md` for the current
> active package before starting work** — do not assume this paragraph is current.

## 4. What is genuinely DONE vs PARTIAL (from `CURRENT_STATE_ARCHITECTURE.md`)

**Materially real (fact):**
- The domain model and workflow layer (vendors, AI systems, obligations, controls,
  evidence, risks, dependencies, findings, actions, posture).
- Customer auth + JWT bridge in production; the request-time tenant model.
- The scoring engine (V2) powering posture/assessments/reports.
- A brief pipeline richer than a generic digest.
- An active test suite incl. the cross-org isolation harness.
- GDPR data-subject **export** path + self-export UI (shipped, prod-verified per
  `BUILD_SEQUENCE.md`).

**Honestly partial / weak (fact, per the doc):**
- **External signal ingestion** is the weakest layer relative to the vision — broader
  sources, stronger dedup, source qualification, richer normalization, better linkage all
  still needed.
- Some read surfaces are **ahead of the signal depth** beneath them.
- **Tenant isolation** is route-by-route discipline; RLS is inert pre-flip — hardening is
  mandatory ongoing work.
- UI completeness and product-hierarchy clarity across all modules.
- Enterprise operating controls for SecureLogic AI itself.

## 5. What is DEFERRED — do NOT build without a fresh active-package decision (fact)

- **GDPR umbrella tails:** export-delivery email (PR #4), the deletion **reaper** (Art. 17,
  heavy/destructive, Phase-0 locks settled but gated), `org_full` intake + admin-authz
  cluster, export-file purge. All candidates, **none authorized**.
- **Tenant-isolation-enforcement** (R1–R11 sweep, PR-time SQL-scope lint, LLM
  prompt-batching audit, the 26-route classification) — recommended next, not yet a package.
- **A04-G1 remaining:** more per-table RLS batches, then the `DATABASE_URL → app_request`
  **flip** (phase-3) and the staging flip. High blast radius; its own sequence.
- **Pillar-1 later tasks:** concentration risk, nth-party cascade, inherent/residual split
  — separate later packages.
- **Entitlement vocabulary consolidation** (R4) and per-API-key role scoping (R9) — separate
  packages touching Stripe/schema.
- **Region re-provision** of the two Oregon prod workers to Virginia — deferred (region
  immutable post-provision).

## 6. Known divergences / debts (fact — flagged, mostly deliberately deferred)

- **In-app price label drift:** `app/src/components/UpgradeCard.tsx` and
  `app/src/app/pricing/page.tsx` disagree with `website/src/lib/pricing.ts`. This is a
  parked *display-label* task behind a Stripe-price decision — **do not touch price IDs or
  labels** without explicit authorization (the plan is: operator sets Stripe prices, then
  one pass fixes labels only). The app landing `/` already redirects logged-out → `/login`.
- **Cross-region workers:** prod `posture-worker` + `data-rights-worker` run in Oregon but
  reach the Virginia DB. Known, deferred.
- **Three-vocabulary entitlement collision (R4):** easy to gate at the wrong tier — always
  cite §9.
- **Frontend version drift:** app on React 18, website on React 19 (separate trees).
- **Audit-log coverage uneven (R7); per-org upload quotas absent (R11); JWT actor
  attribution loss with multiple keys (R3).**

## 7. Anti-drift rules (fact, from `BUILD_SEQUENCE.md` / `CLAUDE.md`)

Do not: pick the next package because it's easy; build UI polish ahead of missing
architecture; build read surfaces that outrun weak data; confuse the Brief with the
platform; let docs go stale after package work; broaden scope; or commit without explicit
authorization. If the current path is wrong, say so and propose the correct sequence —
don't just continue the last visible feature.

## 8. My standing-assignment reminder (from `CLAUDE.md` §14)

Default posture: audit what exists → identify architectural gaps → identify sequencing
mistakes → preserve what's reusable → recommend the next correct build order → keep the
platform being built as a holistic cyber/GRC posture platform with the Brief as one premium
service, not the core. If "finish the current feature" conflicts with "build the platform
correctly," prioritize building it correctly.
