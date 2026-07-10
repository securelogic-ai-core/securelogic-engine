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

**This is a design artifact only. It authorizes nothing (CL-5).** Implementation requires
a **separate, explicit approval**; any future implementation remains **additive**, with
**no retirement, no cutover, no migration implied, and no production enablement implied.**
