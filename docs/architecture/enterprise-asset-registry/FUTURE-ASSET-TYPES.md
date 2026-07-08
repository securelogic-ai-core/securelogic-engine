# EAR — Future Asset Types (server / network_device / facility)

**Status:** NOT BUILT — deferred by explicit ruling (P16, 2026-07-08).
**Why this doc exists:** the P16 unified-import request listed a 13-type
taxonomy. Three of those types — **`server`, `network_device`, `facility`** — do
not exist anywhere in the platform today. This records exactly what they would
require so they are picked up as a real, scoped backend package rather than
faked into the importer.

---

## The ruling

P16 ships bulk import for the **10 real canonical asset types only**
(`vendor, ai_system, application, database, cloud_resource, endpoint, api,
identity_system, business_process, generic`). The requester's `data_store` and
`custom` are **not** new types — they are the customer-facing names for the
canonical `database` and `generic` types, aliased in the import UI, never as
separate rows.

`server`, `network_device`, and `facility` are **explicitly out of P16**:

- No aliasing to `generic`. Storing a server as a `generic` asset is a lossy
  fake — it cannot be typed, filtered, scored, or reported as a server, and it
  would corrupt the taxonomy the platform reasons over.
- No new tables / CHECK constraints / validators / migrations in P16 (the
  package's stated constraint).

## What each of the three would actually require

They are not a UI change. Each is a first-class asset type, so each needs the
**full detail-backed create lane** the four existing detail types already have
(`cloud_resources` / `endpoints` / `apis` / `identity_systems` — EAR Phase 3a),
mirrored end to end:

1. **Taxonomy** — add the value to the engine `ASSET_TYPES` (and the app mirror),
   `ASSET_TYPE_SPECS`, and `ASSET_TYPE_LABELS`. Additive-only, in lockstep.
2. **Backing table + migration** — a new S0 detail table (e.g. `servers`,
   `network_devices`, `facilities`) with `organization_id`, the shared header
   columns, and the type's typed columns, plus its `(org, name)` UNIQUE, the
   partial `(org, external_ref)` unique index, and **RLS armed NOT FORCE** (the
   EAR S0 rule). One migration per type.
3. **Typed-column vocabulary + validator** — extend `assetDetailValidation.ts`
   (`DETAIL_BACKED_TYPES`, `TYPED_VOCAB`, `REQUIRED_TYPED`, `DETAIL_TABLE_SPEC`)
   with the type's columns and closed enums. The CHECK constraints in the
   migration and the validator vocabularies must match (the existing unit-lockstep
   asserts this).
4. **Registrar mapping** — `registerAsset` / `asset_registry_v` / graph-node
   mapping (`graphNodeForBacking`, EAR-AD-4) for the new backing_kind.
5. **Then, and only then, import + create are free** — the P16 unified importer
   (`assetImportOptions()` + `POST /api/assets/import`) and the `/assets/new`
   create picker are data-driven from the specs above, so each new detail type
   joins both automatically once steps 1–4 land. No importer changes needed.

### Suggested typed columns (starting point, not ratified)

| Type | Candidate typed columns |
|---|---|
| `server` | `hostname` (free), `os` (free), `environment` (enum: prod/staging/dev/dr), `role` (free) — note the overlap with `endpoint`; a design memo must decide whether `server` is a distinct type or a facet of `endpoint` before a table is cut |
| `network_device` | `device_type` (enum: router/switch/firewall/load_balancer/other), `mgmt_ip` (free), `location` (free), `vendor` (free) |
| `facility` | `facility_type` (enum: datacenter/office/colo/other), `address` (free), `region` (free), `tier` (free) |

## Open design questions (resolve in the memo, before any migration)

- **Is `server` a real type or an `endpoint` facet?** `endpoint` already covers
  "hosts, servers, and workstations." Adding `server` risks two overlapping
  types. Decide deliberately — do not add by reflex.
- **Does `facility` belong in the Asset Registry or the ECL entity layer?**
  Facilities are often organizational context (like `department` /
  `business_unit`), which live as `enterprise_entities`, not detail-backed assets.
  An ECL `entity_type` may be the correct home — cheaper, no new table.
- **Cap policy** — reuse the flat `DETAIL_ASSET_CAP`, or per-type caps?

## Recommendation

Treat this as a **separate, scoped package** ("EAR detail-type expansion") with a
short design memo first (the two "real type vs facet/entity" questions above),
then one migration + validator + lockstep-test per approved type. It is **not** a
prerequisite for P16 and must not be smuggled into the importer.
