# EAR — Canonical Asset-Creation Flow

**Status:** SHIPPED (flag-dark, GATE B). 2026-07-08.
**Scope:** the Enterprise Asset Registry asset-creation UX. Federation model
(EAR-AD-1) and storage rules (EAR-AD-2, ECL S0) are unchanged — this is a UX
plumbing pass plus one additive schema step for `business_process`.

---

## The problem it fixes

Creating an asset forced the user to pick a type **two or three times**:

```
/assets ─[+ Add asset]→ /assets/new (PICKER) ─→ generic /enterprise-context/entities/new
```

- The `/assets` header button dropped any active type filter, so the user
  re-picked on the picker.
- application / database / business_process routed to the generic **Add Entity**
  form, which ignored the selection (defaulted to `asset`) and offered a
  **different** vocabulary — forcing a third pick from a non-matching list.
- `business_process` had no backing store at all, so it collapsed to `generic`.

## The canonical flow (now)

**Choose the type once; land on the right Create screen with the type
preselected.** One helper, `assetCreateHref(assetType)`
(`app/src/lib/assetRegistry.ts`), is the single routing authority the list
button and the picker both use:

| asset_type | Create surface (type preselected) |
|---|---|
| cloud_resource · endpoint · api · identity_system | native inline `AssetForm` — `/assets/new?type=…` |
| vendor | `/vendors/new?from=registry` (dedicated form; breadcrumb → Assets) |
| ai_system | `/ai-systems/new?from=registry` (dedicated form; breadcrumb → Assets) |
| application | `/enterprise-context/entities/new?entity_type=application&asset_type=application` |
| database | `…?entity_type=data_store&asset_type=database` |
| business_process | `…?entity_type=business_process&asset_type=business_process` |
| generic | `/enterprise-context/entities/new` (full picker — explicit generic/custom) |

- `/assets` "+ Add" button: with a type filter active it links straight to that
  type's Create screen and labels itself **"+ Add {Type}"**; with no filter it
  opens the picker (the one type chooser).
- **Add-Entity** now reads `?entity_type=&asset_type=`, preselects **and locks**
  the type (read-only, "selected on the Asset Registry"), and titles the page by
  the **asset** type ("Create Database", not "Add Data Store").
- Vendor / AI System dedicated flows keep their **form behavior unchanged** (fields,
  validation, submit). Both follow the same structure: a thin **server wrapper**
  (`page.tsx`) reads `?from=registry` and passes `backHref`/`backLabel` to the
  client form, which renders the **shared `CreateFlowBackLink`** component (no
  duplicated breadcrumb markup). Opened from the registry, both show "← Assets";
  opened directly, they show "← Vendors" / "← AI Systems".
  - AI System's server wrapper is **token-only** (matching its existing list page
    and `createAiSystem` action — entitlement is enforced at the engine), so no
    `isPlatformUser` gate is added; Vendor keeps its premium gate. This mirrors
    the Vendor *structure* without changing AI System's access model.

## The onboarding surface — three canonical methods

`/assets/new` is the canonical create **and** onboarding surface. It exposes the
**three** onboarding methods as co-equal, numbered, first-class options — each
**reuses an existing flow; nothing is re-implemented** (driven by the pure
`assetOnboardingMethods()` helper so the contract is unit-tested):

1. **Create manually** — the federated per-type create picker (the four
   detail-backed types render the native `AssetForm` inline; vendors / AI systems
   / applications / data stores / other open their authoritative screens).
2. **Bulk upload** — routes to the unified **`/assets/import`** surface (P16):
   one flow for all **10** real canonical asset types. The pure
   `assetImportOptions()` router sends the four detail-backed types to
   `POST /api/assets/import` (the thin P16 route) and the other six to the ECL
   `POST /api/enterprise-context/import`, with the asset_type mapped to its
   importable `entity_type`. Real server-side preview → commit, in-file + in-DB
   de-duplication, per-type caps, and row-level errors apply to every type —
   **no duplicate importer** (the shared parser + the extracted `planRows`
   precedence + the existing create-validators do the work). Per-type CSV
   templates download from the surface. The ECL-backed types are ECL-fenced
   (hidden with ECL off; the four detail-backed types remain). The legacy
   `/vendors/import` + `/ai-systems/import` surfaces are preserved, unchanged.
   `server` / `network_device` / `facility` are **not** offered — they are not
   real asset types yet (`FUTURE-ASSET-TYPES.md`).
3. **Connect enterprise systems** — routes to the **existing `/assets/connect`**
   connector catalog (EAR Phase 3b). The route exists, so it is linked directly —
   **never shown as "coming soon."** Selecting a connector opens the P16
   admin-gated manage page (`/assets/connect/[id]`): admins add credentials,
   enable syncing, run a discovery sync, or disconnect — reusing the existing
   `PUT`/`DELETE /api/connectors/:id` + `POST /:id/sync` endpoints (admin-only via
   `requireAdminRole`); non-admins get a clear gated message with the next step.

**SOC upload is deliberately absent** from Asset Registry onboarding — it stays
under **Vendor Management**. Flag-off is unchanged: registry off → the neutral
disabled panel (none of the three sections); ECL-backed sub-options
(applications/data-store import, connectors) are additionally ECL-fenced.

## The one schema change — `business_process`

`business_process` was a registry `asset_type` with **no backing store**. Rather
than fake it (file it as `generic`), it is promoted to a first-class
`enterprise_entities.entity_type`, per ARCHITECTURE.md §2.3 ("enterprise_entities
enum add").

- Migration **`20260827_business_process_entity_type.sql`** — additive,
  non-destructive: widens the `entity_type` CHECK and repoints `asset_registry_v`
  so `entity_type='business_process'` projects to `asset_type='business_process'`.
- `ENTITY_TYPE_TO_ASSET_TYPE` (engine) + `ENTITY_TYPES` (engine + app) + the label
  maps gain `business_process`, kept in lockstep with the view CASE
  (`assetRegistry.test.ts`).
- **v1 = header fields only** (name / description / criticality / owner). A
  `business_process` record now lands correctly as its own asset type.

## Deferred (documented, not faked)

Both follow the ECL **S0 rule** (load-bearing attributes are typed columns in a
typed child, never JSON) — each is one detail table + one RLS migration:

- **`business_process` typed child** — `rto`, `rpo`, `owner_department`, etc.
- **`application` typed child** — tech stack, hosting, data processed, version.

Until then, `application` and `business_process` create with the shared
enterprise_entities header; `database` already carries its four typed
`enterprise_data_stores` fields; the four infrastructure types carry their full
per-type typed columns.

## Guardrails honored

- No production or staging changes; no operator actions. Whole surface stays
  behind `SECURELOGIC_ASSET_REGISTRY_ENABLED` + `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
  (GATE B). Flag-off behavior is byte-identical.
- No destructive migration; no attribute duplication (EAR-AD-2 preserved — the
  registry spine stays identity-only; the view reads header from the backing row).
- Vendor / AI System / SOC workflows intact.
