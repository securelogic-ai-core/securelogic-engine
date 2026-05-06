# Risk Register — Current State and Gap Analysis

**Date drafted:** 2026-05-06
**Status:** Draft for operator review. Not yet committed to repo.
**Purpose:** Establish ground truth on what the risk register is today, what positioning it serves, and which gaps the connective-tissue strategy implies. This document is the input to a sequenced roadmap, not the roadmap itself.

---

## Positioning context (operator-stated)

SecureLogic AI is a multi-tenant risk intelligence and governance platform connecting external cyber signals, vendor risk, compliance, and AI governance into one operational view of risk. The risk register's job within that platform is **the connective tissue** — the place where signals from continuous monitoring, controls from compliance automation, and workflow from traditional GRC converge into one coherent risk story.

Competitive set is mixed across three categories: GRC platforms (ServiceNow, Archer), compliance automation (Drata, Vanta), and TPRM/security ratings (Bitsight, SecurityScorecard, Black Kite, UpGuard, OneTrust, ProcessUnity, Panorays). Real competition is "tool sprawl" — winning means proving connection across categories, not winning a feature comparison within any one.

---

## What exists today

### Schema

The `risks` table carries the following columns (post-Package 3 inherent/residual refactor):

- **Identity:** `id`, `organization_id`, `title`, `description`
- **Classification:** `domain` (one of seven), `status` (open / accepted / mitigated / closed / transferred)
- **Inherent rating** (pre-controls): `inherent_likelihood`, `inherent_impact`, `inherent_rating` — all nullable
- **Residual rating** (post-controls): `residual_likelihood`, `residual_impact`, `residual_rating` — typically populated, nullable
- **Legacy rating fields:** `likelihood`, `impact`, `risk_rating` — kept for backwards compat, kept in sync with residual via a backend rule
- **Treatment:** `treatment` (free text — single field)
- **Ownership:** `owner` (free text)
- **Timing:** `due_date`
- **Source linkage:** `source_type`, `source_id` — soft reference to findings or other entities (existence in UI unconfirmed)

Likelihood enum: `rare`, `unlikely`, `possible`, `likely`, `very_likely` (5 values).
Impact / rating enum: `Low`, `Moderate`, `High`, `Critical` (4 values, TitleCase, customer-relabelable via Risk Rating Scale setting — display-only, storage canonical).

The `risk_treatments` table joins to risks (FK on `risk_id`). Multiple treatments per risk supported. Each treatment has `summary`, `type` (mitigate / transfer / accept), `status` (not_started / in_progress / mitigated / accepted / transferred), and `owner`. Terminal treatment status syncs with parent risk status atomically via the route handler.

### UI surfaces

**Risk register table** (`/risks`):
- Filterable by status pills and domain pills
- Sortable columns
- Empty state when no risks match filters
- Import CSV button (top right)
- "Add Risk" creation flow exists but was not visible in the operator's screenshot — likely on the page but not surfaced prominently

**Risk detail page** (`/risks/[id]`):
- Header with residual rating pill (customer-scale-relabeled)
- Metadata grid: Inherent (likelihood / impact / rating) and Residual (likelihood / impact / rating) in two side-by-side columns; null values render as "—"
- Other metadata cells: Owner, Domain, Status, Due Date, Created, Updated, Treatment
- Treatments list (from `risk_treatments` table)
- Edit and delete affordances

**Edit form**:
- Six rating inputs (inherent likelihood/impact/rating + residual likelihood/impact/rating) in two side-by-side fieldsets labeled "Inherent (pre-controls)" and "Residual (post-controls)"
- Title, description, domain, status, treatment, owner, due_date, source_type, source_id

**Create form**: Same shape as edit. All six rating fields required.

**CSV import** (`/risks/import`):
- Strict mode: rejects old 3-field-rating CSVs at upload step
- Accepts new 13-column template (title, description, domain, status, 6 rating fields, treatment, owner, due_date)
- Auto-mapping with permissive aliases (case-insensitive, common variant phrasings)
- Per-row sequential POST, 500-row cap, per-row error reporting

**Dashboard tiles**:
- RisksBreakdown (counts by residual rating)
- RiskHeatmap (likelihood × impact grid, residual values)

### What the schema and UI together support

A user can:
- Manually enter risks with inherent and residual ratings
- Track multiple treatments per risk with status progression
- Filter and sort the register
- Import risks via CSV
- View risk detail with a clean inherent vs. residual presentation

A user **cannot** (verified absent or unconfirmed):
- See risks linked to specific controls
- See risks linked to specific obligations
- See risks linked to findings (the `source_type`/`source_id` columns exist but UI surfacing of the link is unconfirmed)
- See risk-to-vendor relationships
- See risk-to-AI-system relationships
- Capture rationale for accepted risks
- Capture an approver for accepted risks
- Set an expiration / re-review date for accepted risks
- See review cadence on a risk (last reviewed, next review, overdue indicator)
- Assign risk to a user from a controlled list (owner is free text)
- See a risk velocity / trend ("how is this risk changing over time")
- See risk score in a single number (the rating is categorical only — no numeric score the way Package 3 produces for signal-match suggestions)
- Accept risks with a workflow (capture rationale → manager approval → executive sign-off)
- Capture KRIs (key risk indicators) on a risk
- Build parent-child risk taxonomies
- See a per-risk audit trail of changes
- Auto-elevate residual rating when a linked control test fails
- Run quantitative risk scoring (FAIR, monetary loss expectancy)
- Run scenario analysis ("if X happens, what cascades")
- Export the register as a PDF, board deck, or audit-formatted report (CSV import exists; export beyond raw CSV unconfirmed)
- See cross-customer benchmarking ("your vendor risk vs. industry peers")

---

## What "enterprise-grade, fills competitor gaps" implies given the positioning

The connective-tissue stance ("we connect signals, vendors, controls, AI systems, obligations into one risk view") is what separates SecureLogic from each individual category competitor. The risk register's gaps fall into three buckets organized by how much they reinforce that stance.

### Bucket A — Connective tissue (where SecureLogic uniquely wins)

These are the gaps where the platform's existing data (signals, vendors, AI systems, controls, obligations, dependencies, signal-match-suggestions) creates leverage no single-category competitor has.

1. **Risk-to-control mappings.** Each risk lists the controls that mitigate it. Control test failure auto-elevates the risk's residual rating. The platform already has a controls table and a posture engine — wiring this through to risks closes the loop between "we test controls" and "we know which risks are still real." Compliance automation competitors do this for SOC 2; nobody does it across SOC 2 + custom controls + the broader risk register.

2. **Risk-to-finding linkage surfaced in UI.** The schema columns exist; the UI doesn't surface them. A risk should show its open findings inline ("3 findings tied to this risk; 1 Critical, 2 High"). Findings already aggregate into the posture engine; surfacing the link upward into the risk detail is small work.

3. **Risk-to-obligation linkage.** Which obligations does this risk affect? Conversely, which risks does this obligation create exposure on? GRC platforms handle this through control-to-obligation mapping; compliance automation handles it via framework crosswalks; nobody connects all three (signals → controls → obligations → risks) in one view.

4. **Risk-to-vendor and risk-to-AI-system linkage.** Already partially supported via `source_type`/`source_id` (single source). True multi-entity linkage (a risk that touches three vendors and one AI system) is the connective-tissue story made literal. The matcher and link tables shipped earlier this year provide the plumbing; the risk register hasn't yet consumed them.

5. **Continuous re-rating from external signals.** When a CVE drops affecting a vendor that's tied to a risk, that risk's residual likelihood should auto-elevate (or at minimum surface a "review needed" flag). The matcher already produces signal-to-vendor suggestions; the risk register doesn't yet receive those.

### Bucket B — Enterprise table-stakes (where SecureLogic must not lose)

Things every enterprise GRC platform has. Not differentiators, but absence is disqualifying.

6. **Risk acceptance workflow.** Captures rationale, requires approval (owner → manager or executive), sets an expiration / re-review date. Auto-flags for re-review when expiration approaches. Today, "accepted" is just a status with no workflow attached.

7. **Review cadence.** `last_reviewed_at` and `next_review_at` on each risk. Overdue indicator. Org-level policy on review frequency by rating ("Critical risks reviewed monthly; Low quarterly"). This is the audit-defensibility table-stakes — every auditor asks "how do you know this register is current."

8. **Risk owner assignment beyond free text.** Owner should reference a user (FK to `users` table). Free-text owners are unfilterable, unassignable in workflows, and don't propagate notifications.

9. **Per-risk audit trail.** Who changed what when, with old/new values. The `security_audit_log` table exists; risks aren't yet writing to it on every state change (verification needed).

10. **Audit-ready exports.** PDF export with branding, board-deck format, NIST RMF / ISO 27005 / COSO ERM-formatted reports. CSV import exists; structured export does not (verification needed).

### Bucket C — Differentiators (where SecureLogic could lead)

Features that high-end GRC platforms charge enterprise prices for, and where the connective-tissue platform can ship better-and-cheaper.

11. **Quantitative risk option (FAIR-lite).** Monetary loss expectancy alongside the categorical rating. Frequency × magnitude with simple ranges (or Monte Carlo if ambition warrants). The categorical rating stays as the primary UI; quantitative is an opt-in deeper layer for buyers who want it. Enterprise GRC platforms gate this behind their highest tier; SecureLogic could ship it as a standard feature for differentiation.

12. **AI-system-specific risk treatment.** Given the platform's AI governance positioning, the risk register should treat AI systems as first-class risk objects: model drift, training data lineage, hallucination rate, jailbreak resistance, governance coverage. Pull these from the AI system entity already in the schema.

13. **Risk velocity.** The derivative of residual rating over time. "This risk has been Critical for 90 days with no progress" is a different signal from "this risk just elevated from Moderate to Critical this week." Surface velocity on the register and on the dashboard.

14. **Risk scoring weights customer-configurable.** Already exists for signal-match suggestions (Package 3 of the broader work — `risk_scoring_weights` table). Extend to risk register itself: org admin sets how severity, criticality, obligation priority weight into a risk's overall priority. The infrastructure exists; the register doesn't yet consume it.

15. **Scenario modeling and bow-tie analysis.** Pre-event causes → event → post-event consequences, with controls on each side. ServiceNow ships this. Drata doesn't. Worth considering whether the buyers SecureLogic targets actually ask for this — flagged but not prioritized.

16. **Cross-customer benchmarking.** "Your vendor risk score is in the 75th percentile for fintech." Privacy-preserving aggregate comparisons. Differentiator no single-category competitor offers because they don't have multi-tenant connective data. This is a year-out feature; mentioned for completeness.

### Bucket D — Polish (where SecureLogic should not invest right now)

Things that look like risk register features but don't move the needle on competitive positioning at the current stage.

17. Bulk operations on the register table (bulk assign owner, bulk close)
18. Saved filter presets / personal views
19. Comments / discussion threads on risks
20. Real-time presence ("Sarah is also viewing this risk")
21. Mobile-specific layouts

These are good. They are not the next thing.

---

## What I don't know that affects sequencing

Honest list of things that should affect the roadmap and that I can't determine from where I sit:

- **Sales call asks.** Which of the gaps above have prospects actually asked about? Which have come up in lost deals? Without this, the roadmap is competitor-validated, not customer-validated.
- **Existing UI surfacing of `source_type`/`source_id`.** Schema columns exist; UI may already surface findings linkage to some degree. Verifying this changes whether item 2 is "wire it up" or "extend it."
- **Whether risks write to `security_audit_log`.** Verification would tell us if item 9 is "fix it" or "ship it."
- **Whether structured export exists.** CSV import was confirmed; export was not. Item 10 may be "extend existing export" or "build from scratch."
- **The `Domain Scores` posture engine extension status.** Earlier work surfaced that posture scoring per domain is ongoing; risk register's connection to per-domain posture depends on where that work lands.
- **Prospect industry mix.** The Bucket C differentiator "AI-system-specific risk treatment" is much higher-leverage if the prospect base skews toward AI-heavy companies. If the prospect base is mostly traditional financial services, item 14 (scoring weights) probably matters more.

These unknowns don't block roadmap drafting, but they should inform sequencing.

---

## Recommended sequencing logic for the roadmap (not the roadmap itself)

When we draft the roadmap, the sequencing principle should be:

1. **Lead with Bucket A** — connective tissue. These are the things only SecureLogic can credibly do, and shipping them first is what the positioning demands. Items 1–5.
2. **Close Bucket B in parallel** — table-stakes can't slip too far behind A or the demo gets undermined when a buyer asks "how do you handle accepted risk workflow." Items 6–10.
3. **Pick one or two items from Bucket C** — quantitative risk and AI-system risk treatment are the two with the most demo-ready visual punch and clearest competitive positioning. Items 11–12.
4. **Defer Bucket C remainder and all of Bucket D** until customer signal warrants. Items 13–21.

Within Bucket A, dependency order matters:
- Item 2 (finding linkage UI) is smallest and highest-leverage — no schema work, immediate user-visible
- Item 1 (control mappings) requires a join table and UI, medium effort
- Items 3 and 4 (obligation / vendor / AI linkage) are extensions of the same join-table pattern
- Item 5 (continuous re-rating from signals) builds on items 1, 3, 4 — it's the payoff that makes connective tissue tangible

Within Bucket B:
- Item 8 (owner FK to users) is foundational — items 6 and 7 are weaker without it
- Item 7 (review cadence) is small and audit-defensibility-critical
- Item 6 (acceptance workflow) is medium but shippable in a single package
- Item 9 (audit trail) likely small (audit log infrastructure exists)
- Item 10 (audit-ready exports) is medium-to-large

Within Bucket C:
- Item 14 (scoring weights for risks) is smallest — extends existing infrastructure
- Item 12 (AI-system risk treatment) is medium — leverages existing AI system entity
- Item 11 (FAIR-lite quantitative) is medium-to-large — new mental model for users
- Items 13, 15, 16 are larger and benefit from customer signal

---

## What this document is and isn't

This is a state document. It captures what's there, what's missing, and what the gaps imply given a stated positioning. It's not a roadmap, not a spec, not a plan. The roadmap comes next, and the right way to draft it is to:

1. Have the operator review this document and correct anything wrong about current state
2. Have the operator add anything from sales calls / customer asks that should change priority
3. Sequence the packages with concrete spec stubs and rough effort estimates
4. Commit the roadmap to the repo as `RISK_REGISTER_ROADMAP.md` so it's the durable artifact and future sessions don't re-derive it

Without those steps, anything I draft is informed guessing. The state document is the floor; the roadmap is built on top.
