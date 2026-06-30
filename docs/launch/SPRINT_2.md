# Sprint 2 — First Post-Launch Hardening

> **Status:** QUEUED — not started, **not authorized**. Begins only after Sprint 1 promotes to production.
> **Theme:** Activate the paths that ship inert at launch, fix the few customer-visible inconsistencies, and confirm the production posture of already-shipped systems.
> **Authorization note:** Each item below is a **fresh active-package decision** under `BUILD_SEQUENCE.md`. This document orders and scopes the work; it does not authorize it. Build one package at a time.

---

## Objective

At launch, several systems ship deliberately **inert** (flag-gated or unwired) and a handful of customer-visible labels are known-stale. Sprint 2 turns on the highest-value inert path, removes the visible inconsistencies, and confirms the live production posture of shipped-but-gated systems — without expanding scope.

---

## Work items (priority order)

### 2.1 — Export-delivery email (GDPR PR #4) — **highest-value lever**
**Why:** The GDPR/CCPA export path is shipped and prod-verified, but exports are **inert end-to-end** because no delivery email is sent. A requester gets no link. This is the single change that makes the data-rights feature actually usable.
**Scope:**
- Email the tokenized download link minted by the worker (`data_export_files` row + token already exist).
- Use a **shared `sendEmail()`** — do **not** create a new Resend sender silo (Decision E).
**Done when:** a self-export request results in a delivered email with a working, expiring download link; negative paths (expired token, wrong user) verified.
**Hard rule:** no new Resend sender; reuse the shared sender.

### 2.2 — In-app price-label reconciliation
**Why:** App surfaces carry stale prices that contradict the corrected commercial model (e.g. BriefCard, UpgradeCard, the `/pricing` route). This is **display-label only** — Stripe prices and Price IDs are owned by the operator and must not be touched.
**Scope (DISPLAY LABELS ONLY):**
- Sync in-app price labels to the launch model: Brief Pro $49/mo, Team Professional $199/mo, Platform Professional $800/mo, Platform Professional Annual $7,200/yr.
- Retire or correct any `/pricing` route values that no longer match.
**Done when:** every in-app price label matches the authoritative model in `LAUNCH_MASTER_PLAN.md` §1.
**Hard rules:** do not change any Price ID, checkout routing, or Stripe configuration. Labels only. Operator sets Stripe prices first; this is the follow-on display pass.

### 2.3 — Vendor-assurance production-enablement confirmation
**Why:** The Pillar-1 vendor-assurance extraction worker is shipped and staging-validated behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`, but full **production** enablement (prod flag flip + prod R2 + `ANTHROPIC_API_KEY` placement on the engine web service) is an operator/dashboard action **not provable from the repo**.
**Scope:**
- Confirm (or perform, operator-side) prod flag state, prod R2 wiring, and `ANTHROPIC_API_KEY` placement.
- Record the determination in `KNOWN_ISSUES.md` (currently UNKNOWN-from-repo).
**Done when:** the production state of vendor-assurance is verified and documented (enabled-and-working, or intentionally-off).

### 2.4 — Vendor-surface entitlement gate flip (deferred Step-5)
**Why:** Three vendor-adjacent route files (`vendorAssessments.ts`, `vendorReviews.ts`, `findings.ts`) remain at rank-2 `requireEntitlement("standard")`. UIs redirect rank-2 users, but a direct API-key caller still reaches these APIs at rank-2. Known, deliberate boundary — flip to `premium` to close it.
**Scope:** flip the three routes to the correct premium entitlement; verify negative-path (rank-2 caller → 402/403).
**Done when:** the three routes enforce premium and a rank-2 direct API caller is rejected.
**Dependency:** sequence after 2.3 so the vendor-assurance prod posture is settled first.

### 2.5 — Brand-asset swap
**Why:** Launch uses an **approved interim** icon-only PNG mark. The official brand SVG + favicons are a post-launch cosmetic swap, explicitly **not** a launch blocker.
**Scope:** replace interim PNG with official brand SVG lockup + favicons across website/app; review old engine/app lockups separately.
**Done when:** official brand assets are live and the interim PNG is removed.
**Hard rule:** cosmetic only — no IA, copy, or layout changes bundled in.

---

## Ask SecureLogic & Voice reliability (operator-directed addendum)

> Added after the original 2.1–2.5 scope at operator direction. This workstream hardens the existing **Ask SecureLogic** assistant (`/ask`) and its voice input ahead of launch. It is **product-knowledge + UX reliability only** — it touches no billing, Stripe, checkout, pricing, migrations, `render.yaml`, feature flags, `main`, or production. Items land as two scoped PRs to `develop`: voice reliability (A-2, PR #418) first, then Ask product-knowledge (A-1, PR #419).

### A-1 — Ask product-knowledge (so Ask can answer "How do I add a vendor?")
**Problem:** Ask was a data-only assistant — its prompt answered strictly from the org's live posture snapshot (8 DB queries) and had **no** product documentation, route metadata, feature metadata, or workflow guidance. Platform how-to questions ("How do I add a vendor?", "Where's my Intelligence Brief?") returned "no data available" because the prompt forbids inventing facts not in the context.
**Fix (shipped):** added a curated, static **product-knowledge source** (`src/api/lib/productKnowledge.ts`) grounded in the real UI navigation and engine routes, injected into the Ask system prompt, plus guardrails that (a) answer product/how-to questions from product knowledge first, (b) forbid claiming "no access" when the product-knowledge answer exists, and (c) re-scope the no-invented-data rule to organization data only — while still grounding *data* questions in the org context.
**Done when:** Ask answers core platform how-to questions accurately; tests assert the knowledge content and prompt assembly. Verified on staging.

### A-2 — Voice input reliability on iPad
**Problem:** voice transcription fails on iPad/iOS (WebKit MediaRecorder limits + unvalidated Whisper path).
**Fix (shipped):** capability + iPadOS detection (`app/src/app/ask/voiceSupport.ts`) that hides the mic button on unsupported browsers and shows "Voice input is not yet supported on this browser. Please type your question instead." See `KNOWN_ISSUES.md` D-10.
**Done when:** voice is offered only where reliable; iPad shows the clear fallback; text Ask unaffected everywhere. Verified on staging.

---

## Out of scope for Sprint 2 (→ Sprint 3)

- A04-G1 `app_request` RLS flip (cross-cutting infrastructure, high blast radius).
- GDPR deletion reaper (Art. 17 erasure — destructive, heavy Phase-0).
- Priority-4 signal-ingestion hardening 4B/4C/4D (source qualification, clustering, provenance).
- Rate-limiter Redis migration, cross-region worker re-provisioning, demo-environment promotion.

---

## Definition of done (Sprint 2)

- 2.1 shipped and prod-verified (the data-rights feature is now usable end-to-end).
- 2.2 in-app labels match the authoritative model.
- 2.3 vendor-assurance production posture documented.
- 2.4 vendor route gate boundary closed (or explicitly re-deferred with rationale).
- 2.5 official brand assets live.
- `KNOWN_ISSUES.md` updated to reflect every closed item.
