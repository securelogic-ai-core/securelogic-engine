# BUILD_SEQUENCE.md

## Purpose
This document defines the build order for SecureLogic AI. It exists to stop architectural drift, local optimization, and out-of-sequence package work.

## Governing documentation hierarchy
These are the controlling operational documents and their scopes. Each owns a
distinct concern — consult the one that matches the question rather than
duplicating content across them:

1. **BUILD_SEQUENCE.md** (this file) — program roadmap, build order, and the
   implementation record (what shipped, in what order, under which PR/SHA).
2. **EAR / ERIP trackers** (`docs/validation/enterprise-asset-registry-tracker.md`,
   `docs/validation/erip-tracker.md`) — per-item implementation **status**
   (built / merged / done) and the evidence trail.
3. **Enablement Runbooks** (`docs/architecture/enterprise-asset-registry/ENABLEMENT-RUNBOOK.md`,
   `docs/runbooks/intelligence-events-enable-rollback.md`, and peers) — the
   step-by-step **operator procedures** to enable, validate, and roll back a
   specific goal in staging.
4. **Feature Flag Enablement Matrix** (`docs/runbooks/FEATURE-FLAG-ENABLEMENT-MATRIX.md`)
   — the authoritative cross-cutting reference for **every feature flag**: its
   **service ownership** (which of App / Engine / Intelligence Worker requires
   it, and why), **environment-variable defaults**, **staging enablement**
   order + exact service names, **validation sequencing**, **rollback
   guidance**, and the **GATE B operational controls** (dark-by-default posture,
   no production enablement without an operator ruling). It answers the single
   question "which service needs this flag?" and is the map that sits above the
   per-goal runbooks (which own the deep validation detail). Grounded in
   `render.yaml` + the actual flag reads; it is documentation only and enables
   nothing.
5. **Architecture Decision Records / design docs** (`docs/architecture/**`,
   `ARCHITECTURE_REVIEW.md`, the ratified `*-ARCHITECTURE.md` blueprints) —
   technical **design decisions** and their rationale.

These sit under the canonical product/build governing set declared in `CLAUDE.md`
(PRODUCT_VISION → CURRENT_STATE_ARCHITECTURE → CANONICAL_DOMAIN_MODEL →
TENANT_ISOLATION_STANDARD → BUILD_SEQUENCE → FINAL_PRODUCT_STANDARD → CLAUDE.md).

## Execution rules
- Build one package at a time.
- Do not infer the next package from convenience.
- Do not broaden scope beyond the active package.
- Do not commit without explicit authorization.
- Stop after package completion and present exact commit scope.
- Keep the current working tree and these docs aligned.

## Environment and release discipline
SecureLogic AI uses:
- Production for live customer operations
- Staging for pre-production validation
- Demo for presentation and seeded showcase use

Release rules:
- all production-bound work must be validated in Staging first
- Demo is not a substitute for Staging
- no production release decision should be based solely on Demo behavior
- seeded demo data belongs in Demo unless a non-production seed package explicitly targets another environment

Release gates (must be cleared before any `develop → main` promotion):

> **Re-baseline note (2026-07-21):** for the current re-baselined Sprint-1 promotion, the
> F-1 check below is executed across the **full 65-file staged set** via
> `docs/launch/PART_B_PREFLIGHT.md` §1.5 (the `20260706` file itself is already applied to
> production via the archived 2026-07-02 promote). The F-1 principle is unchanged and
> applies to every future promotion.

- **F-1 — migration `20260706_risk_numeric_score.sql` not previously applied.**
  The migration runner is filename-keyed (`scripts/runMigrations.ts`): a
  reshaped migration whose filename already exists in `schema_migrations` is
  silently skipped. PR #382 (merged to `develop` as `4d0d984e`) reshaped this
  same migration after its first commit. Before promoting, confirm
  `SELECT count(*) FROM schema_migrations WHERE filename='20260706_risk_numeric_score.sql'`
  returns 0 in **staging** and **prod**. Non-zero ⇒ do not promote as-is;
  add a follow-up re-stamp migration or re-apply in a controlled way.
  Owner: operator (DB credentials required; not runnable from CI/dev shell).

## Current strategic phase
Phase: Product hardening from strong foundations into enterprise-ready intelligence operations

This phase assumes:
- foundational domain objects materially exist
- major workflows materially exist
- read surfaces exist in several areas
- the next work must prioritize signal quality, tenant isolation, product coherence, and enterprise operating readiness

## Completed foundation categories
These categories are treated as materially established:
- core domain primitives
- workflow layer across vendor, AI governance, obligation, dependency, and risk treatment areas
- core summary/read surfaces
- basic intelligence brief generation path
- several route integration and helper test packages

## Current commercial alignment
The commercial model that all future product and packaging work must respect is:
- Intelligence Brief — Free
- Brief Pro
- Brief Team
- Platform Professional
- Enterprise

Billing note:
- Platform Annual is not a product tier; it is the annual billing option for Platform Professional

## Active governing program (2026-07-06): Enterprise Risk Intelligence Platform (ERIP)

> **Program update (2026-07-06 — supersedes the workstream updates below as the statement of
> what is ACTIVE; prior entries are preserved as dated history, not erased.)**
> The **Enterprise Asset Registry (EAR) goal is COMPLETE** — P0–P11 shipped dark to `develop`
> as PRs #496–#510 (develop `7a81f857`; record: `docs/validation/enterprise-asset-registry-tracker.md`
> + `docs/validation/enterprise-asset-registry-final-report.md`; those documents are the
> preserved historical record and must not be rewritten). The **Enterprise Risk Intelligence
> Platform (ERIP)** is now the **active governing engineering program**, with the completed
> EAR recorded as its **Epic 1 ✅**. Authoritative roadmap:
> **`docs/architecture/enterprise-risk-intelligence-platform.md`** — Epics: 1 EAR ✅ ·
> 2 Enterprise Discovery & Connectors · 3 Enterprise Risk Intelligence · 4 Executive
> Intelligence · 5 Predictive Intelligence · 6 Autonomous Operations · 7 Enterprise Knowledge
> Graph / Digital Twin. Living tracker: `docs/validation/erip-tracker.md`. Every future
> implementation must reference that roadmap. Governance unchanged: develop-only (`main`
> frozen), dark launches (flags default off, no production enablement — GATE B), additive
> migrations only, tenant scoping everywhere, reuse before rewrite, per-epic design memo
> before implementation, operator actions ledgered never executed. The two pre-declared
> product decisions from Epic 1 (GATE B prod enablement; P9 entitlement-leg cutover) remain
> reserved for the operator and are NOT part of ERIP.

> **EAR P12 follow-on — COMPLETE (2026-07-07; additive to the P0–P11 record above, which is
> preserved unchanged).** The **Enterprise Asset Registry Management UI (P12) is COMPLETE**,
> shipped dark to `develop`: **#541** (`f2741b01`) management UI — create/edit/archive/delete for
> the four detail-backed types + federated entry points (EAR-AD-1) — with canonical-surface nav;
> **#543** (`09239f84`) revising the "Assets" menu to a **single canonical entry**; **#542**
> (`f926b960`) making the Enablement Runbook Step 1 self-contained. **Final `develop` SHA:
> `09239f84`.** The **Enterprise Asset Registry is now the canonical asset management experience**:
> when `SECURELOGIC_ASSET_REGISTRY_ENABLED` is on, the "Assets" nav exposes only **Asset
> Registry**. **Vendors and AI Systems are managed as asset types/filters INSIDE the registry, not
> as primary navigation**; their legacy direct routes (`/vendors`, `/ai-systems` and children)
> remain for backward compatibility (and stay in the knowledge index with their platform access).
> All of it remains **dark behind `SECURELOGIC_ASSET_REGISTRY_ENABLED`** (default off; flag-off nav
> is byte-for-byte the legacy `[Vendors, AI Systems]` menu) — **no production enablement; GATE B in
> effect.** Consistent with: `docs/validation/enterprise-asset-registry-tracker.md` (P12 row →
> DONE), `docs/validation/erip-tracker.md` (Epic 1 EAR ✅), the Enablement Runbook Step 1, and the
> EAR/ERIP final reports (P0–P11 records unchanged; P12 is a post-close follow-on, not a rewrite of
> Epic 1 scope).

> **EAR P13 follow-on — COMPLETE (2026-07-07; additive to the P0–P11 / P12 record above, which is
> preserved unchanged).** **P13 = Setup Wizard ↔ Asset Registry onboarding integration + the
> canonical "Connect Enterprise Systems" page** — shipped dark to `develop` as **#545**
> (`03b753d9`). **Create, Import, and Connect Enterprise Systems are all available through the
> single canonical Asset Registry onboarding flow** (`/assets/new` → create manually / import CSV /
> connect; the new `/assets/connect` lists the connector catalog with live status from
> `GET /api/connectors`). The **Setup Wizard (`/getting-started`) reuses that same flow** — when
> `SECURELOGIC_ASSET_REGISTRY_ENABLED` is on, wizard step 2 becomes "Build your asset inventory"
> and its CTA launches `/assets/new`; the wizard owns no separate onboarding logic (one canonical
> implementation, no duplication). **SOC upload and analysis remain under Vendor Management** — they
> are deliberately NOT in this flow. The feature stays **dark behind
> `SECURELOGIC_ASSET_REGISTRY_ENABLED`** (connectors additionally double-fenced behind
> `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`); flag-off is byte-for-byte the legacy vendor step and
> the neutral panels — **no production enablement; GATE B in effect.** Remaining work is
> **operator-only: staging validation (Enablement Runbook Step 1), connector credentials
> (operator-owned, ledger L-5.*), and the GATE-B production-enablement ruling.** Consistent with:
> `docs/validation/enterprise-asset-registry-tracker.md` (P13 row → DONE), the Enablement Runbook
> Step 1 (Connect + Setup-Wizard bullets), and the EAR/ERIP final reports (P0–P11 unchanged).

> **EAR P14 follow-on — COMPLETE (2026-07-08; PR #549, additive to the P0–P13 record above, which is
> preserved unchanged).** **P14 = one canonical Asset Registry asset-creation flow** — shipped dark
> to `develop` as **#549** (squash `3fc927ec`; `develop` head now `3fc927ec`; branch deleted).
> Collapses the prior two/three-step type re-selection into **choose the type once → land on the
> right Create screen with the type preselected and LOCKED**. A single routing helper
> (`app/src/lib/assetRegistry.ts` `assetCreateHref`) is used by the `/assets` list "+ Add" button
> (now carries the active type filter + labels by type) and the `/assets/new` picker: detail-backed
> types (cloud_resource/endpoint/api/identity_system) render the native inline type-aware form;
> application/database/business_process open Add-Entity with `entity_type`+`asset_type` preselected
> and locked, titled by asset type ("Create Database"); vendor/ai_system open their dedicated screens
> **framed as registry flows** via `?from=registry` + a **shared `CreateFlowBackLink`** breadcrumb
> (AI System refactored to the Vendor server-wrapper pattern — **token-only gate preserved, no access
> regression**; no duplicated breadcrumb). **`business_process` promoted to a first-class
> `enterprise_entities.entity_type`** so a record lands as its own type instead of collapsing to
> `generic` — **additive, non-destructive migration `20260827`** (widen entity_type CHECK + repoint
> `asset_registry_v`; `ENTITY_TYPE_TO_ASSET_TYPE` + engine/app `ENTITY_TYPES` + labels in lockstep).
> **Deferred (documented, not faked):** typed children for `business_process` (rto/rpo/owner_dept)
> and `application` (tech stack/hosting) — each one detail table + RLS migration per the ECL S0 rule.
> Stays **dark behind `SECURELOGIC_ASSET_REGISTRY_ENABLED`** (+ `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
> for the ECL-backed types); **flag-off byte-identical; no render.yaml change; GATE B in effect — no
> production enablement.** EAR-AD-2 preserved (registry spine identity-only). **CI 8/8 green**
> (incl. cross-org-isolation). Docs: `docs/architecture/enterprise-asset-registry/CANONICAL-ASSET-CREATE-FLOW.md`,
> `ARCHITECTURE.md` §2.3. Consistent with the P14 row in
> `docs/validation/enterprise-asset-registry-tracker.md`. **Remaining work is operator-only:
> staging validation, and the GATE-B production-enablement ruling.**

> **EAR P15 follow-on — COMPLETE (2026-07-08; folded into the P14 PR, additive to P0–P14 which are
> preserved unchanged).** **P15 = the canonical Asset Registry create surface (`/assets/new`) now
> exposes the THREE onboarding methods as co-equal, first-class options:** **(1) Create manually**
> (federated per-type picker — native inline form for the four detail types, `assetCreateHref`
> federation for the rest), **(2) Bulk upload** (reuses the EXISTING CSV/XLSX importers via
> `assetImportSurfaces()` — `/vendors/import`, `/ai-systems/import`, ECL-fenced
> `/enterprise-context/import`; **no duplicate importer** — preview/validation/de-dup/row-errors/plan
> caps all stay in those surfaces), and **(3) Connect enterprise systems** (reuses the EXISTING
> `/assets/connect` connector catalog, EAR Phase 3b — **linked directly, never "coming soon"**).
> Driven by the pure, unit-tested `assetOnboardingMethods()` helper. **SOC upload stays under Vendor
> Management** — deliberately absent from Asset Registry onboarding. **Flag-off unchanged** (registry
> off → neutral panel, no sections; ECL importer + connectors additionally ECL-fenced). **UI verified
> by an SSR render** (all three sections emitted; import + `/assets/connect` hrefs present). No
> engine/schema/flag/`render.yaml`/operator change; GATE B untouched. Docs:
> `docs/architecture/enterprise-asset-registry/CANONICAL-ASSET-CREATE-FLOW.md`; P15 row in
> `docs/validation/enterprise-asset-registry-tracker.md`.
>
> **EAR P16 follow-on = Unified Enterprise Asset Import — COMPLETE (2026-07-08; merged to `develop`
> via PR #551, squash `1bc2ccf3`; additive to P0–P15, which are preserved unchanged).** **P16 finishes
> the two onboarding methods P13/P15 only stubbed, so the canonical Asset Registry create surface
> (`/assets/new`) now supports all THREE canonical onboarding methods end-to-end: (1) Create Asset,
> (2) Bulk Upload / Import Assets (the unified `/assets/import` flow), and (3) Connect Enterprise
> Systems. The Setup Wizard reuses this SAME onboarding flow (its CTA launches `/assets/new`).**
> **(1) Connect Enterprise Systems** was a read-only status board — P16 adds the admin-gated config
> path (`/assets/connect/[id]` + `ConnectorConfigForm`) reusing the EXISTING mutation endpoints
> (`PUT`/`DELETE /api/connectors/:id`, `POST /:id/sync` — only app wrappers + Next proxies were
> missing); non-admins get a clear gated message, and `requireAdminRole` now enforces admin-only
> config on the engine (catalog read stays open; API keys bypass). **(2) Bulk upload** covered only
> 4 of 10 real types — P16 adds a unified `/assets/import` (one flow, all 10) via the **hybrid**
> chosen approach: extend the ECL bulk endpoint for `business_process` (reuses
> `validateEnterpriseEntityCreate`) + a thin `POST /api/assets/import` for the four detail-backed
> types that reuses the shared parser, the EXTRACTED generic `planRows` precedence, the existing
> `validateAssetDetailCreate`, and the existing `createDetailAsset` lane — **no new tables /
> validators / migrations, no duplicated importer logic.** **Taxonomy is the 10 REAL canonical types
> only** — `data_store`/`custom` are UI aliases of `database`/`generic`; **`server` / `network_device`
> / `facility` do NOT exist and are deferred to a future backend package**
> (`FUTURE-ASSET-TYPES.md`), never aliased or faked. Legacy `/vendors/import` + `/ai-systems/import`
> preserved unchanged; **SOC upload stays under Vendor Management.** Setup Wizard reuse path unchanged
> (its CTA still launches `/assets/new`, which now carries the finished flows). **Vendor and AI assets
> route through the unified importer** (`assetImportOptions()` maps them to the ECL bulk endpoint with
> `entity_type` `vendor`/`ai_system`), so they onboard through the same one flow as every other type.
> **`server` / `network_device` / `facility` remain documented as a FUTURE taxonomy package — not
> implemented, never aliased/faked** (`FUTURE-ASSET-TYPES.md`). **Sequencing note:** this is a
> deliberate REOPEN of the completed EAR Epic 1 onboarding (recorded as a P13/P15 follow-on), NOT the
> active `Priority 4 — Signal Ingestion Hardening` package. **Engine-side `requireAdminRole` remains in
> place for connector management** (`PUT`/`DELETE /api/connectors/:id`, `POST /:id/sync`; catalog read
> stays open; API keys admin-level bypass). **All functionality remains dark behind the appropriate
> feature flags — flag-off byte-identical** (`SECURELOGIC_ASSET_REGISTRY_ENABLED` default off; ECL-backed
> import types + connectors additionally `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`-fenced; connector
> mutations additionally admin-only). No `render.yaml`/env/flag change; **GATE B remains intact — no
> production enablement.** **Remaining work is operator-only:** (1) staging feature-flag enablement,
> (2) connector credential configuration, (3) staging validation, (4) production enablement after
> successful validation. Docs synchronized: P16 tracker row, `FUTURE-ASSET-TYPES.md`, runbook Step 1,
> `CANONICAL-ASSET-CREATE-FLOW.md`, `CANONICAL_DOMAIN_MODEL.md` entity_type list corrected.

> **Enterprise Risk Graph (ERG) convergence — C0–C3b COMPLETE (2026-07-10; merged to
> `develop`, additive to all records above which are preserved unchanged).** A dark,
> additive convergence program that routes external intelligence toward canonical
> **tenant assets** via the **existing** `ApplicabilityEngineV1` — *convergence and
> measurement, NOT a rebuild, NOT a retirement.* Authoritative design + measurement
> docs: `docs/architecture/proposals/ENTERPRISE-RISK-GRAPH.md` (rulings R1–R3),
> `CONVERGENCE-ROADMAP.md`, and `CONVERGENCE-REPORT.md` (**the single source of the
> convergence metrics — not duplicated here**); `docs/specs/finding-lifecycle-spec.md`
> (ratified two-axis lifecycle, no implementation yet).
>
> **Shipped phases (all on `develop`, all dark, flag-off byte-identical):**
> - **C0 — governance (PR #597, `c4b0d719`):** ratified the ERG architecture, rulings
>   R1–R3, roadmap, finding-lifecycle spec, and canonical-model doc-sync. Foundational.
> - **C1 — Canonical Product normalization core (PR #598, `ffc1cd0c`) + C1b migration
>   (PR #599, `6ca79325`):** the global, organization-neutral Canonical Product
>   reference (identity + aliases + external ids + versions), pure normalizer.
>   Foundational.
> - **C2 — asset applicability target (re-scoped) (PR #600, `3c4378f4`):** the `asset`
>   applicability target was **already shipped** (migration `20260804`), so C2
>   **reused** it rather than duplicating — adding only the route read-set + a WORM-safe
>   `asset_id` FK fix. No Canonical Product rebuild.
> - **C2b — Canonical Product → Tenant Asset Resolver (PR #601, `2c9cdd33`):** a
>   reusable, **organization-scoped**, source-agnostic resolver. Ambiguous matches
>   resolve to **`needs_review`** (never guessed); vendor-only / no-product-name inputs
>   also `needs_review` (R2). Writes nothing.
> - **C3 — applicability(asset) vs legacy shadow (PR #602, `d3d6f83b`):** the shadow
>   comparison of the product→asset resolution against the legacy asset match, behind
>   `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED`; counts-only `signal_applicability_shadow`
>   telemetry; surfaces nothing.
> - **C3b — vendor/ai_system → asset grain (PR #603, `83340aff`):** extended the SAME
>   shadow framework (same comparator, resolver, flag; telemetry gained a `grain`
>   field — no parallel framework, no schema) to **vendor → asset** and
>   **ai_system → asset**.
>
> **Architectural outcome:** the **legacy vendor linkage and legacy AI-system linkage
> remain AUTHORITATIVE.** The shadow implementation is **dark, read-only, additive,
> try/catch-isolated, and flag-off byte-identical** — it writes nothing to authoritative
> applicability / vendor links / ai-system links / findings / asset-registry records.
> **No retirement occurred. No cutover occurred. No production enablement occurred.**
>
> **Deployment state — `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED`:** default **false**;
> **shadow-only** (sub-mode `SECURELOGIC_SIGNAL_APPLICABILITY_MODE` defaults to
> `shadow`; `surface` unbuilt). A **staging operator MAY enable it on engine-staging for
> telemetry collection**; **production is untouched** and **GATE B is unchanged** — no
> `render.yaml`/env/flag change was made by this program.
>
> **Remaining work.** *Operator-owned:* enable the shadow on **engine-staging** → execute
> a representative ingestion window → collect the `signal_applicability_shadow` telemetry
> (grouped by `grain`) → produce the convergence report from `CONVERGENCE-REPORT.md`.
> *Architecture-owned:* an **explicit retirement decision after convergence is measured**
> — **no implementation is implied** by these records; the legacy path stays authoritative
> until a ratified cutover.
>
> **Sequencing note:** ERG convergence is a **dark, additive program distinct from** the
> active `Priority 4 — Signal Ingestion Hardening` package below; it did not change the
> active package.

> **The Briefing Initiative — operator-directed program registered 2026-07-21; phase B1
> COMPLETE (shipped dark to `develop`, additive to all records above, which are preserved
> unchanged).** A phased program (B1 foundation → B2 role-aware defaults + personalization →
> B3 profiles → B4 organizational Briefings → B5 intelligent Briefing) transforming the
> generic `/dashboard` into **The Briefing** — a personalized, scope-explicit opening
> experience — while keeping Operational Views and Dashboards distinct first-class surfaces
> (the read-surface taxonomy is now an explicit standard: `FINAL_PRODUCT_STANDARD.md`
> §Product standards 5). Authoritative decision record: `docs/specs/briefing-initiative-b1-spec.md`.
> **B1 (VERIFIED, operator-approved):** canonical module registry + eligibility resolver +
> composer (`app/src/lib/briefing/`), The Briefing composition on `/dashboard`
> (`app/src/app/dashboard/briefing/`), workspace-nav home label **"Briefing"**
> (operator-ratified; legacy `NAV_ITEMS` + Application Knowledge Index byte-identical) —
> **app-only, zero engine surface, zero schema, no migration**; module data reuses the
> existing Metric Contract endpoints (dashboard/findings/actions summaries, incl. the
> previously-unused session-scoped `my_*` counts). B1 deliberately IGNORES the legacy
> `dashboard_preferences` rows (flag-off keeps them untouched); the ratified
> `legacyTileToModule()` projection is B2's migration key. **Dark behind
> `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED`** (app prod `"false"`, app staging `"true"` in
> `render.yaml`; flag-off byte-identical; rollback = flag off) — **GATE B in effect, no
> production enablement.** Validation: full app suite green (83 files / 1105 tests incl. the
> mandatory entitlement-branch render test), engine knowledge-index + workflow drift tests
> green, `next build` green; no engine SQL changed → no isolation-lane additions.
> **Sequencing note:** operator-directed program distinct from the active
> `Priority 4 — Signal Ingestion Hardening` package below; it did not change the active
> package. **B2 is NOT authorized** — starting it requires separate operator approval, and
> its hard precondition is an engine-side module manifest GENERATED from the registry
> (drift-tested) before any write path accepts module ids.
> **B1 hardening follow-on — COMPLETE (2026-07-21, operator-directed; additive).** The B2
> hard precondition is **DISCHARGED**: `src/api/lib/briefingModuleManifest.generated.ts` is
> generated from the app registry (`npm run generate:briefing-manifest`) and drift-tested
> (`src/api/tests/briefingModuleManifest.test.ts`); validation surface
> `briefingModuleManifest.ts` is INERT (no route imports it) until B2's write path consumes
> it. The triplicated ACTIVE-actions client fallback is centralized in
> `app/src/lib/actionsMetrics.ts`. `SECURELOGIC_INDEPENDENT_REVIEW_ENABLED` remains
> operator-owned (deliberately NOT Blueprint-claimed by B1 — another feature's rollout);
> staging validation of the My Pending Reviews module requires the operator to enable it.
> B2 authorization state unchanged at that point: NOT authorized (superseded below).
>
> **B2 — role-aware defaults & personalization: COMPLETE (operator-authorized 2026-07-21;
> built same day, dark, additive).** Authoritative decision record:
> `docs/specs/briefing-initiative-b2-spec.md`. Per-user Briefing layout persistence:
> `briefing_layouts` (migration `20260721`; canonical NULLIF RLS + `app_request` grants;
> one row per org+user via the NAMED constraint `briefing_layouts_one_per_user` — B3 relaxes
> it additively); engine surface `GET/PUT/DELETE /api/briefing/layout` dark behind
> `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` on the ENGINE services (engine half of the
> two-switch; prod `"false"`, staging `"true"` in `render.yaml`; chain
> `requireApiKey → attachOrganizationContext → requireEntitlement("premium")` + viewer-
> mutation block + `asTenant`; layout envelopes validated against the generated engine
> manifest — its first consumer, discharging the B1-hardening precondition's purpose).
> Role-aware defaults are code, not rows (computed at request time per role; never
> persisted implicitly); deterministic dismissible suggestions; legacy
> `dashboard_preferences` migrate via lazy read-time `legacyTileToModule()` projection with
> a disclosure banner — persist-on-save only, no bulk migration, no writes to the legacy
> table. GDPR: `briefing_layouts` added to the account-deletion reaper's per-user delete
> block, plus a clearly-marked rider fixing the pre-existing `finding_saved_views` erasure
> gap (`docs/DATA_CLASSIFICATION.md` updated; preference objects remain excluded from the
> data-rights export, consistent with existing policy). Validation: engine suite green
> (375 files / 6449 tests), isolation lane green incl. new `briefingLayouts` cross-org/
> cross-user + RLS fail-closed tests, app suite green (85 files / 1133 tests), typecheck +
> `next build` green on both surfaces; flag-off remains byte-identical; rollback = flag off.
> **GATE B unchanged at that point — no production enablement**; the `/posture`
> analytical-home gap (B1 weakness recorded in the B2 spec) had to be resolved before the
> Briefing prod flip (resolved below — read-surface D1, superseding this blocker).
> **B3 (profiles) is NOT authorized** — starting it requires separate operator approval.
>
> **D1 — read-surface architecture / GATE B closure: COMPLETE (operator-ratified & shipped
> 2026-07-21). The GATE B architectural blocker for `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED`
> is CLOSED.** Authoritative decision record: `docs/specs/read-surface-architecture-spec.md`
> (Status: RATIFIED & IMPLEMENTED; committed together with the implementation). Diagnosis
> was missing-destination, not taxonomy: nine analytical capabilities, layout customize, and
> the Executive Report PDF export existed ONLY on the flag-off `/dashboard`, so enabling the
> Briefing removed them from the product. D1 (app-only; no schema, engine, or flag change):
> `/posture` is now the canonical **Posture Dashboard** — a fixed canonical analytics
> composition (`PostureAnalyticsGrid`, reusing the existing `DashboardCharts` components
> 1:1; deliberately NO per-user customization — dashboards are shared organizational truth,
> personalization is a Briefing property) plus the Executive Report export entry point and a
> flag-aware home back-link; the dark `WORKSPACE_NAV_ITEMS` gains a platform-gated
> **"Posture"** link (legacy `NAV_ITEMS` + Application Knowledge Index untouched); the B2
> migration-disclosure copy now truthfully states tile parity. The legacy flag-off
> `/dashboard` stays byte-identical (it keeps its own export until it retires with the
> flag). **Exit criterion met: with the Briefing flag ON, no analytical capability, export,
> or destination is lost anywhere in the product.**
>
> **Completed engineering work (verified):** D1 shipped `develop` `a971f2a4`; B2
> (`11ee6b9e`) + D1 pushed to `origin/develop`; the CI audit lane (red since 2026-07-20 on
> an upstream `brace-expansion` advisory) restored by the lockfile-only, operator-authorized
> `b91fbdd5` (`npm audit fix`; 0 vulnerabilities) → **all 8 CI lanes green on `develop` HEAD
> `b91fbdd5`** (audit, build, lint, test, typecheck, cross-org-isolation, tenant-coverage,
> url-drift); **staging deploy VERIFIED** (app + engine `/version` = `b91fbdd5`; `/posture`,
> `/dashboard`, and the export endpoint live and auth-gated; engine `/api/briefing/layout`
> returns 401 = flag ON + auth enforced; app suite 85 files / 1138 tests, engine suite 375
> files / 6450 tests, both green).
>
> **Remaining operational approvals (operator-owned):** (1) authenticated staging
> walkthrough of the Briefing + Posture Dashboard (visual pass; automated sessions hold no
> staging credentials — promoted to formal Gate 6 by the 2026-07-21 re-baseline ruling D-D);
> (2) Sprint 1 Part B promotion gates 1–6 (`docs/launch/SPRINT_1.md`, **re-baselined
> 2026-07-21** — operator rulings D-A–D-E: the 2026-07-02 promote `512cfa5a` is the archived
> historical baseline, the prior main freeze is superseded, and the promotion object is the
> composite `develop` head via a single true merge; pre-flight evidence
> `docs/launch/PART_B_PREFLIGHT.md`) — prerequisite for any `develop → main` promotion.
>
> **Remaining production rollout activities (not started; each a separate operator
> ruling):** promote `develop → main` per `RELEASE_CHECKLIST.md`, then flip
> `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` on BOTH production services (engine + app —
> two-switch). **Production remains dark and is explicitly PENDING OPERATOR APPROVAL;
> nothing is enabled in production by this program.** **B3 (profiles) remains NOT
> authorized.**

## Active package

> **Reality-sync (2026-07-28, doc-sync package):** the row below is retained as history but no
> longer describes the live workstream. Priority 4 stalled after slices 4A.1(a)/(b) + A3
> (2026-06-26); the actual post-launch workstream on `develop` has been EAR Phase-1
> reconciliation, ERG Convergence C5, asset-search consolidation, and the EC entity-detail fix
> (#691). The 2026-07-28 Enterprise Architecture Review + Decision Review converted the open
> recommendations into the tracked register: **#692 (Commercial Integrity) → #693 (Canonical
> Path Truth) → #694 (Risk Governance Convergence, gated on ADR-0004) ∥ #695 (Trust
> Infrastructure, gated on ADR-0005) → #696 (Priority-4 resumption + IQP completion) → #697
> (Universal Finding v2 charter, gated on ADR-0006)** — that ordering is the recommended
> sequence of record pending operator ratification of the Proposed ADRs.
> Risk Lifecycle (R1+) note: code shipped dark in all environments while the spec remains
> "not yet authorized" — retroactive disposition is pending the operator ruling tracked in
> #694; the Backlog row below is superseded by that pending ruling.

> **Reality-sync (2026-08-12, seat-model doc-sync; docs only, no code changed):** the live
> workstream since the 2026-07-28 note has been the **Enterprise Seat / Role / Scoped-
> Authorization package**, now **shipped**: PR **#784** merged to `develop` @ `1cc39602`
> (2026-08-11; 15 commits, Phases 0–7 + 2 activation blockers + a release-review P1 fix).
> **Live enablement state (VERIFIED 2026-08-12 ~06:00 UTC):** `securelogic-engine-staging`
> runs `1cc39602` with `SECURELOGIC_SEAT_MODEL_ENABLED="true"` and in-process
> `seat.enforced: true` — **staging is actively enforcing the seat model, not dark**;
> staging DB at 207 migrations (all four seat migrations applied 02:45 UTC). Production is
> untouched: `main` @ `49691948` (the #756 release) **does not contain the package**, prod
> flag unset, prod DB at 203 migrations. Full record under Completed; flag mechanics in
> `docs/runbooks/FEATURE-FLAG-ENABLEMENT-MATRIX.md` §1.21.
> **Known drift (recorded, NOT backfilled by this sync):** this document has no entries
> between 2026-07-28 and this note — the #756 develop→main release (2026-08-11), EG2
> Wave-1, EDX W0/W1, IQ-1a, and the assignment-notification flag gate (#783) among them.
> That reconciliation is a separate doc-sync package; nothing here supersedes those
> programs' own trackers.

`Priority 4 — Signal Ingestion Hardening` — **status: STALLED at 4A.1+A3 (was: ACTIVE, authorized 2026-06-26); resumption tracked as #696.**

> **Active-workstream update (2026-07-04):** the live build workstream has moved to the
> **Enterprise Context Layer (ECL)** — authorized as the *Priority-5 foundation* (PRs #458,
> #459; distinct from BUILD_SEQUENCE's own "Priority 5 — Signal-to-platform linkage" numbering
> below, which is a different axis). ECL **Slices 1–10 are shipped dark to `develop`** (flag
> `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` off; nothing wired/enabled): S1 entities+data_stores,
> S2/S2b relationship graph + recursive resolver, S3 CSV import, S4a–c applicability engine +
> WORM decision store + writer, S5 explainability, S6 workflow-recommendation core, S7
> signal-linkage core, S8 connector framework + ServiceNow reference adapter, S9 Enterprise
> capability gating (GATE A ruled), S10 graph-resolver scale harness. **Remaining:** Item 7
> (UI/CX) and Item 11 (this governance-doc sync). Full item ledger and per-slice SHAs:
> `docs/validation/enterprise-context-goal-tracker.md`; operator actions:
> `docs/validation/enterprise-context-operator-ledger.md`. Priority 4's own B/C/D shipped-record
> reconciliation is tracked separately (PR #461) and is not restated here.
>
> **Completion update (2026-07-05):** Items 7 and 11 are now also DONE — the ECL goal's
> **build scope is complete (Items 1–11 all merged to `develop`, all dark)**. Item 7 (Tier-1
> UI/CX) shipped as five slices: #480 CI lane, #481 api client, #484 entity screens, #485
> relationships + graph view, #486 CSV import UI + fail-closed nav (`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
> now also declared `false` on `securelogic-app` — nav is the presentation half of the
> two-switch model). Nothing is enabled anywhere; prod enablement remains **GATE B**
> (runbook `docs/runbooks/enterprise-context-enable-rollback.md`). Recorded follow-ups:
> engine stats/rollup endpoint (then dashboards), Tier-2 read routes + surfaces, S6/S7 live
> adapters, remaining connector adapters, L-6 true-volume load run.

> **History (preserved):** this package was **BLOCKED (set 2026-06-25, operator-approved)** pending three technical prerequisites and a separate build-scope authorization. It was **unblocked on 2026-06-26** when all three prerequisites (#5/#6/#7) were satisfied **and** the operator authorized the build scope (the §10 decisions D1–D7 were operator-approved, PR #370; the implementation plan was accepted, PR #369). The prior BLOCKED decision is retained below as dated record, not erased.

The architecture for this work is **ratified** — see `docs/roadmap/external-signal-architecture.md` (status: *Architecture Ratified – Implementation Pending*), the approved architectural baseline, and the executable plan `docs/roadmap/priority-4-implementation-plan.md`. **Implementation is now authorized and has begun.** The design-vs-build distinction still holds: completing the Priority 3 *design* (`external-signal-architecture`, recorded under Completed) did **not** authorize the *build* — the build was authorized separately on 2026-06-26.

**Current status:** ACTIVE. All three technical prerequisites (#5/#6/#7) were SATISFIED and **exit criterion #4 (operator authorization of the Priority-4 build scope) was met on 2026-06-26.** Implementation is proceeding in small additive slices behind feature flags per the plan. **Slice 4A.1 is shipped to `develop` in two additive parts:** (a) the RSS-registry `kind` discriminator (PR #371 `feat/p4a-registry-kind`, commit `650d478d`, merged 2026-06-26) and (b) the four-stage contract stubs (PR #373 `feat/p4b-signal-contracts`, commit `483d83ff`, merged 2026-06-26). **Part (b) is now also promoted to PRODUCTION** — cherry-picked to `main` via PR #374 (merge commit `959951b9`; production `main` is now `959951b9`), and `develop` was reconciled via PR #375 (merge commit `e34ede8b`) so `develop` fully contains `main` (`origin/develop..origin/main = 0`). Strictly additive, no DB/config/behavior change; **CI 7/7 green** (audit, build, cross-org-isolation, lint, tenant-coverage, test, typecheck). **Naming note:** branch `feat/p4b-signal-contracts` is a misnomer — its content is Phase **4A** (slice 4A.1 contract stubs), **not** Phase 4B (source qualification); the PR title and file headers correctly say "4A.1 / P4 slice A1". **Priority 4 production footprint remains limited to the 4A.1 contract stubs — no later P4 slice (4B/4C/4D) has been started or promoted.**

**Blocking prerequisites** (from `external-signal-architecture.md` §12 — **all three SATISFIED: #5 2026-06-26; #6 + #7 2026-06-25**):
- **#5 — cross-org isolation lane (the hard gate). ✅ SATISFIED (2026-06-26).** A real-Postgres cross-org isolation test closing **R5** landed: `test/isolation/r5PipelineIsolation.test.ts` drives the exported matcher core (`runMatcherForSignal`) + the literal brief-generation SELECT and asserts per-org containment of findings, `signal_match_suggestions`, risk-exposure flags, `actions` (the `pgElevated` fan-out path has no RLS backstop), and brief inputs. **Evidence (VERIFIED):** committed `0e4c38be` on branch `test/r5-pipeline-isolation`; green in the existing `cross-org-isolation` lane (**37 files / 315 tests pass**, postgres:16). R5 marked **RESOLVED** in `TENANT_ISOLATION_STANDARD.md`. Test-only; zero application code changed.
- **#6 — branch reconciliation. ✅ SATISFIED (2026-06-25).** `main` was back-merged into `develop` via a **true merge commit `56992b3b`** (`--no-ff`, not squashed; parents `[7e7eaebc doc commit, cbd3504b origin/main]`). **Evidence (VERIFIED):** `origin/develop..origin/main` count = **0** (main fully contained in develop); **#354–#360 remain develop/staging-only** (present in `origin/main..origin/develop`, absent from `main`); **`origin/main` unchanged at `cbd3504b`**; **pushed only to `origin/develop`** (`5ea12f70..56992b3b`, fast-forward). The merge commit changed **zero files** (tree-identical) — no application code changed; `app/src/app/page.tsx` untouched.
- **#7 — skill housekeeping. ✅ SATISFIED (2026-06-25).** The stale "8 feeds" count was corrected to **6 RSS-registry feeds + 7 direct-source adapters** across the skill suite (6 occurrences in 5 files: `securelogic-intelligence-pipeline-engineer` SKILL.md/reference.md/examples/add-source.md + `securelogic-enterprise-architect` source-ingestion.md/architecture.md/examples/intelligence-source.md). **Evidence (VERIFIED):** `src/api/lib/feedAdapter/registry.ts` has **6** feed ids (3 Tier-2 threat-intel: BleepingComputer/KrebsOnSecurity/SANS ISC; 3 Tier-1 regulatory: NIST/FTC/ONC HealthIT); `src/api/lib/briefScheduler.ts` imports **7** direct-source adapters (CISA KEV, NVD, SEC EDGAR, Federal Register, CISA alerts, MITRE ATT&CK, MITRE ATLAS). Skill/docs only — no application code changed.

**Responsible skills / agents:**
- `securelogic-security-reviewer` + `securelogic-intelligence-pipeline-engineer` — prerequisite #5 (isolation lane + R5 test).
- `securelogic-release-pr-reviewer` + `securelogic-program-manager` — prerequisite #6 (branch reconciliation).
- `securelogic-program-manager` — prerequisite #7 (skill correction) and this sequencing.
- `securelogic-intelligence-pipeline-engineer` (lead) + `securelogic-enterprise-architect` (layering) — the eventual implementation, **once separately authorized**.

**Exit criteria for unblocking (ALL must hold):**
1. **#5 satisfied ✅ (2026-06-26)** — `test/isolation/r5PipelineIsolation.test.ts` green in the cross-org-isolation lane (37 files / 315 tests); R5 RESOLVED. (commit `0e4c38be`)
2. **#6 satisfied ✅ (2026-06-25)** — back-merge `56992b3b`; `origin/develop..origin/main` = **0**; #354/#355 single-tracked on develop; `origin/main` unchanged.
3. **#7 satisfied ✅ (2026-06-25)** — skill feed-count corrected to 6 RSS feeds + 7 direct adapters (6 occurrences across 5 skill files).
4. **Build scope authorized ✅ (2026-06-26)** — the Priority-4 build scope was drafted from the `external-signal-architecture.md` target model (decisions D1–D5; D6/D7 deferred to Priority 5), captured in `docs/roadmap/priority-4-implementation-plan.md` (PR #369), its §10 decisions operator-approved (PR #370), and **authorized by the operator** as the active build package.

All four criteria now hold (met 2026-06-26); the package is **UNBLOCKED and ACTIVE**, with implementation underway (see Active package status above for shipped slices).

**Scope guard:** design decisions **D6/D7** (dependency linkage, reassessment triggers) are **DEFERRED to Priority 5** — not in Priority 4. The A04-G1 RLS `app_request` flip remains **in-flight infrastructure**, not part of this package. Pillar-1 Part 2 prod enablement and the parked in-app price-label reconciliation remain out of scope.

## Completed (since last update)

> **Doc-sync 2026-08-12 — Enterprise Seat Model shipped + staging enablement recorded
> (docs only; no application code changed by this sync).** Records the seat-model package
> below and its verified runtime state. Evidence labels: **VERIFIED** = commit/PR/file/API/DB
> read directly · **INFERRED** = deduced · **RECOMMENDED** = proposed/not built.

- **Enterprise Seat / Role / Scoped-Authorization — COMPLETE (merged to `develop`; STAGING ENABLED; not in production).**
  **VERIFIED:** PR #784 (branch `feat/enterprise-seat-model`, 15 commits `06b0d34d`…`6200d37f`)
  merged to `develop` 2026-08-11, merge commit `1cc39602` (124 files, +3729/−78). Scope:
  seat data model; centralized `requireSeat` resolution/enforcement seam; Contributor
  scoping across findings/actions/evidence/vendors + default-deny across every governance
  family; SSO JIT that never silently consumes a Full seat; seat-aware provisioning +
  escalation guards; export as a separately grantable permission; resolved seat scope
  exposed to the UI via the `GET /api/me` `seat` block; Contributor write-response to
  assigned assessments; API keys bound to issuer seat/role. Independent release review
  found one P1 (a Viewer **seat** is read-only regardless of role) — fixed `6200d37f`.
  Branch CI green incl. the cross-org-isolation lane.
  - **Migrations (4, additive):** `20260915_enterprise_seat_model`, `20260916_sso_default_seat`,
    `20260917_viewer_export`, `20260918_api_key_seat_binding`.
  - **Staging (VERIFIED live 2026-08-12 ~06:00 UTC):** engine-staging deploys `1cc39602`
    with `SECURELOGIC_SEAT_MODEL_ENABLED="true"` (dashboard-set — **not in `render.yaml`**,
    known IaC drift); in-process `GET /api/me` returns `seat.enforced: true`; staging DB
    `schema_migrations` 203 → **207** (all four applied 02:45 UTC). Activation used
    same-SHA API deploys (03:36/03:44/04:04 UTC) per the EG2 Wave-1 env-injection lesson.
    A one-hour post-enablement soak elapsed with **zero error-level logs** and no
    restarts (04:04→06:05 UTC window read), with deny-path validation 403s observed
    02:45–04:04 UTC; **no formal soak sign-off was recorded** — that acceptance remains
    open (operator-owned). *(Superseded later the same day: the formal soak sign-off was
    completed 2026-08-12 with verdict **PASS** — staging soak gate CLOSED; see
    `docs/validation/seat-model-staging-soak-signoff.md`.)*
  - **Production: NOT shipped.** `main` @ `49691948` (#756 release) predates the merge —
    the package is absent from prod code, the prod flag is unset, prod DB remains at 203
    migrations. Path to prod = develop→main release (migrate-before-merge, four
    migrations) **then** a GATE B flag ruling. See flag matrix §1.21.

> **Doc-sync 2026-06-25 (BUILD_SEQUENCE.md only; no application code changed).** This doc had frozen at `72b4d3c5` (2026-06-23, ~Pillar-1 step 6/7) while ~25 commits merged past it (#338–#360). This sync marks the Pillar-1 worker package Complete (acceptance = staging soak green, MET), records the post-freeze merges with their **promotion state**, updates the A04-G1 table count, and sets the new Active package. Evidence labels: **VERIFIED** = commit/PR/file/branch read · **INFERRED** = deduced (e.g. live prod runtime state) · **RECOMMENDED** = proposed/not built.

> **Doc-sync 2026-06-25 (b) — Priority 3 closure (BUILD_SEQUENCE.md only; no application code changed).** Marks the `external-signal-architecture` design/architecture package complete (**design deliverable only — implementation has NOT begun**) and sets the Active package to the **blocked** Priority 4. No implementation milestone is marked complete by this sync. Same evidence labels apply.

> **Doc-sync 2026-06-26 — Priority 4 unblocked & first slice shipped (docs only; no application code changed by this sync).** Reconciles the governing docs with repository history: the operator authorized the Priority-4 build scope on 2026-06-26 (plan PR #369, decisions PR #370) and slice **4A.1** was implemented, passed the full CI gate, and merged to `develop` (PR #371). This sync flips the Active-package status BLOCKED → ACTIVE, preserves the prior BLOCKED decision as dated history, and records the shipped slice below. It does **not** rewrite prior decisions or change any application code. Same evidence labels apply.

> **Doc-sync 2026-06-26 (c) — 4A.1 contract stubs shipped + promoted to production (docs only; no application code changed by this sync).** Records the second additive part of slice 4A.1 (the four-stage contract stubs, PR #373) and its production promotion (PR #374 → `main` `959951b9`) plus the `main → develop` reconciliation (PR #375 → `develop` `e34ede8b`). Also records that the head branch `feat/p4b-signal-contracts` was a misnomer (its content is Phase 4A, not 4B). This sync preserves the full audit trail (no history rewrite) and changes no code/tests/config/migrations. Same evidence labels apply.

> **Doc-sync 2026-06-26 (d) — slice A3 complete + A3a/A4 split recorded (docs only; no application code changed by this sync).** Records that slice A3 (metadata-only API-source registration) merged to `develop` via PR #377 (merge commit `499650e7`; two files only), formally captures the **A3a (metadata foundation) / A4 (first runtime-integration milestone) split** — the scheduler does not yet consume the registry; resolution/fan-out unification is the deferred runtime slice A4 — and confirms A3 is develop/staging only while production (`main`) still carries only the 4A.1 contract foundation. Appended as a dated execution note; no prior decision rewritten; no code/tests/config/migrations changed. Same evidence labels apply.

- **Priority 4 — Signal Ingestion Hardening: slice 4A.1 (part a — registry `kind`) — COMPLETE (merged to `develop`).** **VERIFIED:** PR #371 `feat/p4a-registry-kind` (commit `650d478d`), merged to `develop` 2026-06-26T04:09:05Z. Adds a typed `RegistryKind` discriminator and stamps `kind: 'rss'` on every RSS adapter via the `makeRssFeed` factory (`src/api/lib/feedAdapter/types.ts`, `rssFeedAdapter.ts`; `kind` optional so not-yet-wired stub factories stay valid). Strictly additive — no DB, migration, config, dependency, or behavior change; one additive conformance test. **CI 7/7 green** (audit, build, cross-org-isolation, lint, tenant-coverage, test, typecheck). The four-stage contract stubs named in the plan's first-PR sketch were deliberately deferred to part (b) below. **Not promoted to `main`** — develop/staging only.

- **Priority 4 — Signal Ingestion Hardening: slice 4A.1 (part b — four-stage contract stubs) — COMPLETE (merged to `develop`, PROMOTED to `main`).** **VERIFIED:** PR #373 `feat/p4b-signal-contracts` (commit `483d83ff`), merged to `develop` 2026-06-26 (merge commit `eaf53e01`). Adds `src/api/lib/signals/contracts.ts` (the `RawSourceItem`/`NormalizedSignal` stage stubs + `SourceKind`/`SourceDescriptor` discriminators + a `CONTRACT_SCHEMA_VERSION` constant; `EnrichedSignal`/`BriefItem` deliberately deferred to 4B/4C per plan §10 decision 3) and one conformance test. Pure compile-time types — no runtime behavior, not yet wired into the registry/adapters/scheduler/matcher (sole import is a type-only import from `cyberSignalValidation.js`). Global signal-layer shapes — no `organization_id`; tenant-isolation surface unchanged. Strictly additive: 2 files, +207 lines; no DB, migration, config, `render.yaml`, dependency, route, SQL, or behavior change. **CI 7/7 green.** **PROMOTED to PRODUCTION:** cherry-pick of `483d83ff` (patch-id-identical → release commit `7a284ebb`) via PR #374 → `main` merge commit `959951b9` (prod `main` now `959951b9`); `main → develop` reconciled tree-identically via PR #375 → `develop` merge commit `e34ede8b` (`origin/develop..origin/main = 0`). **Naming note:** the head branch `feat/p4b-signal-contracts` is a misnomer — the content is Phase **4A** (slice 4A.1 contract stubs), **not** Phase 4B (source qualification). The PR title ("P4 slice A1") and both file headers ("slice 4A.1") are correct; only the branch label is wrong. Left as-is (a branch label is not history; renaming was unnecessary). **Priority 4 production footprint is limited to this 4A.1 contract-stubs slice — no later P4 slice (4B/4C/4D) has been started or promoted.**

- **Priority 4 — Signal Ingestion Hardening: slice A3 (metadata-only API-source registration) — COMPLETE (merged to `develop`; develop/staging only).** **VERIFIED:** PR #377 `feat/p4a-api-source-registry` (commit `ad8078a6`), merged to `develop` 2026-06-26 (merge commit `499650e7`). Adds **only** `src/api/lib/signals/sourceRegistry.ts` (exports `API_SOURCES`, a list of seven `kind:'api'` `SourceDescriptor`s for the directly-wired adapters — CISA KEV, NVD, SEC EDGAR, Federal Register, CISA Alerts, MITRE ATT&CK, MITRE ATLAS; each `id` matches the canonical `feed_health` source id the scheduler already records) and `src/api/__tests__/signals/sourceRegistry.test.ts` (descriptor conformance + compile-time negative case). Strictly additive: 2 files, +119 lines.
  - **A3a / A4 split (formally recorded).** A3 intentionally registers the seven direct adapters as `kind:'api'` **descriptors only** — it is the **metadata foundation**. **The scheduler does NOT consume the registry yet:** `briefScheduler.ts` is unchanged and still imports and calls each adapter's fetch function directly. Registry **resolution / fan-out unification** is the dedicated **runtime slice A4**, which is the **first runtime-integration milestone** of Priority 4 and remains **deferred** (operator-confirmed scope split, 2026-06-26).
  - **Runtime behavior unchanged.** Nothing consumes `API_SOURCES` (`grep -rln "signals/sourceRegistry" src` → only the test), so the module is inert by construction. No ingestion, parsing, normalization, matching, persistence, clustering, provenance, source-qualification, configuration, migration, or feature-flag behavior changed; no scheduler/matcher/adapter/DB/`render.yaml`/dependency change. Global signal-layer shapes — no `organization_id`; tenant-isolation surface unchanged. **CI 7/7 green** (typecheck, lint, test, build, cross-org-isolation, tenant-coverage, audit).
  - **`develop`/staging only — NOT promoted to `main`.** Production (`main` `959951b9`) still contains only the previously promoted **4A.1 contract foundation**; promotion of A3 is a separate, later operator decision.

- **`external-signal-architecture` (Priority 3) — COMPLETE as an Architecture & Design package (NOT an implementation milestone).** Deliverable: `docs/roadmap/external-signal-architecture.md`, operator-**ratified 2026-06-25** as the approved architectural baseline (status: *Architecture Ratified – Implementation Pending*). It records the **VERIFIED** current pipeline (signal lifecycle, `cyber_signals` data model, ingestion via **6 RSS feeds + 7 direct adapters**, the matcher, brief generation), the documented limitations, the **RECOMMENDED** target model, an additive migration path, risks, and the ratified design decisions **D1–D5** (**D6–D7 deferred to Priority 5**). The package's §11 docs-only acceptance criteria are met. Completing this *design* did not authorize the *build* — that is a separate decision. Priority 4 (Signal Ingestion Hardening) became the Active package in **BLOCKED** state on 2026-06-25, gated on prerequisites **#5 / #6 / #7**. *(Superseded 2026-06-26: those prerequisites were satisfied and the operator authorized the build scope — Priority 4 is now **ACTIVE** and implementation is underway; see the Active package section and the 2026-06-26 doc-sync above.)*

- **`pillar1-vendor-assurance-worker` — COMPLETE (§E Part 1, steps 1–7).** **VERIFIED:** job_type migration (#229 `17f20a9f`), worker core (#230 `8f8748eb`), worker service (#231 `2046bf28`), upload→enqueue route flip (#232 `47326856`; confirmed `src/api/routes/vendorAssuranceDocuments.ts` does `INSERT INTO jobs … 'vendor_assurance_extract'`), rank-4/premium gate on the vendor-assurance routes + `vendors.ts` (#233 `2737e5f0`), render.yaml prod+staging twin worker blocks (#234 `bc4287bf`), queue-depth alerting (#235 `0b1bb845`). **Acceptance for THIS package = staging soak green — MET:** soak PASS (all 5 exercises) recorded `a8ce6de8` (**VERIFIED** reachable from develop + main). This is **not** the Phase-1 ≥30-SOC / ≥3-auditor gate (that belongs to `vendor-assurance-intelligence-phase-1`, still unverified below — preserved, not closed).
  - **Part 2 — Phase 2A only (claim-path feature-gate): VERIFIED merged to main** — worker claim path gated on `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` (#241 `7328e09b`, reachable from main).
  - **Part 2 — full prod enablement: UNKNOWN from repo (manual confirmation required).** Committed `render.yaml` carries `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` on `securelogic-engine-staging` only (`render.yaml:285`); the prod flag flip + prod R2 + `ANTHROPIC_API_KEY` placement are dashboard/operator actions not provable from the repo. NOT marked complete.
  - **OUTSTANDING (preserved — NOT closed):**
    - **Step-5 deferred gate flip — STILL OPEN.** The three vendor-adjacent route files (`src/api/routes/vendorAssessments.ts`, `vendorReviews.ts`, `findings.ts`) remain at rank-2 `requireEntitlement("standard")`. The closing commit `dcd09f2a` is **VERIFIED NOT MERGED** (exists only on branch `feat/vendor-surface-premium-completion`, not develop/main). UIs redirect rank-2 users, but the APIs stay rank-2-accessible to a direct API-key caller — known, deliberate boundary; flip to `premium` in a later step.
    - **Step-6 cross-region divergence — STILL OPEN.** Prod `securelogic-data-rights-worker` + `securelogic-posture-worker` run `region: oregon` but reach the Virginia prod Postgres. Region is immutable post-provision → a re-create in a later step.

- **Post-freeze merges (#338–#360) — promotion state recorded** (per `git branch --contains`):
  - **On `main` (production) — VERIFIED merged; live runtime state INFERRED:** signal engine items 1/2/3 enabled in prod (#342 `4a709334`), incl. LLM control matcher wired into fan-out (#345 `b8ad01d1`) and a per-item dedup key so CVE-less signals stop collapsing (#344 `fc75cff4`); shared coalescing alert service + matcher real-time alerts, **flag OFF/inert** (#348 `f217b0c2`) + per-cycle flush heartbeat (#349 `588cfb53`); single weekly Intelligence Brief, Daily Digest send disabled (#347 `9fda72ef`); worker-feed maintenance (#351 `f6c4e45f`, #352 `699e02db`, #338 `071929b3`); GDPR account-deletion reaper (Art. 17) shipped **flag-gated/inert** (#341 `f5188958`); seat-cap enforcement on SSO JIT + admin raise (#340 `4bee2265`).
  - **Promoted to PRODUCTION via the matcher-R5 release (this branch):** matcher GAP-3 risk→action worker reachability (#354 `b7165093`) + risk-action telemetry (#355 `090b08c4`) — shipped to `main` **together with the R5 isolation test** (`test/isolation/r5PipelineIsolation.test.ts`), which validates exactly this behaviour, plus the R5/#5 docs. (The earlier "develop/staging-only" record for #354/#355 in the #6 evidence above is point-in-time as of 2026-06-25.)
  - **On `develop` / STAGING ONLY — NOT yet production:** marketing-website rebuild on shared assets (#356 `d49f3e1d`), pricing-model reconcile (#357 `61437ead`), /platform module availability (#358 `756ae70b`), website-staging service (#359 `5ea12f70`); app landing retired → /login (#360 `b14d4a1a`). **VERIFIED on `develop` only** (`origin/main..origin/develop`) — these warrant their own marketing-release review.

- `vendor-assurance-intelligence-phase-0-blob-storage` — Cloudflare R2 blob primitive shipped to staging.
- `vendor-assurance-intelligence-phase-1` — superseded as the Active package by `gdpr-data-subject-rights`. The four-table schema, seven-route surface, in-process extraction runner, projection-at-read-time vendor card, and queue/review UI shipped to staging behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`. NOTE: the ≥30-SOC-report / ≥3-auditor acceptance gate is **not verified in this doc-sync** — confirm before marking truly done.
- GDPR data-subject-rights increments (all merged):
  - **PR #1** (`#182`) — schema foundation for data-subject rights (`db/migrations/20260621_gdpr_foundations.sql`).
  - **PR #2a** (`#184`) — export engine query + streaming core.
  - **PR #2b** (`#188`) — export executor + `org_full` query layer (pure functions; executor `org_full` path unwired pending #2c).
  - **PR #2c** (`#192` → develop; promote `#193` → main `11c6969f`, prod-verified 2026-06-13T14:59:09Z) — org_full export executor wiring (wires the `runExport` `org_full` path). Tables-only; R2 attachment streaming deferred.
  - **PR #2d** (`#196` → develop `07d8c63c`; promote `#197` → main `0dd01f91`, prod-verified 2026-06-13T20:49:33Z) — R2 attachment streaming for the org_full export. Streams `vendor_assurance_documents` blobs from R2 into `attachments/vendor-assurance/<docId>.pdf` (one at a time, bounded memory), cross-checks each streamed sha256 against the upload-time digest. `GENERATOR_VERSION 2.1.0`; confirmed-absent blob → disclosed `status:"unavailable"` manifest gap, indeterminate R2 error / sha256 mismatch → fail-whole.

  - **PR #3** — data-rights worker, EXPORT-ONLY (shipped to prod). New `services/data-rights-worker/` (thin runner) over `src/api/workers/dataRightsWorker.ts` (testable core): claims `data_export_self` / `data_export_org` jobs from `jobs` via `UPDATE … FOR UPDATE SKIP LOCKED` on the elevated channel (with a 15-min visibility-timeout reclaim of crashed jobs), resolves the self-export subject email from `users.email` inside `withTenant` (never the payload), runs `runExport`, and streams the bundle to R2 via the `@aws-sdk/lib-storage` multipart sink (`blobStorage.createObjectWriteStream` + `dataExportStorage.ts`, key `org/{orgId}/data-exports/{exportId}.zip`). Terminal write was `jobs.result` (`{r2_key, file_size_bytes, scope}`) + `status='succeeded'`; the `data_export_files` row + token were deferred to PR #5 (Decision D-1) — PR #5 now folds that row-write back into the worker success path. Retry/backoff → `queued`; non-retryable → `failed`; exhausted → `dead_lettered`. Carried a cross-org-isolation test proving org-A jobs never read org-B rows and the payload-email-poison case. The R2-sink-open failure was hardened at the job level in `#204`.

  - **PR #5** — self-export intake + delivery (`user_self` scope), **shipped + prod-verified 2026-06-18 (main `acb7c271`).** `src/api/routes/dataExports.ts` (authenticated intake + list + owner download) and a session-optional tokenized download route, plus `src/api/lib/dataExportDownloadToken.ts` (256-bit `randomBytes` token, plain SHA-256 hash, customerApiKeys convention) and a `getDataExportSignedUrl` read helper on `dataExportStorage.ts`. The worker `recordSuccess` mints the token + INSERTs the `data_export_files` row inside `withTenant(orgId)`. Migration `download_token_hash` comments corrected HMAC→SHA-256. No new migration (the `jobs` + `data_export_files` schema from PR #1 already suffices; the one-pending guard is a conditional INSERT, not a new constraint). Route-level cross-org + cross-user isolation tests, the one-pending 409 guard, and token-expiry rejection. Self-export **UI shipped alongside** (`#213` → promote `#214`). Exports are inert end-to-end only where the email sender is absent (deferred — PR #4).

**`gdpr-data-subject-rights` is COMPLETE as an active package** — the export path (PR #2a–#2d), the EXPORT-ONLY worker (PR #3), and self-export intake + delivery + UI (PR #5) are all shipped and prod-verified. The umbrella has deferred tails carried below for orientation only; none is authorized, and selecting any of them is a fresh active-package decision.

GDPR umbrella — deferred tails (NOT authorized; orientation only):
- **Export-delivery email (PR #4)** — emails the tokenized download link built in PR #5; uses a shared `sendEmail()`, no new Resend sender (Decision E). Next likely launch lever, but not authorized.
- **Deletion reaper** — Art. 17 erasure; destructive, heavy Phase 0 (10 locks settled, D-9 cleared → buildable, gated). Candidate, not authorized.
- **`org_full` intake + admin authz cluster** (Decision A: with admin member-delete + last-admin authz). Candidate, not authorized.
- **Export-file purge** — the O-11 7-day R2 bundle reaper (`export_file_purge` jobs). Candidate, not authorized.

## In-Flight Infrastructure
Cross-cutting hardening that runs in parallel with the active product package — neither queued nor blocked. It is not a feature increment, so it does not pass through the Active-package one-at-a-time discipline; it is sequenced internally by its own rollout plan.

- **A04-G1 / M-1 — Postgres Row-Level Security rollout → `app_request` flip.** Table-by-table RLS enablement toward the `owner → app_request` role flip, now **code-complete** (M-1 PRs #802 + #803, 2026-08-17). Authoritative live census (identical staging + prod): **78 RLS-enabled / 78 policied / 0 FORCE** of 142 public tables — the earlier "~22 tables" figure in this entry undercounted (it predated the later batches; the live catalogs are the source of truth). Landed since that text: the M1-G1 grant catch-up (17 Option-Y misses cured; Tier-D allowlist formalized + CI-asserted bidirectionally), the full per-site channel disposition of every route/worker DB call site (72 new `asTenant` wraps, explicit `withTenant` for streaming/redirect handlers, GUC-set explicit transactions, justified `pgElevated` conversions across the admin/identity/system surfaces, worker claim/terminal-write fixes), the C-1 coverage-matrix tool + committed report, the C-2 strict-mode `db_query_outside_tenant_scope` soak instrumentation, and the activation gate pair `m1-preflight.sql` (fail-closed) / `m1-proof.ts` (both-sides battery, 29/29 on the harness with real identities). All policies remain INERT pre-flip (owner cred, NOT FORCE). Remaining: **operator activation only** — credential issuance, `MIGRATION_DATABASE_URL`/`DATABASE_URL` repoints, staging soak, prod (design + sequence: `docs/M1-app-request-flip-design.md`). Genuinely parallel to the active product package — do not fold it into the priority queue.

## Current build priorities
Priority order is fixed unless explicitly changed in this document.

### Priority 1 — Product and architecture alignment
#### Package: docs-product-alignment
Objective:
Bring PRODUCT_VISION.md, CURRENT_STATE_ARCHITECTURE.md, BUILD_SEQUENCE.md, FINAL_PRODUCT_STANDARD.md, and existing canonical documents into one coherent source of truth.

Why this matters:
Claude cannot build the platform correctly if the governing docs are stale, ambiguous, or overlapping.

Done when:
- product vision is clear
- current state is honest
- next packages are explicitly sequenced
- standards are defined
- docs are usable as operational build guidance

### Priority 2 — Tenant isolation standard
#### Package: tenant-isolation-standard
Objective:
Define and enforce the SecureLogic AI tenant model at the product and engineering level.

Required outcomes:
- every customer-data domain is organization-scoped
- tenant access rules are explicit
- storage/file handling rules are explicit
- job/AI processing tenant rules are explicit
- internal/admin access rules are explicit
- architectural standard is documented for all future packages

Likely files:
- FINAL_PRODUCT_STANDARD.md
- architecture/security docs
- auth and organization-context code references if needed
- any tenant-related route middleware docs

Hard rules:
- no new feature package should proceed without clarity here if it materially touches customer data

Done when:
- the tenant isolation approach is documented clearly enough that a developer cannot accidentally build cross-tenant behavior

### Priority 3 — External signal architecture
#### Package: external-signal-architecture
Objective:
Define the target external signal model for SecureLogic AI so future ingestion work follows a coherent design rather than adapter-by-adapter improvisation.

Required outcomes:
- external signal object definition
- source qualification model
- normalization expectations
- deduplication expectations
- linkage expectations into vendors, AI systems, obligations, risks, findings, and briefs
- distinction between raw source item, normalized signal, enriched signal, and brief item

Done when:
- the platform has a documented external intelligence architecture that matches the product vision

### Priority 4 — Signal ingestion hardening
#### Package: signal-ingestion-hardening
Objective:
Improve the actual quality and reliability of ingested signal data before expanding more output surfaces.

Required outcomes:
- stronger source breadth or better source quality
- normalization depth improvement
- better deduplication
- better severity/context extraction
- stronger signal preservation for downstream brief synthesis

Done when:
- inputs to the intelligence pipeline are materially richer and more reliable

### Priority 5 — Signal-to-platform linkage
#### Package: signal-to-platform-linkage
Objective:
Map external signals into real platform context.

Required outcomes:
- signals can resolve against vendors
- signals can resolve against AI systems
- signals can resolve against obligations
- signals can resolve against dependencies and risks
- linkage can support findings, reassessment triggers, and brief relevance

Done when:
- external intelligence no longer floats separately from the platform operating model

#### Sub-package (Slice 1): enterprise-context-layer-foundation — DOCS-ONLY (awaiting review; no SQL/code authorized)
**Status (2026-07-03):** Adopted by the operator as the concrete **Priority-5 substrate for Signal-to-Platform Linkage**. This is the **Enterprise Context Layer foundation** — the durable customer-context objects that later Priority-5 linkage (D6/D7: dependency linkage, reassessment triggers) will resolve signals against. **This BUILD_SEQUENCE amendment is docs-only; it authorizes no schema, migration, route, or application code.** Stop for review before any SQL or implementation.

**Feature flag:** the entire slice is gated behind **`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`** (default off); prod remains inert until the operator flips it.

**BUILD AUTHORIZATION (2026-07-03 — operator-approved). This SUPERSEDES the "docs-only / authorizes no schema, migration, route, or application code / stop for review" language in the Status line above and the "Priority-4-complete + explicit-authorization gate remain unchanged" clause in the S0 note below.** The operator **explicitly authorized building ECL Slice 1 AND Slice 2** during the build session and **waived the "Priority 4 complete" prerequisite** for the ECL build (operator instructions: "work priority 4 first and then continue to the goal"; "ignore anything operator owned that hinders you from completing the goal"; "proceed to S2 relationship graph"). Priority 4's *code* is complete (PRs **#461** doc-sync, **#462** C2b, **#463** C2c); its operator-owned validation / staging-soak / promotion tail is tracked separately and does **not** gate ECL.
- **Slice 1 — BUILT (PR #464), flag-inert, to `develop` only.** Migrations `20260717`–`20260719` (`enterprise_entities` header + `enterprise_data_stores` typed child + `organizations.max_enterprise_entities` cap + inert RLS + `app_request` grant), lib (flag / metering / validator), org-scoped CRUD routes, unit + cross-org isolation tests, GDPR classification, `CANONICAL_DOMAIN_MODEL.md` registration. CI 8/8 green.
- **Slice 2 + 2b — BUILT (PR #465, stacked on #464), flag-inert, to `develop` only.** Migrations `20260720`–`20260721` (`enterprise_relationships` generic edge substrate + inert RLS + grant), edge CRUD (two-endpoint same-org pre-flight, soft-delete), and the read-time **bounded graph resolver** (`GET /api/enterprise-graph` — the repo's first `WITH RECURSIVE`; AD-13 typed-edge union of generic edges + `ai_system_vendor_dependencies`).
- **PROD-ENABLE GATE (still in force — gates *enablement*, NOT *merge*).** The flag stays **OFF in production** until: (a) the **AD-17 per-org capability grant** ships (else ECL reaches every rank-4 org, not Enterprise-only); (b) the **companion edge cap** on `enterprise_relationships` (pre-merge-audit finding H1) lands; and (c) the **graph resolver is load-tested** at enterprise fan-out (finding H2 / AR-4), with the materialized-adjacency fallback built if it fails.
- **Merge:** #464 then #465 (stacked) → `develop` only. `main` untouched; launch freeze intact.

**S0 decision (2026-07-03 — operator-approved; docs-only, still no implementation authorized).** The Slice-1 S0 review accepted both **B** recommendations from the ratified blueprint `docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md` (merged as PR #459) and its `ARCHITECTURE_REVIEW.md`, resolving review findings **AR-1 (Critical — load-bearing attributes must not live in JSONB)** and **AR-15 (High — meter at the moment the write path opens)**. This revises only the *table shape* and the *metering timing* of the two "(approved)" decisions below; the feature flag, the no-backfill rule, the out-of-scope list, the "extend `signal_match_suggestions`" rule, and the **Priority-4-complete + explicit-authorization gate remain unchanged.**

**Table strategy (approved — updated 2026-07-03 S0):**
- Introduce a shared **`enterprise_entities` header** table (org-scoped; standard A04-G1 tenant-isolation) holding the columns common to every context type (name, description, `owner_user_id` → `users`, status, criticality, confidence, provenance via `source_type`/`source_id`, `external_ref`), plus a **typed child table per load-bearing type** for that type's type-specific, compliance-relevant, queryable attributes. **Slice 1 ships the header + exactly one typed child, `enterprise_data_stores`** (e.g. `data_classification`, `residency_region`, `retention_policy`, `encryption_at_rest`), to prove the pattern before it is replicated. Any `metadata JSONB` is restricted to genuinely-freeform customer custom fields — **never** compliance-load-bearing attributes, which must be typed columns. Later typed children (`enterprise_assets`, `enterprise_business_services`, `enterprise_identities`, …) each land in their own later slice/migration. *Rationale (AR-1):* load-bearing / regulator-relevant attributes must be typed, constrained, indexed and queryable for the later Applicability Engine's blast-radius query and for legal defensibility; a single generic table would strand them in unindexed JSONB and force a future migration over live customer data.
- Keep the existing **`vendors`** and **`ai_systems`** tables **as-is** — they remain the canonical stores for those two entity types, referenced (never copied) by the header/graph.
- **Do not** force-migrate existing `vendors`/`ai_systems` rows into `enterprise_entities`. No backfill, no dual-write in Slice 1. Unification of the read surface (if ever) is a separate, later decision.

**Metering (approved — updated 2026-07-03 S0):**
- `enterprise_entities` rows do **NOT** count toward **`max_monitored_entities`**.
- **Do not touch `enforceEntityLimit`** or its callers in this slice.
- A **per-org cap on `enterprise_entities` (and a companion edge cap) ships in Slice 1**, enforced at the write path (count-and-compare → `409`) as a **separate counter, decoupled from `max_monitored_entities` and without touching `enforceEntityLimit`** (the two bullets above remain in force). Slice 1 ships the *mechanism* with a conservative default cap; the exact per-tier cap *value* remains an operator / commercial decision (blueprint §24 Q1), tunable without a schema change. The later CSV / bulk-import row-limit (S3) **reuses this same mechanism**. *Rationale (AR-15):* Slice 1 opens an org-scoped API write route, so an unmetered, scriptable create path would be a commercial / scale exposure the moment it ships.

**Explicitly OUT of scope for Slice 1 (do not build):**
- CSV / bulk import
- Applicability Assessment
- any matcher or `signal_match_suggestions` changes
- connectors / external ingestion of entities
- any UI
- any scoring/posture changes
- any risk creation or `risks` writes

**Slice 1 scope (not yet authorized to build):** the `enterprise_entities` header + the `enterprise_data_stores` typed child + provenance columns, the (RLS-ready) tenant-isolation policy, the per-org entity/edge cap enforced at the write path, and the minimal org-scoped read/write route surface behind the flag. Entity↔risk / entity↔finding link tables and applicability assessment follow in later slices. Prefer **extending** `signal_match_suggestions` for linkage rather than duplicating it (see the ratified `external-signal-architecture.md` baseline).

**Sequencing note:** this overlaps the previously deferred "Enterprise Context" concept; it is now the named Priority-5 Slice-1 substrate. It is **not** the current Active package (Priority 4 remains active) — Slice 1 build is gated on completing Priority 4 and on operator authorization of this scope.

**Canonical-model forward note:** `enterprise_entities` is a new table not yet present in `CANONICAL_DOMAIN_MODEL.md`. When/if Slice 1 is authorized to build, `CANONICAL_DOMAIN_MODEL.md` must be updated to register `enterprise_entities`, its typed child tables (starting with `enterprise_data_stores`), and its entity-type taxonomy so the domain-model authority stays in sync — no CANONICAL change is made by this docs-only amendment.

### Priority 6 — Intelligence Brief premiumization
#### Package: brief-premiumization
Objective:
Make the Intelligence Brief a real premium intelligence product, not a polished digest.

Required outcomes:
- issue quality feels analyst-grade
- cross-signal synthesis is stronger
- relevance/context logic is stronger
- executive and operator value is obvious
- free vs paid brief differentiation is clear across:
  - Intelligence Brief — Free
  - Brief Pro
  - Brief Team
- platform relationship remains explicit

Done when:
- a paid user would reasonably perceive the brief as decision support worth paying for

### Priority 7 — Platform context surfaces
#### Package: platform-context-surfaces
Objective:
Ensure the product visibly demonstrates how intelligence becomes action, evidence, and posture.

Required outcomes:
- stronger product proof surfaces
- more visible context linkage in UI/API where needed
- no “platform attached to newsletter” ambiguity

Done when:
- the platform’s core operating-layer value is obvious in the product itself

### Priority 8 — Enterprise customer distribution model
#### Package: customer-distribution-and-isolation
Objective:
Formalize how the platform is distributed to clients and how data segregation is enforced operationally.

Required outcomes:
- default shared SaaS model documented
- logical tenant isolation documented
- dedicated or customized deployment path documented for enterprise where needed
- customer-facing explanation available
- internal operational standard defined

Done when:
- SecureLogic AI can credibly answer client security reviews about tenant separation and deployment models

### Priority 9 — SecureLogic AI internal control environment
#### Package: securelogic-internal-controls
Objective:
Build the minimum auditable operating environment for SecureLogic AI as a service organization.

Required outcomes:
- system boundary
- asset inventory
- vendor inventory
- access review process
- minimum security requirements
- evidence repository structure
- risk/control baseline
- management review cadence

Done when:
- SecureLogic AI begins operating like a service organization that expects client and auditor scrutiny

## Package template for future use
Every new package must define:
- package name
- objective
- why it matters
- dependencies
- files likely involved
- required behavior
- hard rules
- validation required
- done definition

## Validation policy
Default validation:
- run only the minimum checks required for the active package
- prefer targeted tests over repo-wide verification
- typecheck only when needed
- app builds only when the package affects app behavior materially

## Commit policy
- default is one commit per completed package
- batching only by explicit authorization
- stop after package completion and present exact commit scope
- do not continue accumulating completed packages without permission

## Anti-drift rules
Do not:
- choose the next package because it is easy
- build UI polish ahead of missing architectural layers
- build read surfaces that outrun weak underlying data
- confuse the Brief with the core platform
- allow docs to become stale after major package work

## Backlog (deferred until prerequisites land)

- **Risk lifecycle (epics R1–R4).** A formal, flag-gated risk-management lifecycle (12-stage journey → 9-state machine, executive approval with separation of duties, transactional audit stream). Full engineering blueprint: `docs/specs/risk-lifecycle-spec.md` (merged to develop `4b41cb96`, PR #450) — **the authority for the R1–R4 build prompts**. Supersedes RR-3 (`risk_lifecycle_events`) and subsumes RR-8 (`risk_approvals`) per the risk-register roadmap. Flag `SECURELOGIC_RISK_LIFECYCLE_ENABLED` (default off). Not yet authorized; Open Question #1 (approver model) must be answered before R1 starts.
Items surfaced during package work that are out of scope for the active package and waiting on a specific prerequisite. Not a wishlist — each entry must name the prerequisite and the reason it cannot be done now.

- **HTTP test harness for link routes.** Prerequisite: all four link tables landed — **prerequisite met** (signal-to-vendor, signal-to-AI-system, signal-to-control, signal-to-obligation all shipped). Pullable now. Behavioral coverage on the four shipped link routes is currently limited to the `parseLimit` fractional-input path and the `ON CONFLICT` insert-race path (per `link-route-template-hardening` — see the "Behavioral tests" section in `signalVendorLinks.test.ts`, `signalAiSystemLinks.test.ts`, `signalControlLinks.test.ts`, and `signalObligationLinks.test.ts`). The harness package will introduce a uniform behavioral test surface across all four routes — first behavioral test infrastructure in the repo that doesn't follow the existing template, so it needs its own scoping conversation before build. **Sequence after pull: this package first, then `Codify link-slice template in CLAUDE.md` (so the codified template can reference real behavioral coverage, not aspirational coverage).**

- **PG integration test for the entity-cap webhook transition (PR #248).** Prerequisite: a Postgres-backed integration test lane (the unit suite mocks `pg`). The cap-transition logic is in SQL (`GREATEST(max_monitored_entities, 50)` on a paid grant, never lowered) and is currently **source-asserted only** — no execution-level proof. Once a real-PG lane exists, add a test for the past_due round-trip: `premium→starter→premium` preserves an admin-elevated cap.

- **Codify link-slice template in CLAUDE.md.** Prerequisite: all four link tables landed AND HTTP test harness package landed. **First prerequisite met; second pending.** Once landed, distill the link-slice rules into a one-page CLAUDE.md section so future link work and future-Claude don't re-derive the pattern from prior commits: standard middleware chain, global-signal asymmetry on cross-row pre-flight, semantically informative relationship line in `CANONICAL_DOMAIN_MODEL.md`, hardened insert template (parseLimit returning null on non-integer, `INSERT ... ON CONFLICT` against the partial unique index, named handler exports), and behavioral test scope (referencing the harness, not the per-slice direct-handler tests, once the harness is in). Pulled from the recurring "default-yes" answers given on each slice — codifying eliminates the per-slice re-asking.
