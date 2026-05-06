# Risk Register — Enterprise-Grade Roadmap

**Date drafted:** 2026-05-06
**Status:** Draft for operator review. Not yet committed to repo.
**Companion document:** `RISK_REGISTER_STATE.md`
**Purpose:** Sequence the work to bring the risk register from its current state to enterprise-grade across the three buckets identified in the state document. This is the durable plan; individual packages will be scoped against it.

---

## How this roadmap is structured

The state document classified gaps into four buckets:
- **A — Connective tissue** (where SecureLogic uniquely wins)
- **B — Enterprise table-stakes** (where SecureLogic must not lose)
- **C — Differentiators** (where SecureLogic could lead)
- **D — Polish** (deferred until customer signal warrants)

This roadmap sequences A and B in interleaved waves, includes the two highest-leverage C items, and explicitly defers the rest. Each item gets a package number, scope summary, dependencies, and rough effort.

**Effort scale:** S = small (one focused session, ~half day to one day), M = medium (one to two sessions, two to three days), L = large (multiple sessions, week-plus).

**Package numbers** follow a `RR-N` convention (Risk Register, sequential) so they're distinguishable from the broader platform package numbering.

---

## Sequencing principles

1. **Verification first, build second.** The three honest unknowns from the state document (does the UI already surface findings linkage, do risks write to `security_audit_log`, does structured export exist) get verified in a single small package before any feature work. If any of these turn out to already exist, downstream packages shrink or disappear.

2. **Bucket A leads, Bucket B follows in the same wave.** Connective tissue is what positioning demands; table-stakes are what credibility demands. They ship interleaved so that any sales demo at any point in the roadmap surfaces both new differentiation and basic competence.

3. **Foundation before extension.** Within Bucket A, the join-table pattern (risks ↔ controls, risks ↔ obligations, risks ↔ vendors, risks ↔ AI systems) lands before the consumption logic that traverses those joins. Within Bucket B, owner-as-FK lands before workflows that depend on owner identity.

4. **Differentiators after credibility.** Bucket C items don't ship until A and B are far enough along that the demo doesn't have visible holes. The two C items selected (quantitative risk and AI-system risk treatment) ride at the end of the roadmap, but each is shippable independently if pulled forward by customer signal.

5. **Each package is independently shippable.** No package leaves the register in a worse state than it found it. No package depends on a future package being merged simultaneously.

---

## Wave 0 — Verification

### RR-0: Risk register state verification

**Bucket:** N/A (preflight)
**Effort:** S
**Dependencies:** none

**Scope:** Read-only investigation, no code changes. Answers three questions whose answers shift downstream package scope:

1. Does the risk detail page UI surface findings linkage today via `source_type`/`source_id`? If yes, document what it looks like and whether multiple findings can be associated.
2. Do risks write to `security_audit_log` on create / update / status change / treatment change? If yes, document the event types and payload shape.
3. Does any structured export of the risk register exist beyond CSV import? Document any PDF / board-deck / framework-formatted output paths.

**Output:** A document at `docs/risk-register-state-verification.md` with findings. No code.

**Why this first:** Three unknowns in the state document affect three downstream packages (RR-2, RR-7, RR-9). Settling them before drafting their specs prevents wasted scoping work.

---

## Wave 1 — Connective Tissue Foundation + Critical Table-Stakes

This wave establishes the linkage infrastructure that makes the rest of Bucket A possible, plus the two table-stakes items that audit-defensibility depends on.

### RR-1: Risk-to-finding linkage UI

**Bucket:** A (item 2)
**Effort:** S
**Dependencies:** RR-0

**Scope:** The schema columns `source_type` and `source_id` on `risks` already exist as a soft reference. RR-0 will confirm whether UI surfacing exists. Two paths depending on outcome:

- **If no UI exists:** Add a "Linked Findings" section to the risk detail page that queries findings where `source_type='cyber_signal'` or any of the existing source-typed paths matches the risk. Show finding title, severity, status, link to finding detail.
- **If basic UI exists:** Extend it to handle multiple findings per risk if not already supported, and surface the link inline on the risk table row (small badge with finding count).

**Why this first in Wave 1:** Smallest connective-tissue item, no schema changes, immediate user-visible payoff for the demo.

### RR-2: Risk owner as FK to users

**Bucket:** B (item 8)
**Effort:** S
**Dependencies:** none

**Scope:** Add a nullable `owner_user_id` FK column to `risks`. Keep existing `owner` text column for display fallback during transition. Update create and edit forms to use a user picker (dropdown of org users) instead of free-text input. New rows write `owner_user_id`; existing rows continue rendering from `owner` text until manually re-edited. Migration is additive only.

**Why this in Wave 1:** Foundation for RR-3 (acceptance workflow) and RR-4 (review cadence with notifications). Owner free-text blocks both.

### RR-3: Per-risk audit trail

**Bucket:** B (item 9)
**Effort:** S to M depending on RR-0 outcome
**Dependencies:** RR-0

**Scope:** Ensure every state change on a risk (create, update, status change, treatment add/edit/transition, accept/dismiss) writes to `security_audit_log` with consistent event types and payload shape. Surface the audit trail on the risk detail page as a "History" section showing chronological events with actor, timestamp, and field changes.

If RR-0 confirms audit logging already exists for risks, this package shrinks to "surface the existing trail in the UI."

**Why this in Wave 1:** Auditor-defensibility table-stakes. Every enterprise GRC sales call asks "show me the audit trail." Cheap to ship if the infrastructure already exists.

---

## Wave 2 — Connective Tissue Expansion

This wave builds the join-table infrastructure that Wave 3 will consume. Each package follows the same pattern as the existing `signal_match_suggestions` and `ai_system_vendor_dependencies` link tables.

### RR-4: Risk-to-control mapping

**Bucket:** A (item 1)
**Effort:** M
**Dependencies:** RR-1 (establishes the link-table-on-risks pattern)

**Scope:** New table `risk_control_mappings` with `risk_id`, `control_id`, `organization_id`, `created_at`, `created_by_user_id`, `deleted_at` (soft delete). Partial unique on `(organization_id, risk_id, control_id) WHERE deleted_at IS NULL`. Endpoints:

- `POST /api/risk-control-mappings` — link a risk to a control
- `DELETE /api/risk-control-mappings/:id` — soft delete
- `GET /api/risks/:id/controls` — list controls mapped to this risk
- `GET /api/controls/:id/risks` — list risks mitigated by this control

UI: "Mitigating Controls" section on risk detail page with add/remove affordance. "Risks Mitigated" section on control detail page (read-only initially).

**Why this in Wave 2:** Completes the most important Bucket A claim — "we connect controls to risks." Compliance automation competitors don't do this for the broader risk register; SecureLogic shipping it is the differentiator made literal.

### RR-5: Review cadence

**Bucket:** B (item 7)
**Effort:** S
**Dependencies:** RR-2

**Scope:** Add `last_reviewed_at`, `next_review_at`, `review_cadence_days` columns to `risks`. Org-level policy in `risk_scoring_weights` or a new settings shape: review frequency by residual rating ("Critical: 30 days, High: 60, Moderate: 90, Low: 180"). Compute `next_review_at` from `last_reviewed_at + review_cadence_days` defaulting from policy; allow per-risk override.

UI: "Last reviewed" and "Next review" cells on risk detail. Overdue indicator (red badge) on risk table when `next_review_at < now()`. "Mark Reviewed" button on detail page that updates `last_reviewed_at` and writes audit log entry.

**Why this in Wave 2:** Table-stakes; auditors specifically ask. Pairs naturally with RR-2 (need owner FK to send notifications later) and RR-3 (audit trail captures review events).

### RR-6: Risk-to-obligation linkage

**Bucket:** A (item 3)
**Effort:** M
**Dependencies:** RR-4 (mirrors the same join-table pattern)

**Scope:** New table `risk_obligation_links`. Same shape as `risk_control_mappings`. Endpoints mirror. UI surfacing on risk detail ("Affects Obligations") and obligation detail ("Risks").

**Why this in Wave 2:** Third leg of the connective-tissue triangle (signals → controls → obligations → risks). After RR-4 ships the controls leg, this is the cheapest extension.

---

## Wave 3 — Connective Tissue Payoff

This wave ships the consumption logic that traverses the joins built in Wave 2. The "risk that connects" demo becomes literally true here.

### RR-7: Risk-to-vendor and risk-to-AI-system linkage

**Bucket:** A (item 4)
**Effort:** M
**Dependencies:** RR-6

**Scope:** Two new join tables, `risk_vendor_links` and `risk_ai_system_links`. Same pattern as RR-4 and RR-6. UI surfacing on risk detail ("Affected Vendors", "Affected AI Systems") and on vendor / AI system detail pages ("Risks").

A risk that's already linked to a vendor or AI system via `source_type='vendor'` or `source_type='ai_system'` (single source) gets its single source rendered as an inferred link in this UI; new explicit links are additive. Eventually the single-source columns can be deprecated; not in this package.

**Why this in Wave 3:** Multi-entity linkage on a single risk is the fully-realized connective-tissue claim. After this ships, every entity in the platform can link to every other through risks as the hub.

### RR-8: Risk acceptance workflow

**Bucket:** B (item 6)
**Effort:** M
**Dependencies:** RR-2, RR-3, RR-5

**Scope:** When a user transitions a risk to `status='accepted'`, require a structured input: rationale (text, required), approver (user picker, required), expiration date (date, required). Add columns `acceptance_rationale`, `acceptance_approver_user_id`, `acceptance_expires_at` to `risks`. On expiration, the risk's status auto-flags for re-review (similar to RR-5 overdue indicator).

UI: Modal on the status transition to "accepted" capturing the three fields. Risk detail page shows acceptance metadata when present.

**Why this in Wave 3:** Acceptance is the highest-stakes risk action — auditors scrutinize it most. Worth waiting for RR-2 (owner FK), RR-3 (audit trail), and RR-5 (review cadence) so the workflow is fully integrated rather than bolted on.

### RR-9: Audit-ready exports

**Bucket:** B (item 10)
**Effort:** M to L depending on RR-0 outcome
**Dependencies:** RR-0, RR-3 (audit trail useful in exports), RR-8 (acceptance metadata)

**Scope:** Structured PDF export of the risk register with branding, formatted for board / auditor / regulator consumption. Three formats:

- **Executive summary**: top-level rating distribution, recently changed risks, accepted risks expiring soon
- **Auditor view**: full register with audit trail and acceptance metadata
- **NIST RMF / ISO 27005 / COSO ERM formatted**: framework-mapped output

If RR-0 reveals existing export infrastructure, scope shrinks to "extend the existing export with the three new formats." Otherwise this is a new build using a PDF library.

**Why this in Wave 3:** Closes the audit-defensibility loop. Pairs with RR-3 and RR-8 to give auditors a single document they can sign off on.

---

## Wave 4 — Continuous Re-Rating (Connective Tissue Payoff, Pt. 2)

### RR-10: Continuous re-rating from external signals

**Bucket:** A (item 5)
**Effort:** L
**Dependencies:** RR-4, RR-6, RR-7

**Scope:** When a new signal-match suggestion is accepted (or auto-accepted via the matcher), traverse the link tables to identify affected risks. For each affected risk, surface a "review needed" flag and optionally auto-elevate residual likelihood by one level if the signal severity is Critical and the linked vendor / AI system / control is currently mapped at criticality High or above.

Configurable per-org via existing `risk_scoring_weights` extension: opt-in to auto-elevation, configure the elevation rules.

UI: "Pending review due to signal" indicator on the risk row. Detail page shows the signal that triggered the review. Workflow: user reviews, either confirms the elevation or dismisses it (with rationale, audit-logged).

**Why this in Wave 4:** This is the payoff package. Everything before it builds the joints; this package makes the joints move. After this ships, the platform's "risk that connects" pitch is true in code, not just in marketing.

---

## Wave 5 — Selected Differentiators

### RR-11: Customer-configurable risk scoring weights

**Bucket:** C (item 14)
**Effort:** S
**Dependencies:** none direct, but most useful after Wave 4

**Scope:** Extend the existing `risk_scoring_weights` table (already exists for signal-match suggestions) to cover a numeric risk score on the register. Compute a score per risk from severity × criticality of linked entities × obligation weights of linked obligations. Categorical rating remains primary; numeric score is a secondary sort key and a power-user surface.

**Why this in Wave 5:** Smallest C item, extends existing infrastructure, enables features in C and beyond.

### RR-12: AI-system-specific risk treatment

**Bucket:** C (item 12)
**Effort:** M
**Dependencies:** RR-7 (risk-to-AI-system linkage)

**Scope:** When a risk is linked to an AI system, surface AI-specific risk dimensions on the risk detail page: model drift (from monitoring data), training data lineage, hallucination rate, jailbreak resistance, governance coverage gaps. These pull from the `ai_systems` entity already in the schema.

The AI system risk treatment becomes its own structured panel within the risk detail, distinct from the generic treatment text field.

**Why this in Wave 5:** Highest-leverage differentiator given platform's AI governance positioning. Builds directly on RR-7's linkage; turns the AI system entity from "inventory item" into "first-class risk object."

---

## Explicit deferrals

The following items from the state document are deferred until customer signal warrants. They are deliberately not on this roadmap.

**From Bucket C:**
- Risk velocity (item 13) — useful but not differentiating until competitors lack it; SecureLogic doesn't yet
- Quantitative risk / FAIR-lite (item 11) — meaningful only if buyers actually ask for monetary loss expectancy; defer until a sales call validates demand
- Scenario modeling and bow-tie analysis (item 15) — high effort, ServiceNow's territory, not where SecureLogic's wedge is
- Cross-customer benchmarking (item 16) — year-out feature, requires customer base SecureLogic doesn't yet have

**All of Bucket D:**
- Bulk operations on the table (item 17)
- Saved filter presets / personal views (item 18)
- Comments / discussion threads on risks (item 19)
- Real-time presence (item 20)
- Mobile-specific layouts (item 21)

These get revisited annually or when a specific customer ask justifies pulling one forward.

---

## Total roadmap shape

| Wave | Packages | Effort estimate |
|------|----------|----------------|
| 0 — Verification | RR-0 | S (~half day) |
| 1 — Foundation | RR-1, RR-2, RR-3 | S + S + S–M (~2–3 days) |
| 2 — Linkage | RR-4, RR-5, RR-6 | M + S + M (~5–6 days) |
| 3 — Workflow + Export | RR-7, RR-8, RR-9 | M + M + M–L (~7–10 days) |
| 4 — Payoff | RR-10 | L (~5–7 days) |
| 5 — Differentiators | RR-11, RR-12 | S + M (~3–4 days) |

**Total:** Roughly 22–30 working days of focused engineering work, sequenced to maintain demo-readiness throughout. Each wave is independently demo-able and each package is independently shippable.

**Calendar implications:** At one-to-two packages per week of focused work (the cadence the broader platform has historically sustained), this is a 12–16 week roadmap. Wave 1 ships within two weeks of starting; Wave 4's payoff package ships in roughly month two; differentiators close out in month three.

---

## What this roadmap is and isn't

This is a sequencing plan. It captures the order, dependencies, scope summaries, and effort estimates. It is not specs. Each individual package gets its own spec drafted at scoping time, against this roadmap as the parent context.

**What changes when:**
- Customer asks pull items forward or push them back (sequencing is a default, not a contract)
- Verification (RR-0) shrinks downstream packages if existing infrastructure covers some claims
- New competitive intelligence reveals a gap not in this roadmap (add as RR-N at the appropriate wave)
- Architectural surprises during package scoping change effort estimates (re-estimate, don't re-sequence reflexively)

**What this roadmap commits to:**
- Bucket A and B in interleaved waves, not A-then-B (so the demo never has visible holes)
- Verification before build wherever uncertainty exists
- Each package independently shippable
- Bucket D explicitly deferred, not silently dropped

---

## Open questions for the operator

These don't block roadmap commitment but should be answered before RR-1 starts:

1. **Is Wave 0 (RR-0 verification) genuinely a separate package, or fold it into RR-1's investigation phase?** Operator preference; I lean separate package because it informs three different downstream packages.

2. **Effort estimates assume one developer — is that current reality?** If multiple contributors, parallelization changes the calendar but not the dependency graph.

3. **Anything from sales conversations or prospect feedback that should reorder this?** State document flagged this gap; roadmap is built on competitive intelligence alone. Customer voice would sharpen sequencing.

4. **Confirm Bucket C items pulled into the roadmap (RR-11 customer-configurable weights, RR-12 AI-system risk treatment) are the right two.** Alternatives in Bucket C: quantitative risk / FAIR-lite (item 11), risk velocity (item 13). All three are defensible; the choice depends on buyer profile.

These get answered in conversation, then this document becomes durable in `docs/RISK_REGISTER_ROADMAP.md`.
