# SecureLogic AI — Launch Master Plan

> **Status:** Pre-launch hold (NO-GO). `develop` is staged and ahead of production `main`; promotion is gated on operator-only release gates (see `SPRINT_1.md`).
> **Owner:** SecureLogic AI platform/operator.
> **Last reconciled:** 2026-06-30 (`develop` tip `b221c0c8`, production `main` `959951b9`).

This is the controlling launch document. It defines what "launch" means for SecureLogic AI, what is already shipped, what blocks production go-live, and the sprint sequence that gets us there safely. It is grounded only in verified repository and governing-doc state — not aspiration.

It does **not** replace the governing documents. It sits beneath them. If this plan ever conflicts with `PRODUCT_VISION.md`, `CURRENT_STATE_ARCHITECTURE.md`, `CANONICAL_DOMAIN_MODEL.md`, `TENANT_ISOLATION_STANDARD.md`, `BUILD_SEQUENCE.md`, or `FINAL_PRODUCT_STANDARD.md`, the governing document wins and this plan must be corrected.

---

## 1. What we are launching

SecureLogic AI is a holistic cyber / GRC / AI-governance / third-party-risk posture platform. The **Platform is the product**; the **Intelligence Brief is the wedge**.

The launch is **not** a new build. It is the **promotion of already-built, staging-validated work from `develop` to production `main`** — a controlled production release of work that has accumulated and been validated on staging.

### Commercial model at launch (authoritative)

| External (UI / marketing) | Internal key | Billing |
|---|---|---|
| Intelligence Brief — Free | `free` | none |
| Brief Pro | `professional` | $49 / mo |
| Team Professional | `teams` | $199 / mo |
| Platform Professional | `platform` | $800 / mo (Billing-Portal only, no primary CTA) |
| Platform Professional — Annual | `platform_annual` | $7,200 / yr |
| Enterprise | (no Stripe key — custom contract) | custom |

`Platform Annual` is the **annual billing option** for Platform Professional, **not** a separate tier. Internal keys predate the current naming and are frozen to avoid Stripe price-ID migration risk (`CURRENT_STATE_ARCHITECTURE.md` §Internal vs. external tier vocabulary).

---

## 2. Definition of launch (Go criteria)

Launch = **production go-live of the staged `develop` release onto `main`**, achieved when **all** of the following hold:

1. **All 5 operator release gates pass** (Stripe portal config, Stripe checkout amounts, portal upgrade/downgrade transitions, migration validation, prod pre-flight). See `SPRINT_1.md`.
2. **All 6 staged migrations are validated on staging** and confirmed safe on prod (filename-key skip risk cleared — `BUILD_SEQUENCE.md` gate F-1).
3. **All 7 CI lanes green** on the promotion head: `typecheck`, `lint`, `test`, `build`, `cross-org-isolation`, `tenant-coverage`, `audit`.
4. **Phase-4 signal flags confirmed OFF in production env** (`SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE`) — the whole Phase-4 B/C/D batch ships inert.
5. **Promotion executed as a true merge** (`gh pr merge --merge`, never squash) so `origin/develop..origin/main` returns 0 and the back-merge invariant holds.
6. **Post-deploy verification** passes on both production services (`/version` returns the promoted commit on engine + app).

Until all six hold, the state is **NO-GO** and no promotion PR is opened.

---

## 3. What is already shipped and validated

These are **verified** as present on `develop`/staging (and, where noted, already on production `main`). This is the substance the launch delivers.

### Platform domain & workflows (materially real)
- Canonical domain objects: vendors, AI systems, obligations, controls, evidence, risks, dependencies, findings, actions/linkages, posture snapshots.
- Workflows: vendor review, AI governance review, obligation compliance review, dependency review, risk treatment, evidence linkage.
- Read surfaces: dashboard summary, compliance posture summary, risk intelligence surface, Intelligence Brief web views.

### Intelligence pipeline
- Signal lifecycle: raw source item → normalized signal → stored insight → LLM enhancement → final brief item → rendered brief.
- Ingestion: **6 RSS-registry feeds + 7 direct-source adapters** (CISA KEV, NVD, SEC EDGAR, Federal Register, CISA Alerts, MITRE ATT&CK, MITRE ATLAS).
- Matcher (three invocation paths) + risk→action worker reachability (GAP-3, on `main`).
- Single weekly Intelligence Brief; legacy daily digest disabled.

### Identity, tenancy, billing
- Email/password customer auth + JWT bridge (engine ↔ app); SAML SSO + TOTP MFA.
- Request-time tenant model (`requireApiKey → attachOrganizationContext → requireEntitlement`); route-level `organization_id` scoping is the live tenant defense.
- Postgres RLS rolled out on ~22 tables but **INERT pre-flip** (owner cred, NOT FORCE) — defense-in-depth, not yet the live boundary (A04-G1, in-flight infrastructure).
- Stripe billing (subscriptions, webhooks, customer portal); canonical checkout plan-token namespace fixed (#399).

### Compliance / data rights
- GDPR/CCPA **export path complete and prod-verified** (Art. 15): self-export intake + delivery + UI, org_full export, R2 attachment streaming. Inert end-to-end only where the delivery email sender is absent (deferred — PR #4).
- Vendor-assurance durable extraction worker shipped (Pillar 1), staging-gated behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`.

### Marketing surface
- Enterprise marketing website rebuilt on shared assets (Phase 1 + Phase 2A); `/platform` module-availability + corrected pricing; app logged-out root → `/login`. Website-only commits, no app/engine/billing logic.

---

## 4. Sprint sequence

| Sprint | Theme | Scope | Status |
|---|---|---|---|
| **Sprint 1** | **Production go-live** | ONLY the launch-blocking promotion gates. Nothing else. | **Active — NO-GO** |
| **Sprint 2** | First post-launch hardening | Activate inert paths (export-delivery email), reconcile in-app price labels, confirm vendor-assurance prod enablement, brand-asset swap. | Queued |
| **Sprint 3** | Enterprise depth | A04-G1 `app_request` RLS flip, GDPR deletion reaper, Priority-4 signal-ingestion completion (4B/4C/4D), operational hardening. | Queued |

Sprints are sequential. **Sprint 1 must complete a production promotion before Sprint 2 begins.** Sprint 2 and Sprint 3 items are **not authorized** by this plan — each remains a fresh active-package decision under `BUILD_SEQUENCE.md`.

---

## 5. Environments & release flow

- **Production** (`main`) — live clients, real data, revenue.
- **Staging** (`develop`) — pre-production validation; must mirror prod closely enough for real validation. All prod-bound work validates here first.
- **Demo** — seeded showcase org (`scripts/seed-demo.ts`), a logical surface, **not** a deployed peer environment and **not** a substitute for staging. No real client data.

**Hard release rules** (from governing docs):
- Staging is for validation. Demo is for presentation. Production is for clients.
- Every prod-bound change is validated on staging first.
- Promotion `develop → main` uses a **true merge**, never squash (branch-sync invariant — squash makes `develop` HEAD a non-ancestor and re-surfaces the whole changeset).
- No production release decision is made on Demo behavior.

---

## 6. Ownership model — operator vs. automated session

The launch gates are **operator-only**. A Claude/automated session **cannot** execute them — they require Render dashboard, Stripe dashboard, staging UI, and production DB credentials.

| Responsibility | Operator | Automated session (Claude) |
|---|---|---|
| Stripe portal/price config | ✅ | ❌ |
| Render env vars & redeploys | ✅ | ❌ |
| Production DB migration validation / pre-flight | ✅ | ❌ |
| Staging UI checkout/portal walk-throughs | ✅ | ❌ |
| Static evidence (CI, code routing, SQL review, render.yaml diff) | — | ✅ |
| Branch-sync verification, promotion PR authoring | — | ✅ (PR only — no merge without authorization) |

The automated session's job is to **keep the static evidence green and the promotion mechanically ready**, then hand the operator an exact, runnable gate checklist. It does not merge or promote without explicit authorization.

---

## 7. Risk posture at launch

- **Largest blast radius:** the 6 staged migrations + the canonical billing-token change. Both have static evidence PASS; both still require operator validation on staging before prod.
- **Inert-by-design:** the entire Phase-4 B/C/D signal batch and the GDPR deletion reaper are flag-gated OFF — they ship dark and change no production behavior.
- **Known live limitation:** RLS is inert pre-flip; route-level scoping remains the only live tenant defense. This is acceptable for launch (it is the current production posture) but is tracked in `KNOWN_ISSUES.md` and scheduled for Sprint 3.
- **Rollback:** production `main` is a known-good commit (`959951b9`); promotion is a single merge that can be reverted. Migrations are additive/guarded (see F-1).

Full catalogue: `KNOWN_ISSUES.md`. Step-by-step promotion procedure: `RELEASE_CHECKLIST.md`.

---

## 8. Document map

- `LAUNCH_MASTER_PLAN.md` — this file: what launch is, what's shipped, the sprint sequence.
- `SPRINT_1.md` — the only launch-blocking work (production go-live gates).
- `SPRINT_2.md` — first post-launch hardening (queued, unauthorized).
- `SPRINT_3.md` — enterprise depth (queued, unauthorized).
- `RELEASE_CHECKLIST.md` — reusable `develop → main` promotion procedure.
- `KNOWN_ISSUES.md` — verified limitations, debt, and inert paths at launch.
