# Enterprise Asset Registry — Architecture & Migration Plan

**Status:** DESIGN — FOR REVIEW. No code or schema changed by this document.
**Author:** platform architecture audit, 2026-07-05.
**Relationship to prior work:** this generalizes the Enterprise Context Layer (ECL,
`enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md`, shipped dark through R7). The
Enterprise Asset Registry is the ECL's `enterprise_entities` header/child pattern promoted
one level up and made polymorphic across **every** asset-bearing table on the platform.

Governing docs consulted: `CANONICAL_DOMAIN_MODEL.md` ("one concept, one object"; "outputs
consume, not define"), `TENANT_ISOLATION_STANDARD.md`, `enterprise-context/*` (AD-1, AD-13).

---

## 0. The one decision this document turns on

The request frames "Vendor, AI System, Application, … as asset types **built on top of**
Enterprise Asset." There are two ways to build that, and only one is correct for this codebase.

- **Subsumption (WRONG here):** migrate `vendors` + `ai_systems` (and everything else) into
  one mega-table keyed by `asset_type`. This directly reverses the deliberate **ECL AD-1**
  ruling — *"vendors / ai_systems are NOT valid entity_type values — they own their tables and
  are referenced later, never copied. No backfill, no dual-write"* (`20260718_enterprise_entities.sql`
  header) — and would break, in one change: the signal matcher (name-matches `vendors`/`ai_systems`),
  five assessment tables' `vendor_id`/`ai_system_id` FKs, four `signal_*_links` FKs,
  `ai_system_vendor_dependencies`, the posture engine (reads `vendors`), `enforceEntityLimit`
  (counts `vendors`+`ai_systems`), and every `vendors`/`ai-systems` UI page + `api.ts` type. It is
  a platform rewrite for negative benefit.

- **Federation (CORRECT):** Enterprise Asset is a canonical **identity spine** that *references*
  existing detail tables — it does not absorb them. The "built on top of" relationship is
  inverted from the naive reading: the backing detail tables (`vendors`, `ai_systems`,
  `enterprise_entities`, and new ones) are what an asset is *built on*; the registry sits **above**
  them as the shared identity + classification + cross-cutting layer. This is exactly the
  `enterprise_entities → enterprise_data_stores` header/child pattern, lifted up and generalized.

> **EAR-AD-1 — Federate, do not subsume.** The Enterprise Asset Registry is a thin identity
> registry that federates the existing asset-bearing tables by polymorphic reference. It never
> copies load-bearing attributes and never requires an existing table to be dropped. This
> preserves ECL AD-1 (no attribute duplication / no dual-write of load-bearing data) and ECL
> AD-13 (typed edges remain authoritative) while giving the platform a single canonical asset.

The rest of this document is the consequence of EAR-AD-1: what already exists, what gets
reused vs. generalized, and the backward-compatible phased path.

---

## 1. Current state (verified inventory)

### 1.1 Asset identity is fragmented across three shapes

| Shape | Tables | Discriminator | Notes |
|---|---|---|---|
| First-class own tables | `vendors` (`001`), `ai_systems` (`20260414`) | (implicit — the table *is* the type) | Matched by the signal engine; own assessment stacks. **ECL AD-1: referenced, never copied.** |
| Generic header + typed child | `enterprise_entities` (`20260718`) + `enterprise_data_stores` | `entity_type` CHECK: `asset, application, business_service, business_unit, department, data_store, data_classification, identity` | Only `data_store` has a typed child today. The ECL's canonical context header. |
| Duplicated polymorphic target quartet | `signal_match_suggestions`, `applicability_assessments`, `applicability_affected_entities.via_target_type` | `(target_type, target_id)` ∈ `{vendor, ai_system, control, obligation}` | The de-facto "risk-target" set. Duplicated across three tables' CHECK constraints. |

**None** of `applications`, `databases`, `cloud_resources`, `endpoints`, `apis`,
`identity_systems`, `business_processes` exists as a table. `application` / `data_store` /
`identity` are `enterprise_entities.entity_type` enum values; the rest are absent (`api` appears
only as a `dependencies.dependency_type` value). The two genuinely first-class asset types are
`vendors` and `ai_systems`.

### 1.2 The polymorphic `(type, id)` "no-FK-by-design" reference is already universal

This is the reuse foundation — the platform already addresses heterogeneous things by a
`(type, id)` pair everywhere:

| Table | Polymorphic columns | Type domain |
|---|---|---|
| `findings` | `source_type` / `source_id` | 9 values (assessment/control_test/vendor_review/ai_review/…/risk/cyber_signal/applicability_assessment) |
| `actions` | `source_type` / `source_id` | assessment/finding/signal/manual/risk/obligation/applicability_assessment |
| `evidence` | `source_type` / `source_id` | assessment/finding/signal/manual/risk/obligation/reviews |
| `risks` | `source_type` / `source_id` | signal/manual |
| `signal_match_suggestions` | `target_type` / `target_id` (+ `assessment_id`) | vendor/ai_system/control/obligation |
| `applicability_assessments` | `target_type` / `target_id` | vendor/ai_system/control/obligation |
| `applicability_affected_entities` | `node_type` / `node_id` (unconstrained TEXT), `via_target_type` | free-text node / vendor·ai_system·control·obligation |
| `enterprise_entities` | `source_type` / `source_id` (+ `provenance`) | provenance: manual/csv_import/connector |
| `enterprise_relationships` | `from_type`/`from_id`, `to_type`/`to_id` | enterprise_entity/vendor/ai_system/user |

The **shared header shape** already present on `vendors`, `ai_systems`, and `enterprise_entities`
— `id, organization_id, name, owner_user_id, criticality, created_at, updated_at, UNIQUE(org,name)`
— is the projection the registry standardizes.

### 1.3 Three non-aligned entity-type vocabularies

| Plane | Vocabulary | Consumers |
|---|---|---|
| Signal matcher / suggestions / applicability | `vendor, ai_system, control, obligation` | `cyberSignalProcessingService`, `signalMatchSuggestions`, applicability engine |
| Connectors / enterprise graph / import | `asset, application, data_store, vendor, ai_system, identity` | `connectors/*`, `enterpriseContextImport`, `enterprise_relationships` |
| First-class tables | `vendor, ai_system` (only overlap) | matcher + graph both |

Only `vendor` and `ai_system` appear in both risk-target and graph planes — they are the
load-bearing types. **The connector plane and the matcher plane do not converge:** connectors
emit `asset/application/data_store/identity`, which the matcher does not key on, so
connector-ingested inventory enriches blast-radius reachability but cannot widen what signals match.

### 1.4 The three hard-coded chokepoints that block generalization

1. **`GRAPH_REPRESENTABLE = {"vendor","ai_system"}`** — duplicated in `ApplicabilityEngineV1.ts`
   (blast-radius projection) **and** `applicabilityReassessmentWorker.ts` (neighborhood resolution).
   Because decision `affected` requires reachability, **control/obligation can never reach
   `affected`**, and applications/databases/endpoints get no blast radius at all.
2. **The matcher is a per-target-type branch structure**, not generic: `vendor_name_ilike` and
   `ai_system_name_ilike` create findings; `obligation` is suggest-only (regulatory signals only);
   **control is not matched at all**. Adding a matchable type means editing the ~1400-line
   `cyberSignalProcessingService.ts`.
3. **Per-type `signal_*_links` tables + duplicated 4-value target enums.** Making a new type a
   full risk target requires coordinated edits to ~4 CHECK enums plus a new `signal_<type>_links`
   table + its RLS migration. This is the single highest-friction path in the codebase.

### 1.5 Genuinely shared platform primitives (the reuse assets)

| Primitive | File | Verdict |
|---|---|---|
| Posture engine | `postureComputation.ts` + `engine/scoring/v2/*` | **Strongest abstraction** — pure, 15+ callers. |
| Polymorphic `findings` / `actions` | `20260410_platform_primitives.sql` (+ additive) | Generic `(source_type, source_id)`; the only join point across every workflow. |
| `asTenant` / `withTenant` | `middleware/asTenant.ts`, `infra/postgres.ts` | Per-request tenant tx + RLS GUC. **Adoption half-done** (risks/deps/evidence/findings/ECL yes; vendors/aiSystems/controls/obligations/actions no). |
| `requireCapability` | `enterpriseContextCapability.ts` | Per-org capability gate — the **platform-correct** gating model (vs. universal `requireEntitlement("premium")`). Used only on ECL today. |
| Entity-limit enforcers | `entityLimit.ts`, `enterpriseEntityLimit.ts`, `enterpriseEdgeLimit.ts` | Parallel counters, deliberately not unified. `entityLimit` counts `vendors`+`ai_systems` only. |
| `writeAuditEvent` | `auditLog.ts` | Exists (fire-and-forget domain audit) but invoked **ad hoc per route**, not a systematic layer. |
| Applicability engine | `engine/applicability/v1/*` + R3 worker | Generic over `target_type` at the type level; vendor/ai_system-only at its highest-value output (see 1.4.1). |
| Connector framework | `connectors/*` (9 adapters, dark) | Normalizes to the import shape; **no HTTP route/worker wired** — the one deferred piece. |
| ECL UI kit | `enterprise-context/shared.tsx`, `lib/enterpriseContext*.ts` | The only design-system primitives: gate-aware `ReadFailurePanel`, `readFailure`, `pageNav`, `ReadResult`/`ActionResult`, badges. Older domain pages duplicate badges/stat-cards/import ~20×. |

### 1.6 Assessment landscape (adjacent, not on the critical path)

No shared generic assessment engine. Five bespoke stacks (`vendor_assessments`,
`control_assessments`, `obligation_assessments`, `ai_governance_assessments`,
`dependency_assessments`), each ~535–719-line near-clone route + own validation, plus
`vendor_reviews` and the `risk_*` workflow family. One legacy generic `assessments`/`assess.ts`
(RunnerEngine) that the typed routes do **not** use. `findings` is the only shared join point.
Snapshot-vs-mutable was chosen ad hoc per type. **This is a real consolidation opportunity but a
separate epic** — the asset registry neither requires nor blocks on it (see §5, Track B).

---

## 2. Target architecture — the canonical Enterprise Asset

### 2.1 Three-tier identity (generalizes the ECL header/child pattern)

```
 Tier 0   assets  (NEW, thin registry — the canonical spine)
          id · organization_id · asset_type · backing_kind · backing_id
          · lifecycle_status · (later: tags, environment, business_criticality_override)
              │  (polymorphic, no-FK-by-design pointer — the codebase convention)
              ▼
 Tier 1   Asset DETAIL tables (existing + new — hold type-specific attributes)
          vendors · ai_systems · enterprise_entities(generic) · [cloud_resources]
          · [endpoints] · [apis] · [identity_systems] · [business_processes]
              │  (existing 1:1 typed-child pattern, unchanged)
              ▼
 Tier 2   Typed CHILDREN (load-bearing typed attributes — never JSON, ECL S0 rule)
          enterprise_data_stores · [endpoint_exposure] · [cloud_resource_placement] · …
```

> **EAR-AD-2 — The registry is identity-only; the header is a VIEW.** `assets` stores
> `id, organization_id, asset_type, backing_kind, backing_id, lifecycle_status` and cross-cutting
> attributes that have **no home today**. It does **not** copy `name`/`criticality`/`owner` — those
> are read from the backing table through a canonical view `asset_registry_v`
> (`assets ⨝ backing table → {asset_id, asset_type, org, name, criticality, owner_user_id, status}`).
> Zero attribute duplication ⇒ no drift ⇒ ECL AD-1 preserved *in substance*, not just in letter.

> **EAR-AD-3 — `asset_id` becomes the canonical join key; `(type,id)` stays for compat.** The
> duplicated `(target_type,target_id)` / `(node_type,node_id)` / `(from_type,from_id)` pairs are
> not deleted. Each such table gains a nullable `asset_id` (additive) that the registry resolves;
> the old columns keep working. New code references `asset_id`; the quartet CHECK enums stop
> growing.

### 2.2 The canonical contract (code)

```ts
type AssetType =
  | "vendor" | "ai_system" | "application" | "database"
  | "cloud_resource" | "endpoint" | "api" | "identity_system"
  | "business_process" | "generic";           // extensible, one place

interface AssetRef { asset_type: AssetType; asset_id: string; }  // replaces ad-hoc (type,id)

interface CanonicalAsset {                     // the asset_registry_v projection
  asset_id: string; asset_type: AssetType; organization_id: string;
  name: string; criticality: Criticality | null; owner_user_id: string | null;
  status: string; backing_kind: string; backing_id: string; lifecycle_status: string;
}
```

An **asset-type capability registry** (code-level config, not a table) is what generalizes the
1.4 chokepoints:

```ts
interface AssetTypeSpec {
  type: AssetType;
  backingKind: "vendors" | "ai_systems" | "enterprise_entities" | "<new detail table>";
  graphRepresentable: boolean;     // replaces GRAPH_REPRESENTABLE hard-code
  isRiskTarget: boolean;           // participates in matcher/applicability
  matchStrategy?: "name_canonical" | "cve" | "domain" | "none";  // replaces matcher branches
  detailTable?: string;            // Tier-1 backing detail, if not enterprise_entities
  typedChild?: string;             // Tier-2, if load-bearing attrs
}
```

### 2.3 Per-asset-type mapping (the nine named types)

| Asset type | Exists today as | Backing strategy | New table? | Typed child |
|---|---|---|---|---|
| **vendor** | `vendors` (first-class) | register as-is; `backing_kind='vendors'` | no | (reuse `vendor_assurance_*`) |
| **ai_system** | `ai_systems` (first-class) | register as-is | no | (reuse `governance_reviews`) |
| **application** | `enterprise_entities.entity_type='application'` | generic backing; promote to own table only if app-specific attrs emerge | no (v1) | none |
| **database** | `enterprise_entities.entity_type='data_store'` + `enterprise_data_stores` | **already the exemplar** header+child; expose as `database` alias | no | `enterprise_data_stores` ✅ |
| **cloud_resource** | absent (connectors emit `asset`/`data_store`) | new `asset_type` + detail table | **yes** `cloud_resources` | provider/account/region |
| **endpoint** | absent (connectors emit `asset`) | new `asset_type` + detail table | **yes** `endpoints` | os/exposure/last_seen |
| **api** | `dependencies.dependency_type='api'` (weak) | new `asset_type` + detail, or generalize `dependencies` | **yes** `apis` | protocol/auth/exposure |
| **identity_system** | absent (`identity`=accounts, different concept) | new `asset_type` + detail | **yes** `identity_systems` | idp_vendor/protocol |
| **business_process** | nearest `business_service`/`unit`/`department` enum | `enterprise_entities` enum add + optional detail | no (v1) | rto/rpo/owner_dept (later) |

New heavy types follow the ECL **S0 rule** (load-bearing attributes are typed columns in a typed
child, never JSON) — precedent cost = 1 detail table + 1 RLS migration each, exactly like
`enterprise_data_stores`.

---

## 3. Reuse / generalize / rewrite map

Legend: **REUSE** = unchanged; **GENERALIZE** = small additive change to widen scope;
**WRAP** = keep, expose behind the registry; **NEW** = net-new; **REWRITE** = none recommended.

### 3.1 Models (tables)

| Existing | Disposition | How |
|---|---|---|
| `vendors`, `ai_systems` | **WRAP** | Add nullable `asset_id`; register on write + backfill. Zero attribute change. |
| `enterprise_entities` (+ `enterprise_data_stores`) | **GENERALIZE** | Becomes the generic Tier-1 backing for lightweight types; add `asset_id`; extend `entity_type` enum for `business_process` when needed. |
| `signal_match_suggestions`, `applicability_assessments`, `applicability_affected_entities` | **GENERALIZE** | Add nullable `asset_id` alongside `(target_type,target_id)`; stop growing the quartet enums (EAR-AD-3). |
| `signal_*_links` (4 tables) | **WRAP** | Keep as authoritative typed edges (ECL AD-13); expose a `signal_asset_links` **view** unifying them by `asset_id`. New links can target `asset_id` generically. |
| `enterprise_relationships` | **REUSE** | Already the general edge substrate; its endpoints resolve to `asset_id` via the registry. |
| `findings`, `actions`, `evidence` | **REUSE** | Their `(source_type,source_id)` already spans assessments/risks/signals; add asset-sourced values as additive enum entries (precedent: R2 added `applicability_assessment`). |
| `risks`, `risk_treatments`, `risk_*_links`, lifecycle/approvals | **REUSE** | Risk stays its own object (a risk is *about* assets, not an asset). Link risks to `asset_id`. |
| `dependencies`, `ai_system_vendor_dependencies` | **WRAP** | Typed edges stay authoritative (AD-13); optionally surface as relationships keyed by `asset_id`. `dependency_type='api'` is the seed for the `api` asset type. |
| `assets` | **NEW** | The Tier-0 registry (thin). |
| `cloud_resources`, `endpoints`, `apis`, `identity_systems` | **NEW** | Tier-1 detail tables for the currently-absent types. |

### 3.2 APIs

| Existing | Disposition | How |
|---|---|---|
| `vendors`, `aiSystems`, `controls`, `obligations`, `dependencies`, `enterpriseEntities` routes | **REUSE** | Per-type CRUD stays. On write, also register the asset (one shared helper). |
| `enterpriseContextStats` (R6) | **GENERALIZE** | Today counts `enterprise_entities` only — asset-incomplete. Repoint at `asset_registry_v` so "assets" spans **all** types. |
| `applicabilityAssessments`, `enterpriseGraph`, `enterpriseRelationships` | **GENERALIZE** | Accept/emit `asset_id`; resolver seeds from the registry. |
| `signalMatchSuggestions` | **REUSE** | Already polymorphic over 4 target types via `TARGET_DISPATCH`; extend that map from the asset-type spec instead of hard-coded cases. |
| **NEW** `GET /api/assets`, `/api/assets/:id` | **NEW** | The unified cross-type list/detail over `asset_registry_v` (capability-gated, `asTenant`). Per-type pages remain. |
| **NEW** `POST /api/connectors/:id/sync` (+ worker) | **NEW** | The deferred connector HTTP surface → `planImport` → registry. |

### 3.3 Workflows / assessments

| Existing | Disposition | How |
|---|---|---|
| 5 bespoke assessment stacks + `vendor_reviews` | **REUSE (now); GENERALIZE (Track B)** | Keep as-is for the registry work. Separately (own epic): a generic asset-assessment service keyed by `asset_id` that emits `findings`, collapsing the near-clones. Not required by the registry. |
| Risk lifecycle / approvals / treatments | **REUSE** | Unchanged; link to `asset_id`. |
| Applicability R3 worker | **GENERALIZE** | Replace the `GRAPH_REPRESENTABLE` hard-code (2 sites) with `assetTypeSpec.graphRepresentable`; plan/assess any `isRiskTarget` asset type. |

### 3.4 Connectors, signals, reports, UI

| Existing | Disposition | How |
|---|---|---|
| 9 connector adapters (dark) | **REUSE** | Already normalize to the import shape. Their `entity_type` outputs map 1:1 to asset types (`asset→endpoint/generic`, `data_store→database`, `identity→identity accounts`, plus `cloud_resource` for wiz/cloud). Wire the sync route (§3.2). |
| Signal matcher | **GENERALIZE** | Replace per-branch hard-code with `assetTypeSpec.matchStrategy`. This is what finally **converges the connector and matcher planes** (§1.3): connector-ingested assets become matchable. |
| `cyber_signals`, normalizer, `signal_*_links`, applicability engine | **REUSE / GENERALIZE** | Engine is already type-generic; only the two hard-codes (1.4) block it. |
| Posture engine | **REUSE** | Consumes `findings`/`risks` — already asset-agnostic. Gains completeness for free as more asset types produce findings. |
| Intelligence Brief | **REUSE (isolated)** | Signals-only lane by design; unaffected. Optional later: let the Brief cite asset applicability (a convergence opportunity, not required). |
| Exec/gap/audit reports, dashboards, posture UI | **GENERALIZE** | Repoint asset counts/rollups at `asset_registry_v`. |
| ECL UI kit (`shared.tsx`, `enterpriseContext*`) | **GENERALIZE → design system** | Promote to a cross-domain kit; a generic asset list/detail/form scaffold; converge the ~20× duplicated badges/stat-cards/import flows. Nav already groups under **Assets / Compliance / Risk**. |

**No item in the inventory requires a rewrite.** Every path is reuse, a small additive
generalization, or net-new for the genuinely-absent types.

---

## 4. Phased migration plan (minimize churn · backward-compatible · flag-dark)

Every phase is additive, ships behind `SECURELOGIC_ASSET_REGISTRY_ENABLED` (default off, the ECL
posture), leaves `main` frozen, and performs no production enablement (GATE B continues).

### Phase 0 — Contract & read-only view (ZERO base-table churn)
- Define `AssetType`, `AssetRef`, `CanonicalAsset` (code) + the asset-type capability spec.
- Ship `asset_registry_v` as a SQL **VIEW**: `vendors ∪ ai_systems ∪ enterprise_entities`
  projected to the canonical header. No new base table; no writes; nothing else changes.
- Payoff already: one unified cross-asset **search/list** and a single **graph-seed** surface;
  the R6 exec dashboard can count assets across all types.
- Exit: view returns correct unified rows in isolation tests; flag-gated `GET /api/assets` reads it.

### Phase 1 — Registry spine (ADDITIVE)
- `assets` table (Tier-0, thin) + nullable `asset_id` on `vendors`, `ai_systems`,
  `enterprise_entities` (additive `ADD COLUMN`).
- Shared `registerAsset()` helper on each write path (create → upsert registry row); idempotent
  one-time backfill for existing rows. Inert RLS + `dataClassification` registration per convention.
- Repoint `asset_registry_v` identity source to `assets`; the header still reads attributes from
  backing tables (EAR-AD-2 — no copy).
- **Backward compatible:** `asset_id` nullable; every existing `(type,id)` reference untouched.
- Exit: 100% of live rows have a registry entry; cross-org isolation + backfill idempotency tests green.

### Phase 2 — Generalize the chokepoints (ADDITIVE + behavioral, flag-gated)
- Replace `GRAPH_REPRESENTABLE` (engine + worker) with `assetTypeSpec.graphRepresentable`.
  → control/obligation can now reach `affected`; applications/databases/etc. gain blast radius.
- Make the matcher target set + strategy **data-driven** from the asset-type spec (no more
  per-type branches). → the connector and matcher planes converge (§1.3).
- Add nullable `asset_id` to `signal_match_suggestions` / `applicability_assessments`
  (alongside `(target_type,target_id)`); `signal_asset_links` **view** over the 4 typed link
  tables. Quartet CHECK enums stop growing (EAR-AD-3).
- **Backward compatible:** old columns/tables/values all still work; new behavior behind the flag.
- Exit: a control-typed and an application-typed signal reach `affected` end-to-end in tests;
  golden applicability suite still green for vendor/ai_system.

### Phase 3 — New asset types + connector activation (ADDITIVE)
- Onboard `cloud_resource`, `endpoint`, `api`, `identity_system` as registry asset types + Tier-1
  detail tables (S0 typed children where load-bearing); `business_process` via `enterprise_entities`
  enum + optional detail.
- Wire the deferred **connector sync route + worker** → `planImport` → registry. The 9 dark
  adapters light up: defender/falcon/tenable/qualys/rapid7 → `endpoint`; wiz/cloud_inventory →
  `cloud_resource`/`database`; identity_provider → identity accounts + `identity_system`.
- Exit: each new type round-trips create→list→graph→applicability; a connector sync produces
  registry assets under mock credentials.

### Phase 4 — UI consolidation (ADDITIVE, no data change)
- Promote the ECL `shared.tsx` kit to a cross-domain design system; a generic asset
  list/detail/form scaffold; converge the ~20× duplicated badges/stat-cards/import flows.
- A unified **Assets** surface (all types) beside the retained per-type pages; nav already groups
  under Assets.
- Exit: per-type pages render via the shared kit; app typecheck + unit + knowledge-index green.

### Phase 5 — Output completeness & optional convergence (ADDITIVE)
- Posture / exec / gap / audit reports + dashboards consume `asset_registry_v` → asset-type-complete.
- Optional: Brief cites asset applicability (closes the signals-vs-posture isolation, if desired).
- Exit: exec dashboard asset totals reconcile against per-type counts across all types.

**Adjacent tracks (independent, can ride alongside — not blockers):**
- **Track A — finish `asTenant` adoption** on vendors/aiSystems/controls/obligations/actions + the
  4 unwrapped assessment routes (tenant-isolation hardening).
- **Track B — generic asset-assessment service** collapsing the 5 bespoke stacks (own epic).
- **Track C — gating unification** — move core domain routes from `requireEntitlement("premium")`
  to per-org `requireCapability` (the platform-correct model, already proven by the ECL).

---

## 5. What NOT to do (guardrails)

- **Do not** subsume `vendors`/`ai_systems` into a mega-table (reverses ECL AD-1; breaks matcher,
  5 assessments, 4 links, posture, UI).
- **Do not** drop `signal_*_links`, `dependencies`, or `ai_system_vendor_dependencies` (ECL AD-13 —
  typed edges stay authoritative; expose views instead).
- **Do not** copy `name`/`criticality`/`owner` into the registry (EAR-AD-2 — read via the view; a
  copy re-introduces exactly the drift AD-1 warned about).
- **Do not** block the registry on assessment-engine consolidation (Track B is a separate epic).
- **Do not** enable anything in production — the whole initiative stays flag-dark (GATE B),
  matching the ECL posture.

---

## 6. Why this is the right sequence

- **Phase 0 delivers value with zero base-table risk** — a unified asset view is useful the day it
  ships and is trivially reversible (drop a view).
- **The registry is additive identity, not migrated data** — backward compatibility is structural,
  not best-effort: nothing that references `(type,id)` today changes.
- **The two hard-codes (1.4) are the real capability unlock** — generalizing them is what turns
  "8 enum values" into "any asset type can be matched and reach a blast-radius decision," and it is
  a Phase-2 refactor of ~three call sites, not a schema migration.
- **It finishes the ECL rather than competing with it** — the registry is `enterprise_entities`'
  header/child pattern generalized; the applicability engine, connectors, graph, and R6 stats
  endpoint already speak `(type,id)` and simply start speaking `asset_id`.
