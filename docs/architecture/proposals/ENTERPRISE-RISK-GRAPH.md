# SecureLogic — Enterprise Risk Graph: Architecture Proposal

- **Status:** APPROVED & realized dark (2026-07-10). The convergence program **C0–C3b**
  is COMPLETE on `develop` (PRs #597–#603) — dark, additive, flag-off byte-identical;
  **convergence + shadow measurement only, no retirement/cutover/production enablement.**
  Later phases (C4–C9) are not started. See `CONVERGENCE-ROADMAP.md` (shipped status),
  `CONVERGENCE-REPORT.md` (metrics), and BUILD_SEQUENCE.md (ERG record).
- **Author role:** Principal Product Architect
- **Date:** 2026-07-10
- **Scope:** the 5-year canonical architecture. Existing code is treated as *evidence*, not authority.

Every major recommendation is tagged **ALIGNS** / **EXTENDS** / **CONFLICTS** with the
current architecture, grounded in `file:line` where it matters.

---

## 0. The one-paragraph verdict

**The architecture SecureLogic should own in five years already exists in the
repository — dark, inert, and unwired — while the live product runs on the wrong
half.** The Tier-0 asset spine, a pure five-state Applicability Engine with WORM
hash-chained evidence, graph risk propagation (noisy-OR over typed edges), and a
two-axis lifecycle direction are all present but flag-gated OFF and disconnected
from ingestion. The *live* surfaces (signal→vendor matcher, `signal_vendor_links`,
free-set finding status, vendor pages) are the **legacy path** and are the real
technical debt. So the strategic question is **not** "rebuild vs preserve" — it is
**"wire and converge onto the correct foundation, and retire the legacy path."**
That is a convergence program, not a rewrite, and it is exactly what the EAR-AD-1
"federate, do not subsume" principle was designed to enable.

The architecture is **not fundamentally wrong. It is fundamentally bifurcated.**
The fix is to make the dark foundation load-bearing and demote the legacy path to a
compatibility projection.

---

## Ratified rulings (2026-07-10) — GOVERNING

The direction is **approved**: the Universal Applicability Engine is **not
greenfield** — `ApplicabilityEngineV1` is the canonical foundation. The remaining
program is **convergence, wiring, migration, and retirement of the legacy live
path.** Do not rebuild functionality that already exists; do not create a
vendor-specific resolution engine, a second applicability engine, or a parallel
affected-vendor contract. The executable plan is `CONVERGENCE-ROADMAP.md`.

**R1 — Canonical Product layer: APPROVED WITH LIMITS.** Retain a Canonical Product
layer only where required to normalize external product / package / version /
service / hardware / firmware / platform identities *before* resolving them to
tenant assets. The Canonical Product is an **intermediate reference entity, not the
primary customer-risk object** — customer impact attaches to **canonical tenant
assets**, never to vendors or products. Do **not** force a signal through a Product
object when it already identifies a canonical tenant asset (or another valid
applicability target). The canonical impact chain is:

```
Signal → normalized affected technology/product → tenant asset resolution
       → applicability assessment → evidence & confidence → business impact
       → finding / risk workflow
```

**R2 — `affected` without CPE: APPROVED, EVIDENCE-GATED.** CPE is one match-evidence
source, **not** a prerequisite. An assessment may be `affected` without CPE **only
when both** hold: (a) authoritative evidence identifies the affected technology /
product / service / package / version / configuration / deployment condition; **and**
(b) the engine has a **high-confidence, explainable** match to a tenant asset
satisfying those conditions. Acceptable non-CPE evidence includes vendor advisories,
package identifiers, cloud-service identifiers, product/version records, SBOM/component
data, deployment inventory, or configuration evidence. Below the confirmed threshold,
use a truthful lower state (`potentially_affected` / `needs_review` / *insufficient
evidence* / `unknown`). **Never infer `affected` from vendor identity alone.** The exact
evidence taxonomy and confidence threshold are specified in the governing applicability
spec and enforced identically across services, APIs, UI, and tests.

**R3 — Finding operational status: DO NOT AUTO-ADVANCE.** Applicability state and
operational workflow state are **separate dimensions**. An applicability assessment
MAY update: applicability state, confidence, matched assets, supporting evidence,
calculated business impact, recommended action, and audit history. It **MUST NOT**
automatically mark a finding reviewed, accepted, in-progress, remediated, approved,
or closed. The engine may **create or refresh** a finding and place it into the
lifecycle's correct **initial system-generated state**; every subsequent transition
follows the ratified lifecycle's rules, permissions, approvals, and audit. (This
supersedes any earlier "route to governance queue" phrasing that implied a decision;
the engine sets the *initial* state only.)

These rulings resolve the prior open questions; the "Open questions" that remain
below are re-scoped to residual design detail, not direction.

---

## Part 1 — The canonical domain model (from first principles)

**What problem is SecureLogic solving?** Not "what vulnerabilities exist" (a feed
anyone can buy) but: *"What in **this** customer's environment is exposed, how much
does it matter to **their** business, and what decision should leadership make?"*
That question has a shape: **exposure = (a threat) × (an asset the customer
actually runs) × (a path to something the business values).** That product is a
**graph problem**, not a list problem.

**The canonical object is the Asset — as a node in an Enterprise Risk Graph.** Not
the Vendor (one asset type of ten), not the Finding (a work projection), not the
Signal (org-neutral input).

### First-class entities

| Entity | What it is | Canonical today? |
|---|---|---|
| **Asset** | Any thing in the customer's environment: vendor, ai_system, application, database, cloud_resource, endpoint, api, identity_system, business_process, generic — and future classes. Tier-0 identity + typed backing. | **YES** — `assets` spine (`20260803`), `asset_registry_v`, 10 types (`assetRegistry.ts:22-33`). |
| **Canonical Product** | The vendor-neutral identity of a piece of software/service (CPE/product family). *A CVE affects a Product; an Asset is an instance of a Product; a Vendor supplies a Product.* | **MISSING** — the layer that makes CVE→asset precise and vendor-neutral. This is the single most important addition. |
| **Signal** | A global, org-neutral intelligence event: CVE, breach, regulatory change, threat campaign. Immutable, deduped. | **YES** — `cyber_signals` / `intelligence_events`. |
| **Applicability Assessment (Observed Condition)** | The evidence-backed, confidence-scored decision that a signal (or obligation, or control gap) applies to a specific node in THIS org's graph. WORM, reproducible. | **YES (dark)** — `applicability_assessments` + `_evidence` + `_affected_entities`, five-state decision, `ApplicabilityEngineV1`. |
| **Risk** | A lifecycle-managed *decision object* over an exposure or aggregate of exposures. Not a number. | **PARTIAL** — `risks` + 9-state lifecycle machine, but conflated with score + free-set finding state. |
| **Finding** | A **projection** of an Observed Condition into a human work queue. Not a source of truth. | **CONFLICTS** — today an editable, independent object with dual free-set status. |
| **Action** | A unit of remediation work. | YES — `actions`. |
| **Evidence** | By-value, WORM provenance for any assertion. | YES (dark) — `applicability_evidence`; **duplicated** by `signal_*_links` + finding `source_*`. |
| **Control / Obligation** | Compliance requirements that *mitigate* or *apply to* nodes. | YES — but modeled as parallel silos, not graph edges. |
| **Decision** | A human governance act (accept, close, approve). Reserved for humans. | PARTIAL — `decision_state` exists but ungoverned. |

**Relationships (edges):** `instance_of` (Asset→Product), `supplies`/`operates`
(Vendor→Product/Asset), `depends_on` (Asset→Asset), `runs_on` (BusinessProcess→Asset),
`owned_by` (Asset→BusinessUnit/User), `processes_data_in` (Asset→DataStore),
`mitigates` (Control→node), `applies_to` (Obligation→node/DataClassification),
`affects` (Signal→Product, global) → **Applicability**(Signal, Asset) per-org.

**Events vs Signals:** a **Signal** is a raw global input; an **Intelligence Event**
is the deduped canonical projection; an **Applicability Assessment** is the per-org,
per-asset Observed Condition derived from it. Three layers, one direction.

→ **ALIGNS** with EAR-AD-1/AD-3 and the applicability model. The **Canonical Product**
layer **EXTENDS**. Treating Vendor/Finding as canonical **CONFLICTS**.

---

## Part 2 — Registry, or graph? → **Graph. EAR is the node layer of an Enterprise Risk Graph.**

The EAR is *described* as a registry, but the platform already ships the other three
graph layers:

- **Nodes:** `assets` (Tier-0) + federated `vendors`/`ai_systems`/`enterprise_entities` (EAR-AD-1).
- **Edges:** `enterprise_relationships` (`depends_on`/`runs_on`/`owned_by`/`part_of`/`serves`/`processes_data_in`) **plus** typed `ai_system_vendor_dependencies` (EAR-AD-4/AD-13, authoritative).
- **Traversal + propagation:** `graphRiskPropagation.propagateRisk()` — noisy-OR, per-hop decay 0.6, over `{node_type,node_id}` (`graphRiskPropagation.ts:19-56`), seeded from the current applicability decision (`assetOwnRisk.ts:37-76`).

So the registry is **already** a graph substrate; it is simply not *named* or
*governed* as one, and the graph is only used for one thing (risk propagation) when
it should be the spine of the whole product.

**Definitions for the Enterprise Risk Graph:**
- **Node** = a canonical entity (Asset, Product, Vendor, BusinessProcess, Control, Obligation, DataStore, Identity). Every node has: type, criticality, owner, lifecycle_status, own-risk.
- **Edge** = a typed, directed relationship carrying: type, direction, **confidence**, **evidence ref**, and decay/aggregation semantics.
- **Ownership** = an `owned_by` edge to a BusinessUnit/User; propagates *down* dependencies (you own what your assets depend on, transitively, for accountability).
- **Dependency** = `depends_on`/`runs_on`; carries risk *up* (a dependency's risk flows to its dependents).
- **Trust boundary** = an edge attribute (e.g. crosses-org, crosses-data-classification, external-vendor) that *modulates* propagation (risk crossing a trust boundary decays differently; data crossing a classification boundary raises obligation applicability).
- **Evidence propagation** = every derived node/edge value carries a pointer to the WORM evidence that produced it, so any number on any screen is explainable to source.

→ **ALIGNS** (the pieces exist) but **EXTENDS** (promote "registry" to "graph" as the
governing abstraction; make the graph load-bearing for applicability, impact, and UI —
not just risk propagation).

---

## Part 3 — The Universal Applicability Engine

**Signals must never attach to vendors.** They attach to **Products** (global), and
Products resolve to **Assets** (per-org instances), and applicability is decided on
the **asset-in-the-graph**. The correct pipeline (a refinement of the sketch, adding
the Product layer the sketch already gestured at):

```
Signal (global)                       cyber_signals / intelligence_events
  → Normalize                         sanitize + recency (IQP Q1/Q2), dedup
  → Canonical Product resolution      CVE→CPE/product identity  ← MISSING LAYER
  → Product-affected assertion        global: "Product X, versions A–B, is affected"
  → Asset instances (per org)         graph: assets WHERE instance_of Product X   ← replaces name-match
  → Applicability (per asset)         ApplicabilityEngineV1: reachability + evidence
        → decision {affected | potentially_affected | not_affected | needs_review | unknown}
        → confidence 0–100 + band {low,medium,high}
        → reasoning_steps + WORM evidence + affected blast radius
  → Business Context                  graph: which BusinessProcesses/DataStores the asset serves
  → Business Impact                   propagate exposure up to business value (Part 6)
  → Risk                              managed exposure (Part 5)
  → Decision                          human governance
```

The single most important change from today: **replace `signal.affected_vendor`
free-text name matching with `instance_of Product` graph resolution.** Name-matching
a vendor string is why "Microsoft CVE → no affected vendor" happens; it is a
category error. A CVE is about a **product**, and the customer is exposed because
they **run an instance** of it.

Per **R1**, the Product layer is an *intermediate normalizer*, invoked only when the
signal identifies an external product/version/package/etc.; a signal that already
names a canonical tenant asset (or another valid applicability target) resolves
directly, without a forced Product hop. Impact always attaches to the **tenant
asset**, never to the Product or Vendor. Per **R2**, `affected` requires authoritative
technology-identifying evidence **and** a high-confidence explainable asset match;
otherwise the truthful lower state is used. Per **R3**, the resulting assessment sets
a finding's *initial* system state at most — it never advances operational workflow.

**ONE applicability engine for everything:** the same engine answers "does this CVE
apply to this asset," "does this obligation apply to this data store," "does this
control gap apply to this business process." Applicability is universal:
*(assertion) × (node) → decision + confidence + evidence.* The engine already models
this generically over `(target_type, target_id)` — it must become the sole
applicability path for **all** modules (vuln, TPRM, AI gov, compliance).

→ **EXTENDS** (`ApplicabilityEngineV1` exists; wire it, add the Product layer, make
it universal). The current signal→vendor accept path **CONFLICTS** and becomes a
legacy projection.

---

## Part 4 — Redesign Findings → **Observed Conditions (evidence) + work-queue projection**

Challenge accepted: **Findings, as they exist, are the wrong primary object.** Today
a Finding is an editable, independent row with a polymorphic `source_type` and two
free-set fields (`status`, `decision_state`) that can contradict each other. That is
finding-centric debt: it makes the *work artifact* the source of truth, so the same
condition is editable in many places and nothing reconciles.

**The canonical evidence-backed object is the Observed Condition** — an Applicability
Assessment (a signal applies to an asset) or an Assessment Result (a control/vendor/AI
review produced a gap). It is **immutable, evidence-backed, confidence-scored**. From
it, the platform *projects*:
- a **Risk Assertion** (if it should be managed), and
- a **Finding = a work-queue item** (the human-facing task surface), whose
  `operational_status` is **derived** from the underlying condition + its Actions,
  and whose `decision_state` is a **human governance** overlay.

So the answer to "what should Findings be": **Observed Conditions are the truth;
Findings are the projection.** Keep the customer-facing *name* "Finding" (recognizable),
but re-root it so it is a derived view over Observed Conditions, not an independent
editable object. This is exactly the two-axis model (derived operational status vs
human decision) generalized: **the operational axis is derived from evidence, the
governance axis is the human decision.**

→ **CONFLICTS** with the current editable-finding model; **ALIGNS** with the
applicability/assessment evidence model and the drafted two-axis lifecycle.

---

## Part 5 — Redesign Risk → **a lifecycle-managed decision, not a number**

Three distinct things are conflated under "risk" today:
1. **Risk Score** — a *calculation* (a derived property of a node/exposure). E.g. `assetOwnRisk`, posture domain scores, propagation output.
2. **Risk (register entry)** — a *decision object with a lifecycle* (the 9-state machine: draft→…→closed/archived, with approvals + SoD).
3. **Risk propagation** — a *graph operation*.

**Risk is #2: a lifecycle-managed decision over an exposure.** The score is a
property of it; the propagation feeds it; the applicability is its evidence. The
platform must stop treating "risk" as a number on a dashboard and treat it as a
**managed exposure decision** with one lifecycle. There must be **one lifecycle
abstraction** that both Risks and Findings (as projections) share — the two-axis model:
- **operational_status** — system-derived from authoritative evidence (Actions terminal, applicability decision, validation);
- **decision_state / lifecycle_state** — human governance (accept, mitigate, approve, close), with separation-of-duties where the stakes require it.

→ **EXTENDS** the shipped risk lifecycle machine (it is the correct nucleus);
**CONFLICTS** with the three-writer, score-as-risk conflation and the free-set
finding state.

---

## Part 6 — The Enterprise Risk Graph (propagation model)

**Node types:** Product, Asset (10+ types), Vendor, BusinessProcess/Service,
BusinessUnit, Identity, DataStore, Control, Obligation.

**Edge types:** `instance_of`, `supplies`, `operates`, `depends_on`, `runs_on`,
`owned_by`, `part_of`, `serves`, `processes_data_in`, `mitigates`, `applies_to`,
plus the global `affects` (Signal→Product). Each edge carries **direction,
confidence, evidence-ref, trust-boundary flags**.

**Eight propagations along the graph (one engine, typed aggregation per property):**

| Propagation | Direction | Aggregation | Grounding |
|---|---|---|---|
| **Applicability** | Signal→Product→Asset | reachability-gated five-state decision | `ApplicabilityEngineV1` |
| **Dependency risk** | dependency → dependent | **noisy-OR** with per-hop decay | `graphRiskPropagation.ts` (exists) |
| **Business impact** | Asset → BusinessProcess/Service | **max/weighted** by process criticality | *new* (assets seed, propagate to business value) |
| **Evidence** | assertion → derived value | **pointer chain** (every value traces to WORM source) | `applicability_evidence` (extend to all) |
| **Confidence** | edge × edge | **multiplicative** along a path (uncertainty compounds) | confidence 0–100 exists; path-compose is new |
| **Ownership** | owner → owned (transitive) | **inheritance** (accountability flows down dependencies) | `owned_by` exists; transitive is new |
| **Criticality** | node → dependents | **max** (a critical dependent raises its dependencies' effective criticality) | criticality exists per node |
| **Trust boundary** | edge attribute | **modulator** (changes decay/obligation on crossing) | *new* |

The key insight: **these are eight traversals of ONE graph with ONE evidence model,
not eight subsystems.** Today only "dependency risk" is implemented; the rest are
either absent or faked per-screen.

→ **EXTENDS** (`propagateRisk` is the template; generalize to eight typed propagations
over the same graph).

---

## Part 7 — Challenge every screen ("would it exist if we rebuilt today?")

| Screen | Rebuild today? | Verdict |
|---|---|---|
| **Dashboard** | Yes, but reframed | Today it's a metrics grid. It should answer *"what in my environment is exposed, and what needs a decision?"* — an exposure/posture view **over the graph**, with honest counts (already fixed in Phase 1). **EXTENDS.** |
| **Assets** | **Yes — promote to primary** | The asset/graph view is the *spine*, not a dark side-page. It should be the home surface: assets, their dependencies, their exposures. Currently dark behind `asset_registry`. **EXTENDS.** |
| **Findings** | **Reframe** | Survives only as a **work queue** projected from Observed Conditions (Part 4), not an editable object list. **CONFLICTS** with current form. |
| **Vendors** (separate pages) | **No** | A vendor is one asset type. `/vendors` should be an **asset filter/lens**, not a parallel surface with its own risk score and its own signal-link path. Retain routes for deep-links (EAR-AD-1), demote from primary. **CONFLICTS.** |
| **Risk Workspace** | Yes | The managed-exposure surface — one lifecycle, one decision model. **EXTENDS** (already the right nucleus). |
| **Decision Workspace** | **Yes — elevate** | This is the *right* idea: a per-exposure governance surface. It should sit on Observed Conditions + graph business-impact, not on a free-set finding. The business-impact and affected-vendor bugs we hit are symptoms of it reading the legacy path. **EXTENDS.** |
| **Queue / Review Links** | Converge | The matcher-suggestion triage should become **applicability triage** (accept an assessment, not a vendor link). **CONFLICTS** with the current link-accept model; converges into applicability. |

---

## Part 8 — Architectural debt register

- **Vendor-centric thinking:** `signal_vendor_links` accept-path as the affected-vendor truth (`signalMatchSuggestions.ts:555`); `/vendors` as a parallel primary surface with its own `current_risk_score`; the frozen quartet still the storable applicability target (`20260722:78-79`). → converge onto Product→Asset applicability.
- **Finding-centric thinking:** findings as editable independent truth with dual free-set `status`/`decision_state` (`findings.ts:951-1103`); posture/exports read `status` as ground truth. → re-root on Observed Conditions.
- **Risk duplication:** three unsynced writers of risk state (edit form `risks.ts:1381`, treatment sync `riskTreatments.ts:609`, lifecycle `riskLifecycle.ts:342`); score-as-risk conflation. → one lifecycle, score as derived property.
- **Evidence duplication:** three evidence stores — `signal_*_links`, `applicability_evidence`, finding `source_type/source_id`. → one WORM by-value evidence model.
- **Lifecycle duplication:** risk 9-state machine vs finding free-set vs treatment terminal-sync vs applicability decision. → one two-axis lifecycle abstraction.
- **Workflow duplication:** `/queue` link-accept vs applicability workflow dispatcher vs findings creation — three ways a signal becomes work. → one applicability→work path.
- **Applicability duplication:** the crude name-matcher (live) vs `ApplicabilityEngineV1` (dark). → one engine.

Every item above is the **legacy live path** shadowing the **correct dark foundation**.

---

## Part 9 — The 3-year architecture (additive, no rewrite — EAR-AD-1 makes this possible)

**Year 1 — Make the foundation load-bearing (converge the spine).**
- Introduce the **Canonical Product** layer + CVE→CPE resolution.
- Promote `asset` to a storable applicability target; wire cyber-signals into `ApplicabilityEngineV1` (retire name-matching as the *truth*, keep as fallback).
- Re-root Findings on Observed Conditions (derived operational_status); ratify the two-axis lifecycle.
- Assets/graph becomes a primary surface. Legacy vendor/finding surfaces become projections.
- *Result:* one applicability engine, one evidence model, live on the graph — behind flags, converging.

**Year 2 — Light up the graph (propagations + unified risk).**
- Generalize `propagateRisk` to the eight typed propagations; business-impact propagates to business processes.
- Unify Risk under one lifecycle; score becomes a derived property.
- Converge Queue/Review-Links and the applicability dispatcher into one triage.
- Retire the vendor-centric accept path (federated into asset applicability).

**Year 3 — Universal applicability across all modules.**
- Compliance obligations, AI governance, TPRM, threat/vuln all expressed as
  applicability over the graph (one engine, one evidence model).
- Predictive + autonomous operate over the graph (both already exist dark).
- New asset classes and new modules plug in as node/edge types with **zero redesign**.

Each year is **additive**: EAR-AD-1 ("federate, do not subsume") guarantees existing
tables/routes keep working while the graph becomes authoritative above them.

---

## Part 10 — Implementation roadmap (architecture-first, no temp models)

Only the sequence — no code. Every phase builds toward the final graph, reuses
existing dark machinery, and introduces **no parallel concept**.

1. **Ratify** this proposal + doc-sync CANONICAL_DOMAIN_MODEL.md (record: Asset/graph canonical; Product layer; applicability universal; two-axis lifecycle; one evidence model). *(no code)*
2. **Canonical Product** entity + CVE→CPE resolution (additive tables; global, org-neutral).
3. **Promote `asset`** applicability target + **wire signals → `ApplicabilityEngineV1`** (dark).
4. **Re-root Findings** on Observed Conditions: `operational_status` derived, `decision_state` governed (the two-axis lifecycle) — the drafted `finding-lifecycle-spec.md`, once ratified.
5. **Graph propagations**: generalize `propagateRisk`; add business-impact + confidence + criticality propagation.
6. **Converge triage**: applicability accept replaces vendor-link accept; `/queue` becomes applicability triage.
7. **Unify Risk**: score = derived; one lifecycle for Risk + Finding projections.
8. **Universalize**: route compliance/AI-gov/TPRM applicability through the same engine.
9. **Demote legacy surfaces** to projections (vendor pages = asset lens; keep deep-links per EAR-AD-1).

Guardrails (per the constraint list): ONE domain model, ONE applicability engine,
ONE evidence model, ONE risk model, ONE lifecycle, ONE graph, ONE asset model. Any
proposal that adds a second of any of these is rejected. No temporary models; every
step ships toward the final shape, dark-first, GATE-B for prod.

---

## Critical-constraint coverage (one model, all modules)

| Module | Expressed as | One-model? |
|---|---|---|
| Threat Intelligence | Signal→Product→applicability over the graph | ✅ |
| Vulnerability Mgmt | CVE→Product→Asset applicability | ✅ |
| Third/Nth-Party Risk | Vendor = asset type; Nth-party = `depends_on` transitive propagation | ✅ |
| AI Governance | AI system = asset type; governance = applicability of controls/obligations | ✅ |
| Compliance | Obligation/Control `applies_to`/`mitigates` edges; applicability engine | ✅ |
| Asset Management | the graph node layer itself | ✅ |
| Executive Reporting | business-impact propagation to BusinessProcess nodes | ✅ |
| Business Impact Analysis | graph propagation (Part 6) | ✅ |
| Decision Management | governance axis of the one lifecycle | ✅ |
| Future modules | new node/edge/assertion types; zero redesign | ✅ |

---

## Summary of ALIGNS / EXTENDS / CONFLICTS

- **ALIGNS:** Asset-as-canonical (EAR-AD-1/AD-3), applicability five-state + confidence + WORM evidence, graph risk propagation, two-axis lifecycle direction, IQP precision-over-recall.
- **EXTENDS:** Canonical Product layer; promote registry→graph as the governing abstraction; universalize the applicability engine; generalize propagation to eight typed traversals; re-root Findings on Observed Conditions.
- **CONFLICTS (recommend replacing, not preserving):** vendor-centric signal→vendor accept path; findings-as-editable-truth with dual free-set state; three-writer risk state + score-as-risk; three parallel evidence stores; parallel matcher vs applicability engine.

**Bottom line:** don't protect the sunk cost of the legacy live path, and don't
rebuild the foundation that's already right. **Wire the correct dark foundation,
converge the legacy path into it as a projection, and govern the whole platform as
one Enterprise Risk Graph with one applicability engine, one evidence model, one
lifecycle.**
