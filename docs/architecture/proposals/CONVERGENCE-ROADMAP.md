# Enterprise Risk Graph — Executable Convergence Roadmap

- **Status:** RATIFIED direction (2026-07-10). Governs the convergence program.
- **Shipped status (2026-07-10):** **C0–C3b COMPLETE on `develop`, dark.** The
  measured phases diverged from this plan's original numbering (reconciled here, plan
  text below preserved as the ratified intent):
  - **C0** governance — PR #597. **C1** Canonical Product core — PR #598; **C1b**
    migration — PR #599.
  - **C2 was RE-SCOPED** — the `asset` applicability target was **already shipped**
    (migration `20260804`), so C2 (PR #600) **reused** it and added only the route
    read-set + a WORM-safe `asset_id` FK fix; it did **not** rebuild the Canonical
    Product or the resolver.
  - **C2b** Canonical Product → Tenant Asset Resolver (organization-scoped; ambiguous →
    `needs_review`) — PR #601.
  - **C3** applicability(asset) vs legacy shadow — PR #602. **C3b** (new; not in the
    original table) extended the same shadow to the **vendor → asset** and
    **ai_system → asset** grains — PR #603.
  - **C4 COMPLETE on `develop`, dark (2026-07-11).** Evidence-gated `affected` now works
    end-to-end, still behind `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED` (off everywhere).
    Governed by **ADR-0003** (`docs/architecture/decisions/`), which ruled the two questions
    C4 could not proceed without:
      - **D1** — how a tenant asset acquires PRODUCT identity. `tenantAssetResolver` matched
        on EXACT asset-NAME equality, so a realistically-named asset (`EXCH-PROD-01`) NEVER
        matched product `exchange`; C4 would have shipped and resolved near-zero in any real
        tenant. Ruled: evidence-fed identity (`asset_product_identities`, migration 20260905:
        provenance attestation | sbom | connector | inferred), with a human **attestation
        override** that is supporting evidence only and never redefines canonical
        relationships.
      - **D2** — ruled NARROW: finding-level context derivation only (org profile + graph
        blast radius, read-only). **ERIP-AD-8 / AD-10 stand unamended**; entity
        auto-derivation is explicitly out of scope.
    Shipped in four parts: product identity + the evidence gate; the attestation route; the
    finding-level enterprise context (D2-A); the resolver→engine bridge + proof.
    **The gate is a number:** the resolver's `confidence` becomes the engine's `match_score`,
    so evidence (attestation 100 / sbom 95 / connector 85) clears
    `applicabilityPolicy.matchThresholds.high` (70) and can conclude `affected`, while a bare
    asset-name coincidence (60) cannot and caps at `potentially_affected`. Vendor-only input
    still never resolves at all (R2).
    `resolveNeighborhood` gained an `inbound` direction (default `outbound`, all existing
    callers byte-identical): edges mean "X depends on Y", so an outbound blast radius from a
    compromised vendor found nothing and would have reported "nothing depends on Microsoft"
    with six assets one hop away.
  - **C5–C9 NOT started.** No Decision Workspace read of applicability assessments, no
    retirement, no cutover, no production enablement.
  Metrics live only in `CONVERGENCE-REPORT.md` (not duplicated).
- **Companion:** `ENTERPRISE-RISK-GRAPH.md` (architecture + rulings R1–R3).
- **Prime directive:** converge the legacy live signal→vendor path onto the existing
  `ApplicabilityEngineV1`; **no** second applicability engine, **no** vendor-specific
  resolver, **no** parallel affected-vendor contract. Everything dark behind existing
  flags (+ one new engine flag) until an explicit, operator-approved cutover gate.
  Flag-off is byte-identical at every step. No staging/prod actions without operator approval.

---

## 1. The current legacy live path (what exists and ships today)

```
cyber_signals (global, org_id NULL)
  → runMatcherForSignal(signal, orgId)                  src/api/lib/cyberSignalProcessingService.ts
        · canonical NAME match affected_vendor vs org active vendors/ai_systems  (:349-432)
        · INSERT finding  source_type='cyber_signal'                              (:459-498)
        · INSERT signal_match_suggestion (pending, score)                          (:598-619)
        · asset branch (suggest-only, flag-dark, name_canonical)                   (:696-774)
  → human accept in /queue → INSERT signal_vendor_links                           signalMatchSuggestions.ts:555
  → Decision Workspace: affected entities READ from signal_*_links ONLY           findingContextResolver.ts:339-365
        → business impact derived from that count                                  findingRiskScore.ts:121-142
  → insights aggregation: v.name ILIKE cs.affected_vendor (wrong join)            intelligence.ts:603-614
```

Live flags on this path: `SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED`,
`SECURELOGIC_ACTION_ENGINE_ENABLED`, `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` (all
`"true"` in prod). This is the path to **retire**, not extend.

## 2. The existing ApplicabilityEngineV1 path (dark, inert — the target foundation)

```
signal_match_suggestions (MatcherCandidate[], target_type incl 'asset')
  → ApplicabilityEngineV1 (PURE)                        src/engine/applicability/v1/ApplicabilityEngineV1.ts
        · rules R1..R6 over the org GraphNeighborhood
        · decision {affected|potentially_affected|not_affected|needs_review|unknown}   types.ts:33-40
        · confidence 0–100 + band {low,medium,high}                                    types.ts:42-43
        · ordered reasoning_steps + normalized affected blast radius
  → WORM persistence  applicability_assessments (+ _evidence by-value + _affected_entities)
        · hash-chained (AD-16), trigger-enforced WORM                              20260722/23/25
  → applicabilityWorkflowDispatcher                     src/api/lib/applicabilityWorkflowDispatcher.ts
        · finding_draft → findings source_type='applicability_assessment'          (:210-254)
        · review Actions (AD-9: never a risk row)                                   (:259-312)
        · AD-8a: PENDING signal_match_suggestions projection                       (:163-201)
  → reassessment on change  jobs job_type='applicability_reassess'                 applicabilityReassessment.ts
  → Brief applicability_citations (platform→Brief, read-only)                      briefApplicabilityCitations.ts
```

Dark flags: `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`,
`SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED`, `SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED`.
WORM tables are empty in every environment; the engine is "INERT — nothing in a live
path imports it" (`ApplicabilityEngineV1.ts:14-16`).

## 3. Duplicated / competing services, joins, schemas, UI contracts

| Concern | Legacy (live) | Canonical (dark) | Converge to |
|---|---|---|---|
| "signal → finding" | `runMatcherForSignal` → `cyber_signal` finding | dispatcher → `applicability_assessment` finding | dispatcher (one path) |
| Affected entities | `signal_vendor_links` join (`findingContextResolver.ts:361`) | `applicability_affected_entities` | applicability blast radius |
| Evidence store | `signal_*_links` + finding `source_type/id` | `applicability_evidence` (WORM, by-value) | one WORM evidence model |
| Match targets | persisted CHECK = quartet only (`20260722:78-79`) | engine enum quartet+`asset` (`types.ts:51-60`) | promote `asset` to storable target |
| Vendor attribution join | `v.name ILIKE cs.affected_vendor` (`intelligence.ts:608`, wrong) | canonical match + graph | applicability (delete the join) |
| Business impact | count of accepted links (`findingRiskScore.ts`) | decision + blast radius + propagation | graph business-impact propagation |
| Triage UI | `/queue` accept → link (`signalMatchSuggestions.ts:555`) | accept → applicability | applicability triage |
| Finding state | free-set `status`+`decision_state` (`findings.ts:951-1103`) | two-axis (derived op + human decision) | ratified finding-lifecycle spec |

## 4. Target canonical flow (per rulings R1–R3)

```
Signal → normalize (IQP Q1/Q2) → [Canonical Product normalize — R1, only when needed]
       → tenant asset resolution (instance_of / valid applicability target)
       → ApplicabilityEngineV1 → decision + confidence + WORM evidence + affected assets
       → business impact (graph propagation) → finding/risk workflow
```
`affected` is **evidence-gated (R2)**; the assessment sets a finding's **initial**
system state only, **never** advancing operational workflow **(R3)**.

## 5. Migration phases (each a bounded PR series; dark; flag-off byte-identical)

| Phase | Deliverable | New/《reused》 flag | Behavior change when flag OFF |
|---|---|---|---|
| **C0** | Governance docs (this + arch + ratified lifecycle spec + canonical amend) | — | none (docs) |
| **C1** | Canonical Product entity + external→product normalization (global, additive schema) | 《ENTERPRISE_CONTEXT》 | none |
| **C2** | Promote `asset` to storable applicability target (widen CHECK, additive) + tenant asset resolver | 《APPLICABILITY_WORKFLOW》 | none |
| **C3** | Wire signals → ApplicabilityEngineV1 in **SHADOW mode** (compute+persist assessments alongside legacy; emit comparison metrics; surface nothing) | **`SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED`** (new, engine) | none — legacy path unchanged |
| **C4** | Evidence-gated `affected` classification (R2 taxonomy + threshold in the applicability spec) + tests | 《SIGNAL_APPLICABILITY》 | none |
| **C5** | Decision Workspace + affected-entities resolver READ from applicability assessments (fallback to legacy) | 《DECISION_WORKSPACE》 | none — legacy read preserved |
| **C6** | Finding re-root: `operational_status` derived (two-axis); applicability sets **initial** state only (R3) | 《DECISION_WORKSPACE》 | none |
| **C7** | Converge `/queue` triage → applicability accept (legacy accept kept behind compat) | 《RISK_WORKSPACE》 | none |
| **C8** | **Deprecate** legacy matcher as source-of-truth (stop writing `signal_vendor_links` as affected-truth; keep read compat) | cutover gate | LEGACY still readable |
| **C9** | **Delete** legacy path (after deletion criteria) | post-cutover | legacy removed |

C1–C7 are reversible and shippable independently; C8–C9 require the explicit
operator-approved cutover gate.

## 6. Compatibility boundaries (what must NOT break during migration)

- **EAR-AD-1 federation** — `vendors`/`ai_systems` keep their tables + routes; `registerAsset()` unchanged.
- **Five live readers** of `findings` `source_type='cyber_signal'` keep working until C8 migrates them (per package-3.5 investigation).
- **`signal_vendor_links`** remains readable through C8; only its role as *the* affected-truth is retired.
- **Flag-off = byte-identical** at C1–C7 (enforced by test gate §10).
- **No new customer-visible concept** until C5; shadow output (C3–C4) is metrics-only.

## 7. Feature flags

- Reuse: `ENTERPRISE_CONTEXT`, `APPLICABILITY_WORKFLOW`, `DECISION_WORKSPACE`, `RISK_WORKSPACE`, `BRIEF_APPLICABILITY_CITATION` (all dark, GATE-B for prod).
- **New (one only):** `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED` — gates the signal→ApplicabilityEngineV1 wiring, default `"false"`, engine-only, read as `=== "true"`. Sub-mode `SECURELOGIC_SIGNAL_APPLICABILITY_MODE` ∈ `shadow|surface` (default `shadow`) controls whether C5+ surfaces read from it. **No** other new flag; do not introduce per-feature flags that fragment the gate.
- Cutover gate (C8) is an operator decision recorded in a ledger, not a flag flip alone.

## 8. Observability & comparison metrics (shadow mode is the safety net)

Emitted per `(org, signal)` in C3–C4 shadow mode, never customer-facing:
- `applicability_shadow_decision{decision,band}` — decision + confidence-band distribution.
- `applicability_vs_legacy_agreement` — set agreement between legacy affected-vendor set and applicability affected-asset set (projected to comparable grain).
- `applicability_legacy_only_affected` — entities legacy calls affected that applicability does **not** (recall-regression guard — must be explainable).
- `applicability_new_affected` — entities applicability surfaces that legacy missed (recall gain).
- `applicability_false_affected_proxy` — `affected` decisions later dismissed by a human in triage (precision guard, IQP).
- `applicability_engine_latency_ms`, `applicability_reassess_lag`, `worm_write_failures`.
Cutover requires these stable within thresholds (§10) for a defined window.

## 9. Tenant-isolation requirements

- Applicability is computed **per-org** inside `withTenant(orgId)`; global `cyber_signals` fan out per active org (unchanged from the legacy matcher's model).
- `applicability_assessments` + children are **org-scoped with RLS** (existing isolation tests: `test/isolation/applicabilityAssessmentsRls.test.ts`); `organization_id` always from `req.organizationContext`, never request body.
- Canonical Product (C1) is **global/org-neutral** (like `cyber_signals`) — it carries **no** tenant data; only the *asset resolution* is tenant-scoped.
- Shadow metrics are aggregated **without** cross-org identifiers.
- WORM immutability preserved (trigger, role-independent).

## 10. Test gates (block merge / block cutover)

Per-PR (block merge):
- **Flag-off byte-identical** — snapshot/source-guard tests proving C1–C7 change nothing with the new flag off.
- **Engine determinism** — `ApplicabilityEngineV1` unit corpus unchanged; new inputs covered.
- **Tenant isolation** — RLS + `asTenant` isolation suite green (`cross-org-isolation` lane).
- **Evidence gate (R2)** — a vendor-identity-only signal never yields `affected`; only evidence-satisfying inputs do; enforced in service + API + (C5) UI + tests.
- **No-auto-advance (R3)** — an applicability write never mutates a finding's operational status/decision beyond the initial system state.
- Full CI (8 lanes) green; knowledge-index regenerated if any route/nav changes.

Cutover gate (block C8):
- Shadow agreement ≥ ratified threshold for the defined window; `legacy_only_affected` = 0 unexplained; `false_affected_proxy` ≤ legacy baseline; all `cyber_signal` finding readers migrated.

## 11. Rollback conditions

- Any phase: set its flag `"false"` → legacy path resumes; WORM rows persist inert (no reversal needed).
- C3–C4 shadow: rollback is metrics-only (no surface touched).
- C5–C7: `SIGNAL_APPLICABILITY_MODE=shadow` (or flag off) → surfaces revert to legacy read.
- Trigger rollback if: shadow precision proxy regresses, RLS/isolation failure, WORM write failures, or flag-off drift detected.

## 12. Legacy-path deprecation criteria (enter C8)

1. Shadow comparison stable within thresholds for the ratified window (≥ one full release cycle).
2. Applicability recall ≥ legacy **and** precision proxy ≤ legacy false-positive rate.
3. All `signal_vendor_links` **affected-truth** readers migrated to applicability (`findingContextResolver`, insights, Decision Workspace).
4. Evidence-gate (R2) + no-auto-advance (R3) verified in prod-shadow telemetry.
5. Operator cutover approval recorded in the enablement ledger.

## 13. Final deletion criteria (enter C9)

1. Zero live readers of `signal_vendor_links` as affected-truth and zero readers of `findings.source_type='cyber_signal'` as intelligence-affected-truth (grep-verified + telemetry-verified).
2. One full release cycle post-C8 with no rollback and no customer-visible regression.
3. Legacy matcher affected-write code paths removed additively (leave the suggestion scaffold if still used by triage); tests updated; canonical model doc-synced.
4. `signal_vendor_links` retained as historical/compat only if any non-intelligence reader remains; otherwise schedule table retirement in a separate migration.

---

## Guardrails (reject any PR that violates)

ONE domain model · ONE applicability engine (`ApplicabilityEngineV1`) · ONE evidence
model (WORM by-value) · ONE risk model · ONE lifecycle (two-axis) · ONE graph · ONE
asset model. No temporary models, no parallel architectures, no vendor-specific
resolver, no second affected-vendor contract. Dark until the operator cutover gate.
