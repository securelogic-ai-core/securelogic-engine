# C4 — Tenant Asset Resolution Enrichment Plan (DESIGN — not authorized)

- **Status:** DRAFT design artifact. **Not authorized for implementation.** No code,
  migration, schema, flag, render.yaml, ticket, or self-authorization is implied.
- **Companions (ground truth, as merged to `develop` at `ce52871d`):**
  `ENTERPRISE-RISK-GRAPH.md` (rulings R1–R3), `CONVERGENCE-ROADMAP.md`,
  `CONVERGENCE-REPORT.md`, `ADR-0002`, `CANONICAL_DOMAIN_MODEL.md`,
  `docs/architecture/enterprise-asset-registry/*` (EAR), `docs/architecture/intelligence-quality/IQP-PHASE-1-AUDIT.md`,
  `docs/specs/risk-lifecycle-spec.md`, `docs/specs/finding-lifecycle-spec.md`.
- **Scope:** C4 enriches an **already-resolved** tenant asset (identity established by
  C2b). It is **not** another matching engine. C0–C3b established *which* asset; C4
  asks *what we should know about it* to raise intelligence quality and business-impact
  accuracy.

## 0. Headline finding

**Most of the enrichment the platform needs already exists as canonical data — the
resolver simply does not surface it.** The C2b resolver returns only
`{ asset_id, asset_type, name, match_rationale, confidence, source_identifiers }`
(`src/api/lib/tenantAssetResolver.ts:37-45`). Meanwhile criticality, owner, status,
lifecycle, internet exposure, data classification/residency/retention/encryption, and
every business/vendor/AI/control/obligation relationship **already live in canonical
objects**. Therefore C4 is overwhelmingly **ALREADY EXISTS → reuse by read-side
composition**, with only a small set of genuine additive gaps, and an explicit
DO-NOT-BUILD list to prevent duplicating canonical data onto the asset (which would
violate EAR-AD-1/AD-2). **C4 = one derived "Resolved Asset Context" composition, not
new asset attributes and not a second engine.**

---

## Architectural clarifications (approved review, 2026-07-10 — APPROVE WITH CHANGES)

The C4 architecture was **approved**; these five clarifications make its intent explicit
to prevent future interpretation drift. They change wording, not architecture.

### CL-1 — Decision feedback is analytical-only (no cycle, no WORM violation)
Completed **Findings MAY contribute intelligence back into Enterprise Context** — e.g.
an asset's accumulated finding/incident history informing its context profile. This is
an **analytical feedback loop only**. It **never** mutates historical evidence, **never**
rewrites canonical Findings, **never** changes provenance, and **never** violates WORM
(the `applicability_*` store stays append-only and read-only to C4). Distinct and
separately forbidden: the applicability engine's **OUTPUT decision must never re-enter
applicability computation** (no decision→applicability cycle). Feeding **input facts**
(criticality, exposure, environment) into the engine's *reasoning* is legitimate and
already the pattern (`assetOwnRisk` consumes criticality); the decision-bearing Resolved
Asset Context is an **output-side** composition consumed only by Decision Workspace /
dashboards.

### CL-2 — Business Impact ownership
**Business Impact is NOT owned by the Asset Registry.** It is **composed at read time**
from canonical sources by the compose-at-read layer, and is **owned by the Decision
Workspace / compose-at-read layer** (`findingContextResolver` / `assessBusinessImpact`).
The Asset Registry (and the Resolved Asset Context) **contribute context inputs only**;
C4 **never computes, stores, or owns** Business Impact.

### CL-3 — Compose-at-read contract (strengthened)
- **No derived value ever becomes canonical data.** Derived enrichments (Resolved Asset
  Context, customer-impact derivation, incident-frequency) are computed at read and
  **never persisted**.
- **Enrichments remain federated** — read from their canonical owners (EAR-AD-1/AD-2),
  never copied onto the asset.
- **C4 introduces NO new system of record** — no new canonical object, no "asset 360"
  table, no denormalized profile.
- **Enrichment never duplicates Enterprise Context** — EC relationships/attributes are
  read via the graph, never re-modeled or re-stored by C4.

### CL-4 — Canonical ownership is singular
**Every enrichment category has exactly ONE canonical owner** — one of: **Asset
Registry**, **Enterprise Context**, **Finding**, **Decision Workspace**, or **Derived
only**. **No enrichment belongs to more than one owner.** The single-owner assignment is
the authoritative matrix in Deliverable 4 (updated below); any earlier "A / B" phrasing
is superseded by that single-owner column.

### CL-5 — Future implementation boundary
**C4 is architecture only.** Implementation requires a **separate, explicit approval**.
Any future implementation remains **additive**, with **no retirement, no cutover, no
migration implied, and no production enablement implied**. This document authorizes
nothing.

---

## Refinement (2026-07-10) — Decision-value proof (DESIGN ONLY; authorizes nothing)

This refinement **does not change the approved C4 architecture**; it raises the bar for
what may live in the Resolved Asset Context. SecureLogic is an **Enterprise Intelligence
Platform** — tenant-asset enrichment exists **only** to improve intelligence quality and
operational decision making. **Availability of data is not a justification.** Every
enrichment must earn its place by improving an explicit customer decision. The proof is in
**Deliverables 11–16** below (Decision Value Matrix, Customer Decision Mapping,
Canonical-vs-Derived principle, over-enrichment review, customer lens, measurable success
criteria). Two enrichments are **reclassified** by that proof and the changes are recorded
there; they **supersede** the corresponding rows in Deliverables 3 and 4. Nothing here
authorizes implementation (CL-5).

## Deliverable 1 — Current-state asset capability inventory (as merged)

| Capability | Where it lives today | Evidence |
|---|---|---|
| Asset identity (Tier-0) | `assets` spine — `asset_type`, `backing_kind`, `backing_id`, `lifecycle_status` (identity only, EAR-AD-2) | `20260803_assets_spine.sql`; `assetRegistry.ts:22-33` |
| Name / criticality / owner / status | `asset_registry_v` — **read** from the backing (`vendors`/`ai_systems`/`enterprise_entities`/detail tables), never copied | `20260802_asset_registry_view.sql:55-63`; `20260806_asset_detail_tables.sql:161-235` |
| Internet exposure | detail tables `endpoints.exposure` / `apis.exposure` (`internal｜internet_facing｜isolated/partner`) | `20260806_asset_detail_tables.sql:61,82` |
| Data classification / residency / retention / encryption | `enterprise_data_stores` (child of a `data_store` entity) | `20260718_enterprise_entities.sql:101-110` |
| Cloud provider / account / region | `cloud_resources` | `20260806_asset_detail_tables.sql:38-40` |
| Relationships (business/dependency/data/ownership) | `enterprise_relationships` (`depends_on｜runs_on｜owned_by｜part_of｜serves｜processes_data_in` over `enterprise_entity｜vendor｜ai_system｜user`) | `CANONICAL_DOMAIN_MODEL.md:254-268` |
| Vendor↔AI dependency | `ai_system_vendor_dependencies` (typed edge, authoritative) | EAR-AD-4/AD-13 |
| Applicability decision + confidence + WORM evidence + blast radius | `applicability_assessments` (+ `_evidence`, `_affected_entities`) | `CANONICAL_DOMAIN_MODEL.md:81`; `20260722/23/24/25` |
| Graph-aware risk (own-risk seeded from applicability × criticality; noisy-OR) | `assetOwnRisk.ts`, `graphRiskPropagation.ts` | shipped (ERIP E3) |
| Resolver output (C2b) | `{asset_id, asset_type, name, match_rationale, confidence, source_identifiers}` | `tenantAssetResolver.ts:37-45` |
| Shadow convergence telemetry | `signal_applicability_shadow` (grain: asset/vendor/ai_system) | `signalApplicabilityShadow.ts`; C3/C3b |
| Business impact (compose-at-read) | 5 dims from affected-entity criticality; `revenue`/`customer` = `not_assessed` | `findingRiskScore.ts:109-142`; `findingContextResolver.ts:381-389` |
| Findings (two axes) | `operational_status` (derived) + `decision_state` (human) | `finding-lifecycle-spec.md` (ratified; not yet implemented) |
| Control / obligation mappings | `control_mappings`, `obligation_mappings`; `signal_control_links`, `signal_obligation_links` | `CANONICAL_DOMAIN_MODEL.md` |

## Deliverable 2 — Existing enrichment map (canonical owner per attribute)

| Attribute | Canonical owner | Surface path to a resolved asset |
|---|---|---|
| criticality, technical owner (`owner_user_id`), status, lifecycle | **Asset Registry** (via backing) | `asset_registry_v` by `asset_id` |
| internet exposure, environment-ish, provider/region | **Asset Registry** detail tables | `endpoints`/`apis`/`cloud_resources` by backing |
| data classification / residency / retention / encryption | **Enterprise Context** | `enterprise_data_stores` via `processes_data_in` edge |
| business service, application, business unit, department, ownership | **Enterprise Context** (graph) | `enterprise_relationships` traversal from the asset's backing node |
| vendor relationships, AI-system relationships | **Enterprise Context** + `ai_system_vendor_dependencies` | typed edges |
| control mappings, obligation/regulatory scope | **Compliance** (Controls/Obligations) | `control_mappings` / `obligation_mappings` + applicability targets |
| historical findings | **Findings** | `findings` by `source_id`/affected-entity linkage |
| remediation history | **Actions** | `actions` by source finding |
| exploit history | **Intelligence** | `cyber_signals`/`intelligence_events.ever_exploited` (KEV) via signal links |
| applicability decision / confidence / evidence | **Applicability (WORM)** | `applicability_assessments` by `(org, target, asset_id)` |

## Deliverable 3 — Missing enrichment opportunities (genuine gaps only)

1. **A composed "Resolved Asset Context"** — the resolver returns identity only; nothing
   assembles the above canonical enrichments into one read model for downstream
   consumers. *(This is the main C4 deliverable — a derived composition, not storage.)*
2. **`environment` / production-vs-non-production** as a first-class attribute — today
   only `exposure` exists (and only on detail-backed types). Prod/non-prod materially
   changes impact and prioritization and is **not** derivable. *(Genuine additive gap.)*
3. **Internet exposure for non-detail-backed types** (vendor/ai_system/application/
   generic) — exposure exists only on `endpoints`/`apis`. *(Additive gap, on the backing.)*
4. **Customer-impact derivation** — the `customer` business-impact dimension is hard-set
   `not_assessed` (`findingRiskScore.ts:121-142`); no linkage feeds it. A derived path
   (asset → `serves` business_service → customer-facing flag) could inform it.
   *(Derivation gap, not storage.)*
5. **Historical incident frequency** as a derived metric (findings/exploits over a window
   per asset) — computable, not yet computed. *(Derived-view gap.)*

## Deliverable 4 — Canonical ownership matrix (per requested category)

Classification: **ALIGNS** (fits current arch) · **EXTENDS** (genuine additive) ·
**CONTRADICTS** (would break a canonical rule) · **ALREADY EXISTS** · **DO NOT BUILD**
(would duplicate canonical data on the asset).

**CL-4: each enrichment has exactly ONE canonical owner** — one of **Asset Registry**,
**Enterprise Context**, **Finding**, **Decision Workspace**, or **Derived only**. No
enrichment belongs to more than one owner. ("Derived only" = composed at read from a
canonical store that is not the asset itself — Compliance / Intelligence / Actions — and
never persisted.)

| Category | Verdict | **Canonical owner (single)** | Canonical data source & evidence |
|---|---|---|---|
| business owner | ALREADY EXISTS | **Enterprise Context** | `owned_by` → business_unit edge (`CANONICAL_DOMAIN_MODEL.md:262-268`) |
| technical owner | ALREADY EXISTS | **Asset Registry** | `owner_user_id` (`20260806…:161-235`) |
| criticality | ALREADY EXISTS | **Asset Registry** | backing → view (`20260802…:58`); **never** copy to the spine (EAR-AD-2) |
| business service | ALREADY EXISTS | **Enterprise Context** | `serves`/`part_of` → business_service edge |
| application | ALREADY EXISTS | **Enterprise Context** | `application` entity + `runs_on` (`20260718…:62`) |
| environment | **EXTENDS** | **Asset Registry** | *(gap — stored INPUT fact on the per-type backing; never the spine/new table)* |
| lifecycle | ALREADY EXISTS | **Asset Registry** | `lifecycle_status` + backing status |
| internet exposure | ALREADY EXISTS (detail) / **EXTENDS** (other types) | **Asset Registry** | `endpoints`/`apis.exposure` (`20260806…:61,82`); additive only where the type lacks it |
| regulatory scope | ALREADY EXISTS | **Derived only** | composed at read from Compliance (`obligation_mappings`) + applicability |
| data classifications | ALREADY EXISTS | **Enterprise Context** | `enterprise_data_stores` (`20260718…:101-110`) |
| customer impact | **EXTENDS** (derivation) | **Decision Workspace** | a composed impact dimension (`findingRiskScore.ts:121-142`); never a stored asset field |
| production/non-production | **EXTENDS** | **Asset Registry** | *(gap — stored INPUT fact on the per-type backing; pairs with `environment`)* |
| AI system relationships | ALREADY EXISTS | **Enterprise Context** | typed edges + `ai_system_vendor_dependencies` (EAR-AD-4/AD-13) |
| vendor relationships | ALREADY EXISTS | **Enterprise Context** | typed edges (EAR-AD-4/AD-13) |
| control mappings | ALREADY EXISTS | **Derived only** | composed at read from Compliance (`control_mappings`, `signal_control_links`) |
| obligation mappings | ALREADY EXISTS | **Derived only** | composed at read from Compliance (`obligation_mappings`) |
| historical incident frequency | **EXTENDS** (derived metric) | **Derived only** | computed view over `findings` + `cyber_signals`; **never** a stored counter |
| historical findings | ALREADY EXISTS | **Finding** | `findings` by asset linkage; **never** copied |
| remediation history | ALREADY EXISTS | **Finding** | `actions` (children of findings); read via the Finding model |
| exploit history | ALREADY EXISTS | **Derived only** | composed at read from Intelligence (`intelligence_events.ever_exploited`/KEV) |
| business-unit ownership | ALREADY EXISTS | **Enterprise Context** | `owned_by` → business_unit edge |

**No category is CONTRADICTS.** Single-owner distribution: **Asset Registry** ×7,
**Enterprise Context** ×7, **Finding** ×2, **Decision Workspace** ×1, **Derived only**
×5. Anything implemented as an asset-owned column (outside the two Asset-Registry
`EXTENDS` input facts) folds into DO-NOT-BUILD.

*Refined 2026-07-10 (Deliverables 11–16): under the customer-decision lens, (a) the
**non-detail-type** portion of "internet exposure" is reclassified from EXTENDS to
**SHOULD LIVE ELSEWHERE** (Enterprise Context / third-party risk) for `vendor` and
`ai_system`, and (b) the **customer-impact derivation** is reclassified from a C4
deliverable to **OPTIONAL / DERIVED-ONLY**, conditional on an upstream customer-facing
attribute existing first. Those two reclassifications supersede the matching rows above.*

## Deliverable 5 — Proposed enrichment architecture

**One derived "Resolved Asset Context" composition — compose-at-read, read-only, no new
asset attributes (except the two genuine backing-level EXTENDS gaps).**

- A read-side resolver-context builder (mirrors the existing compose-at-read pattern of
  `findingContextResolver`/`assessBusinessImpact` and the applicability blast radius)
  that, given a resolved `asset_id` + org, **joins** the existing canonical enrichments:
  registry attributes → graph neighborhood (business service / app / owner / vendor / AI
  / data classification) → control/obligation mappings → applicability decision → recent
  findings/remediation/exploit history.
- **Federate, do not subsume (EAR-AD-1/AD-2):** it reads through `asset_registry_v` and
  the typed tables; it **copies nothing** onto `assets`.
- **WORM-safe:** it only reads `applicability_*`; it writes nothing, so evidence
  provenance is untouched.
- **Tenant-safe:** every join is `organization_id = $org`; no cross-org, no global lookup
  (same posture as C2b).
- **Additive & dark:** gated behind the existing convergence flag family; flag-off
  byte-identical; no cutover, no retirement.
- The only genuinely new *stored* fields are `environment` / prod-non-prod (and exposure
  for types lacking it), which land on the appropriate **backing** table (EAR-AD-2), not
  the spine — and only if approved.

**Explicitly NOT:** a second matcher, a denormalized asset "profile" table, or any copy
of criticality/owner/classification/relationships onto the asset.

## Deliverable 6 — Example before / after

**Before (C2b resolver output):**
```
{ asset_id: A1, asset_type: "application", name: "Exchange Server",
  confidence: 100, match_rationale: "asset_name_canonical == product_canonical" }
```

**After (C4 Resolved Asset Context — composed from existing canonical data):**
```
{ asset: { id: A1, type: "application", name: "Exchange Server",
           criticality: "high", technical_owner: "u_123", lifecycle: "active" },   // Asset Registry
  context: { business_service: "Payments", business_unit: "Finance",               // Enterprise Context (edges)
             data_classification: "confidential", exposure: "internet_facing",     // EC data-store / detail
             environment: "production" },                                          // EXTENDS (if approved)
  compliance: { obligations: ["PCI-DSS 6.2"], controls: ["Patch Mgmt"] },          // Compliance mappings
  history: { open_findings: 3, last_exploit: "KEV 2021-26855", remediations: 2 },  // Findings/Actions/Intel
  applicability: { decision: "potentially_affected", confidence: 62, evidence_ref } // Applicability (WORM)
}
```
Every field is **read** from a canonical owner; nothing new is stored except the two
EXTENDS gaps.

## Deliverable 7 — Expected improvements

- **Business Impact (owned by the Decision Workspace / compose-at-read layer, NOT by
  C4 or the Asset Registry — CL-2):** C4 supplies **context inputs** (criticality,
  environment, data-classification, business-service) to the **canonical** composer
  (`findingContextResolver` / `assessBusinessImpact`). With richer inputs the composer
  can raise/lower impact with evidence and finally fill the currently-`not_assessed`
  **customer** dimension. C4 **never computes, stores, or owns** Business Impact and
  persists nothing.
- **Findings:** a finding on a resolved asset can show owner, business service,
  exposure, and history inline — sharpening triage; the two-axis lifecycle is unchanged.
- **Decision Workspace:** the "affected" panel gains business context (who owns it, what
  it serves, is it internet-facing/production) and history — turning a bare asset id into
  a decision-grade object. One Decision Workspace, one Finding model — unchanged.
- **Executive dashboards:** roll-ups by business unit / service / environment /
  data-classification become possible from existing edges, improving board-level framing.

## Deliverable 8 — Risks of over-enrichment

1. **Duplication / dual-write** — copying criticality/owner/classification onto the asset
   breaks EAR-AD-1/AD-2 and creates drift. *(Mitigation: read-only composition.)*
2. **A second "asset profile" store** becoming a shadow domain model. *(Reject.)*
3. **Impact inflation** — enrichment tempting an auto-bump of impact/`affected` without
   evidence, violating IQP precision-over-recall and R2. *(Keep compose-at-read; humans
   own decisions.)*
4. **WORM/provenance erosion** — any write into applicability evidence. *(Read-only.)*
5. **Latency / N+1** on the graph join at read time. *(Bounded neighborhood, same as the
   applicability blast radius.)*
6. **Scope creep into a matching engine** — C4 must never re-resolve identity. *(Identity
   is C2b's; C4 starts from a resolved `asset_id`.)*

## Deliverable 9 — Explicit DO NOT BUILD

- **Do not** add `criticality`, `owner`, `business_owner`, `business_service`,
  `data_classification`, `regulatory_scope`, `control_ids`, `obligation_ids`,
  `vendor_ids`, `ai_system_ids`, or history columns **to the `assets` spine or a new asset
  table** — all are canonical elsewhere (Asset Registry backing / Enterprise Context /
  Compliance / Findings / Intelligence). Surface them by composition.
- **Do not** build a denormalized "asset profile" / "asset 360" table.
- **Do not** create a second applicability/matching engine or re-resolve identity.
- **Do not** auto-derive `affected` or auto-raise business impact from enrichment (R2/IQP).
- **Do not** write to `applicability_*` (WORM) or to vendor/ai-system links / findings.
- **Do not** enable any flag, touch `render.yaml`, or imply a cutover/retirement.

## Deliverable 10 — Recommended phased implementation (IF approved later)

*Design only — not authorized; no tickets implied.*
- **C4a — Resolved Asset Context (read-only composition).** The builder that joins
  existing canonical enrichments to a resolved `asset_id`, dark, org-scoped, WORM-safe.
  Reuses `asset_registry_v` + the enterprise graph resolver + mappings. No schema.
- **C4b — genuine additive attributes (only if the business needs them):** `environment`
  / production-non-production (and exposure for types lacking it) on the appropriate
  **backing** table (EAR-AD-2), additive + dark.
- **C4c — derived metrics:** historical incident-frequency and a customer-impact
  derivation path (business_service → customer-facing), as read-side views feeding the
  existing business-impact composition. No new stored dimension.
- **C4d — surface (post-shadow, ratified only):** wire the Resolved Asset Context into the
  Decision Workspace / executive roll-ups **after** the C3/C3b convergence is measured and
  a cutover is explicitly ratified. Not in scope now.

Each phase is additive, dark, reversible; preserves one canonical asset model, one
Decision Workspace, one Finding model, EAR, IQP, ERIP, tenant isolation, and WORM; and
requires **no cutover and no retirement**.

---

## Deliverable 11 — Decision Value Matrix

Every enrichment considered for the Resolved Asset Context, tested against the question
"**does this materially improve a customer decision?**" Column key: **Reuse?** = surface
existing canonical data by composition; **Build?** = requires a genuinely new stored fact
or derived view. **Outcome** ∈ {REQUIRED, OPTIONAL, ALREADY EXISTS, DERIVED ONLY, DO NOT
BUILD}. "ALREADY EXISTS" and "DERIVED ONLY" are surfaced (Reuse) not built; only
**REQUIRED/OPTIONAL EXTENDS** carry Build = yes.

| Attribute | Canonical owner | Existing source | Proposed source | Customer decision improved | Workflow improved | Dashboard/report improved | Decision Workspace improvement | Business Impact improvement | Reuse? | Build? | Outcome | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Resolved Asset Context (composition) | Derived (read-side) | none (identity only) | compose-at-read builder | "Do I have enough context to act on this asset now?" | one read replaces N lookups | powers every asset roll-up | turns a bare `asset_id` into a decision-grade object | supplies all impact inputs in one call | yes (all inputs) | no (compose) | REQUIRED | The core C4 deliverable; a composition, not storage |
| technical owner | Asset Registry | `owner_user_id` | same (composed) | "Who do I route remediation to?" | auto-assign remediation | ownership coverage | shows accountable owner inline | none (routing, not impact) | yes | no | ALREADY EXISTS | Surface via `asset_registry_v` |
| business owner / business-unit ownership | Enterprise Context | `owned_by` edge | same (composed) | "Who signs off on business risk acceptance?" | routes approvals to the BU | roll-up by business unit | shows business accountable party | scopes impact to a BU | yes | no | ALREADY EXISTS | Graph edge, never copied |
| criticality | Asset Registry | backing → view | same (composed) | "How high should this rank today?" | drives triage order | criticality heatmap | ranks the affected panel | primary impact input | yes | no | ALREADY EXISTS | Never copied to spine (EAR-AD-2) |
| business service | Enterprise Context | `serves`/`part_of` edge | same (composed) | "Which critical services are affected?" | groups findings by service | service-impact view | shows blast-radius service | raises operational impact | yes | no | ALREADY EXISTS | Graph traversal |
| application | Enterprise Context | `application` entity + `runs_on` | same (composed) | "Which app must be patched?" | groups by app | app inventory view | shows hosting app | context for impact | yes | no | ALREADY EXISTS | Graph edge |
| lifecycle | Asset Registry | `lifecycle_status` | same (composed) | "Is this even live — worth acting on?" | suppresses retired assets | active-vs-retired split | de-prioritizes retired | filters non-live from impact | yes | no | ALREADY EXISTS | On spine (identity) |
| data classification / residency / retention / encryption | Enterprise Context | `enterprise_data_stores` | same (composed) | "Does the data here raise the stakes?" | flags regulated data | data-sensitivity view | shows data at risk | raises regulatory impact | yes | no | ALREADY EXISTS | Via `processes_data_in` edge |
| internet exposure (detail-backed) | Asset Registry | `endpoints`/`apis.exposure` | same (composed) | "Should this jump to the top of today's queue?" | reorders queue by exposure | exposure heatmap | flags internet-facing | raises operational impact | yes | no | ALREADY EXISTS | Already on detail tables |
| internet exposure (non-detail types: vendor/ai_system) | — | none | *(none — see Part 4)* | vendor/AI "exposure" is third-party risk, not asset exposure | none on the asset | none | none (wrong axis) | belongs to third-party risk | no | no | DO NOT BUILD (→ elsewhere) | Reclassified: lives in Enterprise Context / third-party risk, not as an asset column |
| environment / production-vs-non-production | Asset Registry | none (gap) | additive field on **backing** table | "Is this production — act now vs. schedule?" | prod-first triage | prod-vs-non-prod split | separates prod incidents | materially changes impact & priority | no | yes (additive) | REQUIRED (EXTENDS) | Genuine gap; not derivable; a stored INPUT fact on the backing, not the spine |
| regulatory scope | Derived (Compliance) | `obligation_mappings` + applicability | same (composed) | "Does this trigger a compliance review?" | opens compliance workflow | obligation-coverage view | shows obligations in scope | raises regulatory impact | yes | no | DERIVED ONLY | Composed at read; never stored on asset |
| control mappings | Derived (Compliance) | `control_mappings`, `signal_control_links` | same (composed) | "Which control is failing here?" | links to control owner | control-coverage view | shows controls implicated | context for impact | yes | no | DERIVED ONLY | Composed at read |
| obligation mappings | Derived (Compliance) | `obligation_mappings` | same (composed) | "Which obligation is exposed?" | compliance routing | obligation view | shows obligations | regulatory impact input | yes | no | DERIVED ONLY | Composed at read |
| vendor relationships | Enterprise Context | typed edges + `ai_system_vendor_dependencies` | same (composed) | "Is a third party implicated?" | opens TPRM workflow | vendor-exposure view | shows vendor dependency | raises third-party impact | yes | no | ALREADY EXISTS | Typed edges (EAR-AD-4/AD-13) |
| AI system relationships | Enterprise Context | typed edges + dependencies | same (composed) | "Is an AI system implicated?" | AI-governance routing | AI-dependency view | shows AI dependency | AI-risk impact input | yes | no | ALREADY EXISTS | Typed edges |
| historical findings | Finding | `findings` linkage | same (composed) | "Has this asset burned us before?" | shows prior history | recurrence view | history inline | pattern context | yes | no | ALREADY EXISTS | Never copied |
| remediation history | Finding | `actions` | same (composed) | "Did we already try to fix this?" | avoids duplicate work | remediation-throughput view | shows prior fixes | trend context | yes | no | ALREADY EXISTS | Via Finding model |
| exploit history | Derived (Intelligence) | `intelligence_events.ever_exploited`/KEV | same (composed) | "Is this weaponized in the wild?" | escalates KEV-linked | exploit-exposure view | flags active exploitation | raises operational impact | yes | no | DERIVED ONLY | Composed at read from Intelligence |
| historical incident frequency | Derived (read-side view) | none (computable) | computed view over `findings`+`cyber_signals` | "Is this becoming systemic?" | flags recurring assets | trend/systemic view | shows frequency trend | trend input to impact | yes (compute) | no (no stored counter) | DERIVED ONLY | Computed, never a stored counter |
| customer-impact derivation | Decision Workspace | `customer` dim = `not_assessed` | derived path `serves`→business_service→customer-facing flag | "Does this touch customers?" | flags customer-facing | customer-impact view | fills a blank impact dim | fills `customer` dimension | conditional | no (derived) | OPTIONAL / DERIVED ONLY | Reclassified: valuable, but blocked on an upstream customer-facing attribute; do not build the derivation until that fact exists |

**Distribution:** REQUIRED ×2 (composition; environment) · ALREADY EXISTS ×11 · DERIVED
ONLY ×5 · OPTIONAL/DERIVED (conditional) ×1 · DO-NOT-BUILD / elsewhere ×1. **Only two
enrichments carry Build = yes**, and only one of those (`environment`) is a stored fact;
everything else is surfaced by composition. This is the proof that C4 is overwhelmingly
reuse, not new storage.

## Deliverable 12 — Customer Decision Mapping (REQUIRED enrichments)

Each REQUIRED enrichment maps to exactly one explicit decision. No vague answers.

| REQUIRED enrichment | The single decision it makes better | Without it, the analyst must… |
|---|---|---|
| **Resolved Asset Context (composition)** | "Do I have enough to act on this affected asset **now**, or must I go dig?" — the decision to act vs. investigate. | manually stitch registry + graph + mappings + history across 5+ screens before deciding. |
| **environment (production vs non-production)** | "Should this Finding **move to the top of today's queue** (production) or be **scheduled** (non-production)?" — the prioritization decision. | guess prod-vs-non-prod from names, mis-prioritizing non-prod noise over live risk. |

Supporting (surfaced, not built) enrichments and their decisions, for completeness:
- **business owner** → *"Who owns remediation / who accepts the risk?"*
- **business service** → *"Which critical services are affected?"*
- **internet exposure (detail)** → *"Should this Finding jump the queue today?"*
- **regulatory scope / obligations** → *"Does this require immediate compliance review?"*
- **exploit history (KEV)** → *"Is this weaponized — escalate now?"*
- **historical incident frequency** → *"Is this asset becoming systemic — fix the pattern, not the instance?"*

If any enrichment cannot name a decision in this form, it does not belong in C4.

## Deliverable 13 — Architectural principle: canonical objects store facts; derived services compute intelligence

**Rule (applies throughout C4):**

> **Canonical objects store facts. Derived services compute intelligence. Consumers
> render intelligence; they neither store nor recompute the facts.**

Applied to the platform layers:

| Layer | Role | Stores | Computes | Must NOT |
|---|---|---|---|---|
| **Asset Registry** | fact of record for the asset | ownership, lifecycle, business service (via graph), **environment**, technology, relationships | nothing derived | compute impact or hold a denormalized profile |
| **Enterprise Context** | fact of record for relationships/data | edges (owns/serves/runs_on/processes_data_in), data classification | nothing derived | be re-modeled or re-stored by C4 |
| **Business Impact Engine** | derived intelligence | nothing canonical | operational / financial / regulatory / third-party impact, prioritization, executive summaries | persist its outputs back as canonical facts (CL-2, CL-3) |
| **Decision Workspace** | consumer of derived intelligence | human decision state only | nothing (it consumes) | compute impact or duplicate asset metadata |
| **Findings** | reference + human decision | `decision_state`, links to asset + derived intelligence | nothing about the asset | duplicate asset metadata (owner, criticality, exposure…) |

**Why this separation matters:**

- **Maintainability** — a fact changes in exactly one place; consumers pick it up on the
  next read. No dual-write, no fan-out migration when criticality moves.
- **Correctness** — one owner per fact means no two stores can disagree (EAR-AD-1/AD-2).
  Derived intelligence is always computed from current facts, never from a stale copy.
- **Scalability** — read-side composition scales by caching/materialized reads without
  touching the systems of record; storage does not balloon with every new consumer.
- **Avoiding "god objects"** — the asset never becomes an "asset 360" that owns ownership
  **and** impact **and** compliance **and** history. Each concern stays with its owner;
  the asset stays a thin identity + facts spine. A god object is the single most common
  way this design fails, so C4 forbids it explicitly (Deliverable 9).

C4 is the embodiment of this rule: it **computes** a Resolved Asset Context from facts it
**does not own**, and stores exactly one new fact (`environment`) with its rightful owner
(the Asset Registry backing).

## Deliverable 14 — Over-enrichment review (ALIGNS / EXTENDS / CONTRADICTS / SHOULD LIVE ELSEWHERE)

| Enrichment | Verdict | If "elsewhere," exactly where |
|---|---|---|
| Resolved Asset Context (composition) | **ALIGNS** | — (read-side derived service; the intended C4 shape) |
| technical owner, criticality, lifecycle | **ALIGNS** (surface) | — (already Asset Registry) |
| business owner, business service, application, data classification, vendor/AI relationships | **ALIGNS** (surface) | — (already Enterprise Context) |
| regulatory scope, control/obligation mappings, exploit history | **ALIGNS** (derived surface) | — (Compliance / Intelligence, composed at read) |
| historical findings, remediation history | **ALIGNS** (surface) | — (Finding model) |
| **environment / production-vs-non-production** | **EXTENDS** | — (genuine additive stored INPUT fact on the **Asset Registry backing** table; never the spine, never a new table) |
| historical incident frequency | **EXTENDS** (derived metric) | — (a read-side computed view; never a stored counter) |
| **internet exposure for vendor / ai_system** | **SHOULD LIVE ELSEWHERE** | **Enterprise Context / third-party risk** — a vendor's or AI system's exposure is a property of the third-party relationship, not an asset column. Bolting `exposure` onto these backings would model the wrong axis and duplicate third-party-risk semantics. (Reclassified from the Deliverable-3/4 EXTENDS.) |
| **customer-impact derivation** | **SHOULD LIVE ELSEWHERE (for now)** | **Decision Workspace / Business Impact Engine**, and blocked on a **customer-facing attribute on `business_service` in Enterprise Context** that does not yet exist. Until that upstream fact exists, C4 must not invent a derivation — doing so would guess customer impact, violating IQP precision-over-recall. |
| any asset-owned copy of criticality/owner/classification/relationships/history | **CONTRADICTS** | — (breaks EAR-AD-1/AD-2; already DO-NOT-BUILD in Deliverable 9) |

**No enrichment is added as a duplicate of canonical data.** Two items previously treated
as C4 build candidates are pushed out of asset scope (exposure-on-vendor/AI → third-party
risk; customer-impact derivation → deferred to its rightful owner pending an upstream
fact).

## Deliverable 15 — Customer lens ("if this disappeared tomorrow…")

Test: *"If this attribute disappeared tomorrow, what customer decision becomes harder?"*
If there is no meaningful answer, remove it.

| Enrichment | Decision that becomes harder if it disappears | Keep? |
|---|---|---|
| Resolved Asset Context | Every affected-asset decision reverts to manual multi-screen investigation | **Keep** |
| environment (prod/non-prod) | Cannot separate act-now from schedule-later; prod risk buried under non-prod noise | **Keep** |
| criticality / business service / exposure (detail) | Cannot rank today's queue; triage order collapses | **Keep (surface)** |
| business owner / technical owner | Cannot route remediation or risk acceptance | **Keep (surface)** |
| regulatory scope / obligations | Cannot decide if compliance review is triggered | **Keep (surface)** |
| exploit history (KEV) | Cannot escalate weaponized risk | **Keep (surface)** |
| historical incident frequency | Cannot tell a recurring/systemic asset from a one-off | **Keep (derived)** |
| data classification | Cannot judge whether sensitive data raises the stakes | **Keep (surface)** |
| **internet exposure on vendor/ai_system** | *No asset-level decision becomes harder* — the third-party-risk view answers it better | **Remove from C4** (→ third-party risk) |
| **customer-impact derivation (as guessed today)** | The decision is real, but a **guessed** flag makes it *worse*, not easier | **Remove until the upstream customer-facing fact exists** |

The lens confirms the two reclassifications in Deliverable 14: both fail "does removing it
make a **customer** decision harder in a way C4 can honestly fix now?"

## Deliverable 16 — Measurable success criteria

Success is measured, not asserted. If implemented later (separate approval — CL-5), C4 is
successful only if it moves these:

- **Fewer analyst clicks / screens per affected-asset triage** — target: the context an
  analyst needs is available in **one** Resolved Asset Context read instead of N manual
  lookups (baseline: count screens/queries per triage today).
- **Fewer manual owner/BU assignments** — remediation routing pre-filled from composed
  ownership; measure the drop in manually reassigned findings.
- **More accurate business-impact** — measurable rise in impact assessments backed by
  evidence (criticality + environment + data-class inputs present) vs. `not_assessed`;
  measure the reduction in `not_assessed` operational/regulatory dimensions.
- **Better prioritization** — measurable increase in production / internet-facing /
  KEV-linked findings ranked ahead of non-prod/isolated ones (queue-order correlation).
- **Fewer false-positive "affected" assets** — enrichment must **not** raise this;
  precision-over-recall (IQP/R2) means the false-positive rate stays flat or drops.
- **Fewer repeat incidents on the same asset** — via the systemic-frequency signal
  surfacing recurring assets for pattern-level fixes.
- **Better executive reporting** — roll-ups by business unit / service / environment /
  data classification become producible from existing edges (coverage %: assets that
  resolve to a BU/service/environment).

Each criterion has an observable baseline and target; none is a subjective "feels
richer." An enrichment that cannot move at least one of these does not belong in C4.

---

**This is a design artifact only. It authorizes nothing (CL-5).** Implementation requires
a **separate, explicit approval**; any future implementation remains **additive**, with
**no retirement, no cutover, no migration implied, and no production enablement implied.**
