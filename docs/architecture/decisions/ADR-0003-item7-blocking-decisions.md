# ADR-0003 — Two blocking decisions for Item 7 (C4)

**Status:** ACCEPTED (2026-07-11). Everything else Item 7 needs was already ruled
(ERG R1–R3; CONVERGENCE-ROADMAP C4–C5; EAR-AD-3; `applicabilityPolicy.ts`). Cited, not restated.

## Ruling

**D1 — Option A, with B's attestation edge as an override.** Canonical enterprise context
remains authoritative. Attestation is **supporting evidence** that may override or strengthen
applicability where explicitly defined; it does **not** become the primary source of truth and
does **not** redefine canonical relationships.

**D2 — Option A (narrow).** Entity auto-derivation is **out of scope for Item 7**. Broader entity
derivation remains a future architectural capability and is **not implied** by this ruling.
ERIP-AD-8 / AD-10 stand unamended.

---

## D1 — What makes a tenant asset match a canonical product?

**Question.** ERG R2 permits `affected` only on a high-confidence, explainable match to a tenant
asset. Nothing defines how an asset acquires product identity.

**Current implementation.** `tenantAssetResolver.ts` matches
`canonicalizeVendorName(asset.name) === product_canonical` — **exact string equality on the asset
name**. `canonical_product_aliases` (migration `20260830`) exists and **has no writer**.
Verified: an asset must be named literally `"Exchange"` to match product `exchange`. Real names
(`EXCH-PROD-01`, `Exchange Server 2019`) **never match**.

| | **Option A — evidence-fed aliases** | **Option B — human-declared attestation only** |
|---|---|---|
| **What is built** | Connector / SBOM / CPE ingest writes `canonical_product_aliases`. Resolver matches asset name against aliases at read time. Human attestation edge as override. | A tenant edge: customer explicitly declares `asset → canonical_product`. No machine-written aliases. |
| **Where identity comes from** | Machine-observed evidence | Human declaration |
| **Architectural consequence** | Product identity becomes a **derived, evidence-backed** property that improves as connector coverage grows. Writes only to `canonical_products*`, which is **org-neutral reference data** — not a tenant store. Recall scales without customer effort. | Product identity is **inventory work the customer must do**, per asset. Recall is bounded by customer diligence; a tenant with no attestations resolves nothing. Adds one typed tenant edge. |
| **Aligns with** | ERG R2 (SBOM / deployment inventory / package ids are named as acceptable evidence). EAR-AD-3 (no second resolver — this feeds the existing one). ERIP-AD-8 is **not** engaged: `canonical_products*` is org-neutral, so this is not "mutating a canonical tenant store". | ERIP-AD-10 (humans own canonical tenant values). ECL S0 (load-bearing attribute is a typed edge, not JSONB). |
| **Contradicts** | Nothing. | Nothing — but it leaves R2's own evidence list (SBOM, deployment inventory) unused. |

**Recommendation: A, with B's attestation edge as the override/fallback path.** A is the only option
that consumes the evidence ERG R2 already admits. B alone makes applicability a function of customer
data-entry, which is the failure mode the asset registry exists to end. B's edge is still needed —
for orgs with no connectors, and to let a customer correct a wrong machine match.

**Impact on Item 7.** If neither is built, C4 ships, the flag flips, and applicability resolves
**near-zero in any real tenant** — a silent no-op the shadow telemetry would only expose after the
build. D1 must land **before** C4: the evidence gate is only as good as the asset-side identity it
gates on.

---

## D2 — Does Q2 amend ERIP-AD-8, or is it narrower than it sounds?

**Question.** Q2 ruling: *"Context must be DERIVED automatically; manual entry is optional enrichment
only."* ERIP-AD-8/AD-10: *"Canonical stores are NEVER mutated by reconciliation… no auto-assignment,
ever."* Both cannot hold.

**Current implementation.** Enterprise Context is ~95% manual **by design**. `connectorSyncWorker`
writes `enterprise_relationships` (edges) only and **never creates entities**. Separately,
`findingContextResolver` ignores the org profile (`regulated` / `handles_pii` / `safety_critical` /
`scale`) and ignores `graphImpactAnalysis.ts`, which **already computes** a criticality-weighted
business-impact score and blast radius — consumed today only by the knowledge-graph route.

| | **Option A — narrow: derive finding-level context** | **Option B — broad: auto-populate the entity inventory** |
|---|---|---|
| **What is built** | Wire the org profile + graph blast radius into the Decision Workspace. **Writes nothing.** | Promote `connector_asset_observations` into `enterprise_entities` automatically. |
| **Architectural consequence** | Context becomes derived **where the customer reads it**, using engines that already exist and are already tested. Zero new writers, zero precedence problem. Entity inventory stays human-owned. | Requires a **human-vs-machine precedence model** (what happens when a connector and a human disagree), a confidence/conflict model, and a drift story. A materially larger build with its own rulings. |
| **Aligns with** | ERIP-AD-8/AD-10 (untouched — no canonical store is written). ERG R2 (blast radius is explainable evidence). | The Q2 ruling as literally written. |
| **Contradicts** | Nothing. Delivers the *substance* of Q2 (context derived, not typed) without amending a ratified rule. | **ERIP-AD-8 and AD-10, directly.** Requires an explicit amendment, not an implicit override. |

**Recommendation: A now. B is a separate decision and is not required for Item 7.** A fixes a real
credibility gap immediately — business impact is currently computed with **zero knowledge** of whether
the org is regulated or handles PII. B is the bigger prize *and* the bigger risk; it should not ride
in on Item 7's coat-tails.

**Impact on Item 7.** Under A, Item 7 proceeds now, no amendment. Under B, Item 7 is **blocked**
pending an ERIP-AD-8 amendment and a precedence model. A and B are **different builds, not different
sizes of the same build.**

---

## Consequences for C4

C4 proceeds with an assumptions header citing ERG R1–R3 and CONVERGENCE-ROADMAP C4–C5. No further
design documentation.

Scope admitted by this ruling:
1. **Alias writer + alias-aware resolution** (D1-A) — product identity from machine evidence.
2. **Asset → canonical-product attestation edge** (D1-B) — override/fallback, supporting evidence
   only; never redefines canonical relationships.
3. **Evidence-gated `affected`** (C4 proper) — R2 taxonomy + the thresholds already in
   `applicabilityPolicy.ts`.
4. **Finding-level context derivation** (D2-A) — org profile + graph blast radius read into the
   Decision Workspace. Writes nothing.

Explicitly NOT in scope: auto-population of `enterprise_entities` from connector observations.
