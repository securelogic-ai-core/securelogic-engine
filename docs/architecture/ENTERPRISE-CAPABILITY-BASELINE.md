# SecureLogic Enterprise Capability Baseline — 95/95 Program

**Produced:** 2026-08-21. **Audit only.** Nothing was built, no migration was
created, no flag was changed, nothing was merged or promoted, production was not
touched, and the frozen release candidate `65cd3330` is unchanged.

**Method.** Every claim below was checked against the repository at
`develop@65cd3330` — schema read from `db/migrations`, behaviour read from
`src/api`, reachability read from `app/src/app`, deployment state read from
`render.yaml`. Where evidence was insufficient the entry says **UNSCORABLE**
rather than carrying a manufactured number.

**Two independent axes**, neither compensating for the other:

- **Capability Sufficiency (CS)** — did we build the *right* enterprise
  capabilities? Feature set, workflows, data model, relationships,
  configurability, integrations, governance mechanisms.
- **Execution Readiness (ER)** — do they *operate* at enterprise quality?
  End-to-end workflow, security, isolation, observability, supportability,
  auditability, recovery, reporting, staging evidence.

**Target: ≥95 CS AND ≥95 ER for anything advertised as complete.**

> **A note on the scores.** These are **not** the same axes as
> `SEPT15-LAUNCH-RECONCILIATION.md` §3 (62% workflow completeness / 44%
> enterprise readiness). That matrix asked "does the workflow run"; this asks
> "is the capability *sufficient*" and "does it operate at enterprise quality".
> Similar neighbourhoods, different questions. Do not average them together.

---

## A. Executive verdict

**SecureLogic is a well-architected platform with a real domain model, genuine
tenant isolation, and an unusually honest engineering record — that has not yet
delivered a single complete enterprise workflow to a customer.**

Three findings carry the verdict:

1. **The gap is delivery, not construction.** Every capability built since
   2026-08-17 sits on `develop`. Nothing reached `main`. Production has no
   support runbooks, no security batch, and none of the new verticals. The
   single largest available capability gain is a deploy, not a feature.
2. **The advertised verticals are the weakest, and the foundations are the
   strongest.** Governance Core scores highest; Vendor Assurance, Vulnerability
   Management, Pen-Test and AI Governance — the four things a buyer would
   actually evaluate — score lowest. That is exactly the wrong shape, and it is
   invisible in an aggregate score.
3. **Two verticals have a data-model ceiling, not a build backlog.** AI
   Governance cannot represent the framework→control→evidence chain at all.
   Vulnerability Management is architecturally strong but operates over an empty
   asset estate. Neither is fixed by finishing a UI.

**Verdict: NOT enterprise-ready to advertise four of its five verticals.
Foundationally sound enough that the remaining work is completion, not rescue.**

## B. Overall Capability Sufficiency — **62 / 100**

Basis: unweighted mean of the six pillar scores in §D. Governance Core and
Platform are genuinely strong; Operations and AI Governance are near-absent as
*capabilities*, not merely unfinished.

## C. Overall Execution Readiness — **37 / 100**

Basis: unweighted mean of the six pillar scores in §D. Depressed by one dominant
fact rather than many small ones: **nothing is in production**. Isolation and
CI evidence are strong (1,476 isolation assertions across 169 files, green on
every head this session), but harness evidence does not move this axis.

**The 25-point CS→ER spread is the headline.** It is not distributed evenly — it
concentrates in the advertised verticals, which is the dangerous shape.

## D. Six-pillar scorecard

| Pillar | CS | ER | Basis |
|---|---|---|---|
| **I — Governance Core** | **82** | **48** | Findings/risk/SLA/exception/approval/history all present and coherently modelled; recurrence semantics formally ruled (ADR-0009). ER: entirely flag-dark or unreached in production; no MTTR or SLA-attainment metric exists |
| **II — Enterprise Verticals** | **58** | **25** | Mean of the four verticals in §E. Vulnerability's model is genuinely good; AI Governance and Pen-Test are thin; Vendor Assurance is blocked |
| **III — Governance Infrastructure** | **60** | **40** | Controls/frameworks/requirements/obligations real. **Evidence has no lifecycle** and **policies have no version history, approval workflow or attestation** — both enterprise table stakes |
| **IV — Enterprise Platform** | **70** | **55** | Auth, entitlement, RLS, tenant isolation, API keys, billing all real and exercised. SAML present; **SCIM absent**; seat model and webhooks built dark |
| **V — SecureLogic Operations** | **20** | **25** | Two ops surfaces exist and **neither carries a tenant dimension**, so neither can answer the founding question. Recorded as OPS-1 |
| **VI — Security & Resilience** | **65** | **45** | Strong isolation proof and a clean admin-chain audit (no P0). **No SAST, no secret scanning, no DAST**; DR plan documented but **restore never executed**; no branch protection |

## E. Domain-by-domain scorecard

| Domain | CS | ER | Decisive evidence |
|---|---|---|---|
| **Findings & Remediation** | 88 | 50 | Full lifecycle, severity, policy-driven SLA, closure gate with SoD, `finding_lifecycle_events` history, exceptions distinct from acceptances (SL-EXC-1). Dark/unreached in prod |
| **Risk Register** | 80 | 45 | Inherent/residual, lifecycle states, treatments, approvals, `finding_risks` M2M. Risk **appetite/tolerance** not explicitly modelled |
| **Exceptions / Acceptance** | 85 | 40 | WORM record, frozen `sla_due_date_at_request`, SoD by distinct `user_id`, one-live-per-kind. Flag-dark in prod (default-deny verified) |
| **Vendor Assurance / TPRM** | 70 | **20** | Two independent evidence spines (**ADR-0010**); no engagement↔document link; Finding shows **no** provenance back to CUEC; extraction fails on clean SOC 2; **zero findings ever produced**; prod has the flag ON and the surface live (401) but nav-orphaned. *(R2 correction — see §Corrections)* |
| **Vulnerability Management** | 80 | **28** | Genuinely strong model — occurrence identity `(org, finding, asset)`, declared scan **scope** as the authority for absence, per-source observation ledger, recurrence≠reopen. Undermined by **PLAT-ASSET-1**: the asset estate is effectively empty, and **no scanner ingestion connector exists** |
| **Pen-Test Management** | 45 | 20 | `pen_test_engagements` + `source_severity`/`cvss_*` on findings. **No scope, methodology, retest or evidence model**; API-only, no UI (PEN-1) |
| **AI Governance** | **40** | 25 | See §F.1. `ai_systems` is 8 mostly-free-text columns; **no AI-system→control, →framework, →requirement, →policy or →obligation relationship exists**; `ai_governance_assessments.reviewer_id` is `TEXT`, not a user FK |
| **Controls & Frameworks** | 72 | 45 | `controls`, `control_mappings`, `control_assessments`, `frameworks`, `requirements`, crosswalks present. Control **effectiveness** and deficiency tracking thin |
| **Policies** | 40 | 30 | Single `policies` table. **No version history** (`version` is a column, prior versions are lost), **no approval workflow**, **no attestation/acknowledgement**, **no applicability scoping** |
| **Evidence** | 45 | 35 | `evidence` + `evidence_analysis`. **No expiry/validity date, no renewal, no reuse across controls** — pinned to one `(source_type, source_id)`; `collected_by` is `TEXT` |
| **Intelligence** | 78 | 50 | Signals, dedup, provenance, matcher, brief synthesis all real and long-exercised |
| **Decision Workspace** | 70 | 30 | Built; flag-dark in production |
| **Executive Reporting** | 60 | 35 | REPORT-1 built, flag-dark. **No MTTR, no SLA attainment**; `overdue`/`age_days` exist |
| **Platform / Auth / Tenancy** | 78 | 60 | RLS + `asTenant`/`withTenant`, 1,476 isolation assertions, entitlements, seat model (dark), SAML. **SCIM: 0 files** |
| **Billing / Commercial** | 82 | 55 | Dunning, ordering watermark, grace (off), resubscribe path. Never exercised in prod |
| **Support / IR** | 70 | **15** | 30 runbooks + IR program exist **only on `develop`**. Production has **none** |
| **Operations (OPS-1)** | 20 | 25 | `/admin/ops/health` + `/admin/ops/overview` exist, both newsletter/email/worker-centric, **no tenant dimension** |
| **Release / Recovery** | 55 | 40 | Rehearsed rollback (bit-identical, 4 scenarios). **DR restore never executed**; no branch protection; `autoDeploy:true` on all six prod services defeats deploy ordering |

**UNSCORABLE — evidence insufficient:** customer-facing API surface quality
(no external API consumer has exercised it); integration/connector health at
scale (18 connectors exist, none proven against a live third party in this
audit's evidence).

## F. Enterprise table-stakes gaps

Classified per §10 of the program. Conservative about ADVANCED/FUTURE.

### F.1 AI Governance — the most serious sufficiency gap

`ai_systems` carries: `name`, `use_case`, `owner_user_id`, `model_type`,
`data_classification`, `deployment_status`, `criticality`, `risk_classification`
— all free text except `criticality`.

| Expected capability | State | Class |
|---|---|---|
| Business owner **and** technical owner | **MISSING** — one `owner_user_id` | FOUNDATIONAL |
| Model **provider** (vendor of the model) | **MISSING** — `model_type` is free text | FOUNDATIONAL |
| Sensitive-data considerations | **MISSING** | FOUNDATIONAL |
| Risk classification vocabulary (EU AI Act tier, NIST AI RMF) | **MISSING** — free text, no CHECK | FOUNDATIONAL |
| AI system → **applicable framework / requirement** | **MISSING — no join table exists** | FOUNDATIONAL |
| AI system → **control** | **MISSING** | FOUNDATIONAL |
| AI system → **policy / obligation** | **MISSING** | ENTERPRISE EXPECTED |
| **Material change** detection / versioning | **MISSING** | FOUNDATIONAL |
| Reassessment cadence | **MISSING** | ENTERPRISE EXPECTED |
| Assessment reviewer identity | **PARTIAL** — `reviewer_id TEXT`, not a FK | ENTERPRISE EXPECTED |
| AI system → vendor dependency | **BUILT** (`ai_system_vendor_dependencies`) | — |
| AI → findings / remediation / exception / risk | **BUILT** via generic primitives | — |

> **The chain the program asks for — *AI system → applicable policy/regulation/
> framework → controls → evidence* — cannot be represented in the current
> schema at all.** This is a data-model ceiling, not a UI backlog. An
> AI-governance product that cannot say which framework applies to which AI
> system is not an AI-governance product.

### F.2 Governance infrastructure

| Gap | Class |
|---|---|
| **Evidence has no validity period, expiry or renewal** — SOC 2 evidence is period-bound; an enterprise buyer will ask | FOUNDATIONAL |
| **Evidence cannot be reused** across controls/assessments — pinned to one `(source_type, source_id)` | ENTERPRISE EXPECTED |
| **Policy version history absent** — `version` is a column; prior versions are overwritten | FOUNDATIONAL |
| **Policy approval workflow absent** | ENTERPRISE EXPECTED |
| **Attestation / acknowledgement campaigns absent** — zero tables | ENTERPRISE EXPECTED |
| Control **effectiveness** and deficiency tracking thin | ENTERPRISE EXPECTED |
| **MTTR and SLA-attainment metrics absent** — zero references | ENTERPRISE EXPECTED |

### F.3 Platform

| Gap | Class |
|---|---|
| **SCIM provisioning/deprovisioning absent** (0 files) — enterprises expect directory-driven lifecycle | ENTERPRISE EXPECTED |
| OIDC thin relative to SAML (2 files vs 10) | ENTERPRISE EXPECTED |
| Seat model / RBAC built but **dark**; no operator role separation | ENTERPRISE EXPECTED |
| Outbound webhooks built but **dark** | ENTERPRISE EXPECTED |

### F.4 Security & resilience

| Gap | Class |
|---|---|
| **No SAST** (CodeQL/Semgrep) in CI | ENTERPRISE EXPECTED |
| **No secret scanning** (gitleaks/trufflehog) in CI | FOUNDATIONAL |
| **No DAST / API security testing** (ZAP, Burp) readiness | ENTERPRISE EXPECTED |
| **DR restore never executed** — `DR_PLAN.md` marks RTO/RPO "proposed — ratify before quoting to customers" and §6 restore test unrun | FOUNDATIONAL |
| **No branch protection** on `main` or `develop`; direct pushes possible | FOUNDATIONAL |
| **ADMIN-AUDIT-1** — 1 of 32 admin route modules writes a durable audit row | ENTERPRISE EXPECTED |
| **ADMIN-ACCESS-2** — no administrator identity (shared static key) | ENTERPRISE EXPECTED |

The dependency-audit gate **is** present and real (`scripts/ci/auditGate.mjs`,
per-GHSA expiring waivers). It is the only security scanner in CI.

## G. Differentiation opportunities

The architecture already holds the primitives for something competitors cannot
easily assemble: **external intelligence joined to the customer's own posture.**

`cyber_signals` → matcher → `signal_match_suggestions` → vendors / AI systems /
controls, with dedup, provenance and source qualification, is genuinely
differentiated infrastructure that already runs.

| Opportunity | Can the architecture support it today? |
|---|---|
| **"What changed, why it matters, which of *your* risks are affected"** — signal → matched vendor/AI system/control → affected findings/risks | **Yes, partially.** The signal→entity links exist; the entity→risk rollup does not |
| **Vendor CUEC gaps as portfolio risk** — "these 14 vendors all require MFA you don't enforce" | **No.** Requires VA-3 to work first; CUEC→control mapping exists, the aggregate does not |
| **AI + vendor concentration** — "your three highest-risk AI systems all depend on one provider" | **No.** `ai_system_vendor_dependencies` exists; concentration analytics do not |
| **Evidence-backed executive narrative** — every claim traceable to a finding, control test or signal | **Partially** — blocked by the evidence-lifecycle and Finding-provenance gaps |

**The honest read:** differentiation is one or two joins away from being real,
but every one of those joins currently terminates in a vertical that is blocked,
dark or unproven. **Differentiation is downstream of completion, not parallel to
it.** Nothing here should be built speculatively now.

## H. Architectural convergence findings

The target model — `Organization → Assets/Vendors/AI Systems → Controls/Policies
→ Evidence → Assessments → Findings → Remediation/Exceptions → Risks → Decisions
→ Reporting` — is **substantially real** for the Findings/Risk half and
**broken in three specific places**:

1. **`AI Systems → Controls/Policies` does not exist.** No join table in either
   direction (§F.1).
2. **`Evidence` is a leaf, not a shared node.** Pinned to one
   `(source_type, source_id)`, so it cannot be the reusable substrate the model
   requires.
3. **`Vendors → Evidence` forks into two spines** that never meet (ADR-0010).

Everything else converges correctly, and notably well: `findings` is a genuine
shared primitive with **17 source types**, and `finding_risks`, SLA policy and
the exception model all hang off it rather than being re-implemented per
vertical. That is the platform-first discipline working.

## I. Duplicate / parallel systems

| # | Parallel systems | Status |
|---|---|---|
| 1 | **Vendor Engagements spine vs Vendor Assurance document spine** — separate tables, storage helpers, workers, analysis tables and finding source types; share only `vendors.id` | **ADR-0010 OPEN, due 2026-08-28. Not resolved here** |
| 2 | **Two evidence stores** — `evidence` (+`engagement_id`) vs `vendor_assurance_documents` | Same decision as #1 |
| 3 | **Two ops surfaces** — `/admin/ops/health` and `/admin/ops/overview`, overlapping content, neither tenant-aware | Converge under OPS-1; do not add a third |
| 4 | **Legacy `assessments` alongside typed assessment tables** | Freeze blocked by live writers (previously recorded) |

**No refactor is proposed in this task**, per instruction.

## J. Dark capabilities — built, flag-off in production

Decision Workspace · Risk Workspace · findings queue controls · REPORT-1
executive risk view · asset registry · Enterprise Context · dashboard briefing ·
risk exceptions (default-deny verified) · billing grace period · Wave 4 Brief
scheduler and LLM control matcher · seat model / RBAC · outbound webhooks
(WEBHOOK_WAVE1) · **admin network enforcement (ADMIN-NET-1 — deliberately, by
ruling, ADR-0011)**.

## K. Unproven capabilities — built, never exercised as a product

| Capability | Why unproven |
|---|---|
| **Vendor Assurance document path** | **Zero findings ever produced, in any environment** |
| Vulnerability occurrences / scan scope | No populated asset estate; no scanner ingestion |
| Pen-test intake | API-only; no UI; no finding ever created |
| Dunning / grace / resubscribe | No production traffic |
| Support runbooks | Not in production |
| **DR restore** | Documented, never executed |
| Seat model | Activation-ready, never activated |
| Webhooks | Dark since build |

## L. Gap register

**P0 — launch / release integrity**

| ID | Gap | Evidence | Size |
|---|---|---|---|
| **P0-1** | Production is running without every security fix since #799 | 8 commits absent from `main`; 65 Dependabot advisories on default branch | S (the promotion) |
| **P0-2** | Production has **no support runbooks** and no IR program | All 30 files exist only on `develop` | S (the promotion) |
| **P0-3** | ~~Vendor Assurance flag-ON in production with no R2~~ → **WITHDRAWN.** Production R2 **is** configured; see §Corrections. Residual item is a launch-posture decision, not a defect | Live service read, 2026-08-22 | XS (operator decision) |
| **P0-4** | #826 Tier 2 gate open | Window 2026-08-25T07:00Z | S (observation) |
| **P0-5** | Prod DSN repoint / `DATABASE_SSL_SERVERNAME` (R-3) | #799 makes verification mandatory | XS (operator) |

**P1 — required to reach 95/95 for an advertised capability**

| ID | Gap | Domain | Size |
|---|---|---|---|
| **P1-1** | Clean SOC 2 fails extraction | Vendor Assurance | XS (PR #855 exists) |
| **P1-2** | Finding shows **no provenance** back to vendor/document/CUEC/reviewer | Vendor Assurance | S (ADR-0010 Option 4) |
| **P1-3** | ADR-0010 engagement↔document convergence undecided | Vendor Assurance | XS to decide |
| **P1-4** | **Asset estate empty** — PLAT-ASSET-1 | Vulnerability | XS decide / L build |
| **P1-5** | **No scanner ingestion connector** | Vulnerability | M |
| **P1-6** | **AI system → framework/control/policy relationships absent** | AI Governance | M |
| **P1-7** | AI inventory lacks business/technical owner, provider, sensitive-data, risk vocabulary | AI Governance | S |
| **P1-8** | AI **material change / reassessment** absent | AI Governance | M |
| **P1-9** | **Evidence has no validity/expiry/reuse** | Governance infra | M |
| **P1-10** | **Policy versions, approvals, attestations absent** | Governance infra | M |
| **P1-11** | Pen-test scope/methodology/retest model absent; no UI | Pen-Test | M |
| **P1-12** | **No MTTR / SLA-attainment metrics** | Reporting | S |
| **P1-13** | **ADMIN-AUDIT-1** — admin actions not durably audited | Security | S–M |
| **P1-14** | **No secret scanning in CI** | Security | XS |
| **P1-15** | **DR restore never executed** | Resilience | S |
| **P1-16** | **No branch protection**; direct pushes to `main` possible | Release governance | XS |
| **P1-17** | `autoDeploy:true` on all six prod services defeats deploy ordering | Release governance | XS |
| **P1-18** | **OPS-1** — cannot answer "are all tenants healthy" | Operations | L |

**P2 — meaningful enterprise enhancement**

SCIM provisioning · OIDC parity with SAML · control effectiveness/deficiency
tracking · SAST in CI · DAST/API security testing readiness · seat-model
activation · webhook activation · risk appetite/tolerance modelling ·
evidence-reuse analytics · ADMIN-LOCKOUT-P2 shared bucket.

**P3 — advanced / future**

ADMIN-ACCESS-2 trusted admin architecture · cross-domain intelligence rollups
(§G) · concentration analytics · predictive/autonomous capabilities · vendor
portal GA · agentic Ask actions.

## M. Dependency graph

```
        ┌─────────────────────────────────────────────┐
        │  P0 PROMOTION  (P0-1..P0-5, #826, R-3, B-5) │
        │  unblocks: EVERY execution-readiness score  │
        └───────────────────────┬─────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  ┌───────────┐         ┌──────────────┐        ┌──────────────┐
  │ P1-1 #855 │         │ P1-9 evidence│        │ P1-13 admin  │
  │ extraction│         │  lifecycle   │        │  audit       │
  └─────┬─────┘         └──────┬───────┘        └──────┬───────┘
        │                      │ unblocks              │ unblocks
        ▼                      │ Controls, AI Gov,     ▼
  ┌───────────┐                │ Vendor, Pen-Test    OPS-1 (P1-18)
  │ VA-3 run  │                │ (4 verticals)         │
  └─────┬─────┘                ▼                       ▼
        │              ┌──────────────┐         ┌──────────────┐
        ▼              │ P1-10 policy │         │ operator role│
  ┌───────────┐        │ versions/    │         │ separation   │
  │ P1-2 find │        │ attestation  │         └──────────────┘
  │ provenance│        └──────────────┘
  └─────┬─────┘
        ▼                ┌──────────────────────────────────┐
  ┌───────────┐          │ P1-4 ASSET ESTATE (PLAT-ASSET-1) │
  │ P1-3 ADR- │          │ unblocks: Vulnerability ER,      │
  │ 0010 rule │          │ affected-assets, occurrence value│
  └───────────┘          └───────────────┬──────────────────┘
                                         ▼
                                  ┌──────────────┐
                                  │ P1-5 scanner │
                                  │  ingestion   │
                                  └──────────────┘
```

**The three shared foundations that unblock the most:**

1. **The promotion.** It is the only item that moves *every* ER score, and it
   carries P0-1 and P0-2 outright.
2. **Evidence lifecycle (P1-9).** Evidence is the shared substrate under
   Controls, AI Governance, Vendor Assurance and Pen-Test. Fixing it once lifts
   four verticals; leaving it forces four separate workarounds.
3. **Asset estate (P1-4).** Vulnerability Management's model is the best in the
   platform and it operates over nothing. No amount of vulnerability work
   changes that.

**AI Governance (P1-6/7/8) is deliberately *not* on the critical path** — it
depends on nothing else and blocks nothing else. It is a self-contained
sufficiency deficit, which makes it schedulable anywhere.

## N. Proposed completion waves

Reordered from the suggested sequence based on the dependencies above. The two
changes: **evidence lifecycle is promoted into Wave 1** because four verticals
depend on it, and **AI Governance moves earlier** because it is independent and
is the largest single sufficiency gap.

| Wave | Contents | Why here |
|---|---|---|
| **0 — Release integrity** | P0-1..P0-5, #826, R-3, R-4, promotion, then merge #854/#855/#856/#827 | Moves every ER score; nothing else is worth doing first |
| **1 — Shared governance foundation** | **P1-9 evidence lifecycle**, P1-10 policy versions/approvals/attestation, P1-12 MTTR/SLA-attainment, P1-16 branch protection, P1-17 deploy ordering, P1-14 secret scanning | One fix, four verticals lifted. Release-governance items are XS and reduce recurring risk |
| **2 — Vendor Assurance completion** | P1-1 (#855), **VA-3 re-run**, P1-2 Finding provenance, P1-3 ADR-0010 ruling | The flagship vertical; #855 already exists and VA-3 is written |
| **3 — Asset + Vulnerability** | P1-4 asset estate ruling, then P1-5 scanner ingestion | Converts the platform's best model from theoretical to real |
| **4 — AI Governance** | P1-6, P1-7, P1-8 | Largest sufficiency gap; independent, so it can start any time capacity exists |
| **5 — Operations** | P1-18 OPS-1, built on existing primitives; P1-13 admin audit first | Needs the audit substrate; needs tenants in production to be worth having |
| **6 — Pen-Test** | P1-11 | Weakest advertised vertical, but smallest customer expectation today |
| **7 — Security & enterprise acceptance** | P1-15 DR restore, SAST, DAST readiness, SCIM, seat activation, ADMIN-ACCESS-2 | Acceptance-grade hardening once the verticals are real |

## O. Work that can run in parallel

**Parallel-safe (no shared dependency):**

- Wave 1's release-governance items (P1-14, P1-16, P1-17) — all XS, all
  independent of the domain work.
- **AI Governance (Wave 4)** — depends on nothing, blocks nothing.
- Pen-Test model (P1-11) — independent of Vendor Assurance and Vulnerability.
- P1-12 metrics — reads existing tables.

**Must remain sequential:**

- Promotion **before** anything else, because it changes every ER measurement.
- P1-1 → VA-3 → P1-2 (a fix must deploy before the exercise; the exercise
  determines whether the provenance work is scoped correctly).
- P1-4 → P1-5 (ingesting scans into an empty estate produces orphans).
- P1-9 evidence lifecycle **before** the Wave 2/4/6 evidence-touching work, or
  it gets re-implemented per vertical.
- P1-13 admin audit **before** OPS-1 gains any cross-tenant surface.

## P. Architecture decisions requiring your ruling

| # | Decision | Due | Consequence of not deciding |
|---|---|---|---|
| 1 | **ADR-0010** — do the engagement and document spines converge? | **2026-08-28** | Schema cutoff 08-29 makes the calendar choose Options 3/4 by default |
| 2 | **PLAT-ASSET-1** — how does the asset estate get populated? Import, connector, or manual onboarding | Before Wave 3 | Vulnerability Management stays theoretically excellent and practically empty |
| 3 | **Evidence lifecycle model** — does evidence get validity periods and reuse across controls? | Before Wave 1 | Four verticals each grow their own workaround |
| 4 | **AI Governance scope** — is SecureLogic an AI-governance *product* or an AI-inventory feature? | Before Wave 4 | Determines whether P1-6 is a join table or a domain build |
| 5 | **B-5 / R-4** — dark or target-state promotion | Before promotion | Blocks Wave 0 |
| 6 | **Sept 15 advertised scope** — see §T | **Now** | Risk of advertising a vertical that cannot reach 95/95 |

## Q. Exact recommended next package

**Wave 0 — Release integrity. Specifically: discharge #826 at the
2026-08-25T07:00Z window, close R-3 and R-4, and execute the promotion.**

Not a feature. It is the only action that moves every Execution Readiness score
simultaneously, it carries the security batch and the entire support-readiness
deliverable, and every other wave measures differently once it is done. Doing
domain work first means measuring against a production that does not have the
platform in it.

**Immediately after:** merge #854/#855/#856/#827, then **VA-3** — which is
already written and blocked only on #855 reaching staging.

## R. Estimated scores after each wave

Directional, not precise. Stated as bands.

| After | CS | ER | Note |
|---|---|---|---|
| Today | **62** | **37** | |
| Wave 0 (promotion) | 62 | **~55** | CS unchanged — a deploy adds no capability. ER moves most because everything built becomes reachable |
| Wave 1 (shared foundation) | ~70 | ~62 | Evidence lifecycle lifts four verticals' CS at once |
| Wave 2 (Vendor Assurance) | ~74 | ~70 | First vertical plausibly advertisable |
| Wave 3 (Asset + Vulnerability) | ~80 | ~76 | |
| Wave 4 (AI Governance) | ~86 | ~80 | Largest single CS jump |
| Wave 5 (Operations) | ~88 | ~86 | ER-weighted |
| Wave 6–7 (Pen-Test, hardening) | **~93** | **~92** | |

> **Reaching 95/95 across *all* verticals is not a 2026 outcome at this
> trajectory.** Reaching 95/95 for a *deliberately narrowed* set is achievable —
> see §T.

## S. What specifically prevents 95/95 today

Ranked by how much each depresses the pair:

1. **Nothing is in production.** ER cannot exceed ~55 while the platform's
   capabilities are on a branch. Single largest factor, and the cheapest to fix.
2. **Vendor Assurance has never produced a finding.** The flagship vertical is
   unproven end to end, in every environment.
3. **AI Governance cannot represent framework→control→evidence.** A data-model
   ceiling, not a backlog.
4. **The asset estate is empty**, so Vulnerability Management's strongest asset
   is inert.
5. **Evidence has no lifecycle**, so four verticals rest on a substrate that
   cannot express validity.
6. **Policies have no versions, approvals or attestations.**
7. **No MTTR or SLA attainment** — the metrics an executive buyer asks for first.
8. **No durable admin audit, no secret scanning, no executed DR restore, no
   branch protection.**
9. **OPS-1 cannot answer whether tenants are healthy.**

## T. Can the Sept 15 scope reach 95/95?

**Not as currently scoped. Yes, if narrowed — and the narrowing should be
decided now rather than discovered in a demo.**

| Vertical | 95/95 by Sept 15? | Reasoning |
|---|---|---|
| **Findings & Remediation** | **Plausible** | Highest CS in the platform; needs the promotion and staging proof |
| **Risk Register + Exceptions** | **Plausible** | Same; needs flag activation and validation |
| **Intelligence / Brief** | **Plausible** | Long-exercised; the most operationally mature domain |
| **Vendor Assurance** | **Only with the ADR-0010 Option 4 provenance work and a passing VA-3** | Currently ER 20 with zero findings ever produced |
| **Vulnerability Management** | **No** — unless PLAT-ASSET-1 is answered and an estate exists | The model is excellent and operates over nothing |
| **Pen-Test** | **No** | No UI, no scope/methodology/retest model |
| **AI Governance** | **No** | Data-model ceiling; cannot be closed by Sept 15 |
| **Operations** | **No** | OPS-1 not started, by ruling |

**Recommendation: advertise three to four complete workflows, not eight partial
ones.** Findings/Remediation, Risk Register with Exceptions, and the
Intelligence Brief are defensible with the promotion plus staging validation.
Vendor Assurance becomes the fourth **if and only if** VA-3 passes.

Pen-Test, AI Governance and Operations should be described as roadmap, and
Vulnerability Management should not be advertised as covering a customer's
estate until a customer's estate can get into it. That is a positioning
decision, and it is decision **P-6**, owed now.

---

## Corrections

### 2026-08-22 — the production R2 claim was wrong

The first revision of this baseline stated that the production engine runs
Vendor Assurance flag-ON **with no R2**, and listed that as **P0-3**. It was
inferred from `render.yaml`, which does not declare R2 for the production
engine.

**Verified read-only against the live service** (presence checked, values never
exposed): **all five R2 variables are SET in production** — dashboard-set, not
Blueprint-declared. **P0-3 is withdrawn.**

This is the `render.yaml`-declared ≠ synced trap. The baseline's own appendix
already warned that "all production statements derive from `render.yaml`
declared state and ancestry checks" — and then a declared-state inference was
written into the gap register as a P0 anyway. **Treat every remaining
production claim in this document as declared-state until proven against the
live service**, which is exactly what OP-1 exists for.

**Unchanged by this correction:** the extraction defect, the absent Finding
provenance, the two-spine architecture (ADR-0010), and the fact that Vendor
Assurance has never produced a finding. Vendor Assurance's ER score of 20 does
not move — nothing about configured storage makes an unproven workflow proven.

---

## Appendix — what this baseline did not verify

- **Production runtime behaviour.** No production credential; all production
  statements derive from `render.yaml` declared state and ancestry checks.
- **Live third-party integration health.** 18 connectors exist; none was
  exercised against a live provider here.
- **Customer-facing API quality** — no external consumer has exercised it.
- **Scale characteristics.** No load testing was performed or reviewed.
- **UI quality beyond reachability.** Pages were read for gating and
  provenance, not evaluated for usability.
- **Scores are judgement anchored to verified evidence**, not measurements. The
  basis for each is stated so any of them can be argued with.
