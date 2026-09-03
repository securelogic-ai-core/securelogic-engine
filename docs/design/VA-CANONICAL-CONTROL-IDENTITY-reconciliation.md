# VA — canonical control identity: reconciliation

**Status: SUPERSEDED BY IMPLEMENTATION, 2026-08-30.** The owner review this
report stopped for was given, the new canonical entity approved, and §4.1 built
as migrations **20261067–69**. The body below is retained UNCHANGED as the
record of why the entity exists and what was rejected; only this header is new.
Where the two differ, the code and the migrations are authoritative.

**What was built, against §6's four decisions:**

1. a new canonical control entity (§4.1) rather than a `controls.canonical_control_key`
   column — `canonical_controls` + `canonical_control_aliases` (20261067);
2. the `securelogic:` key namespace, with the `{industry}:control:*` template
   slugs registered as ALIASES and never adopted as canonical keys;
3. the crosswalk keyed on `(framework_key, framework_version, requirement_reference)`
   — which required a fourth object the report did not anticipate:
   `canonical_framework_versions` plus `frameworks.framework_key`, because
   inspection found the approved requirement identity was **not** resolvable
   from the schema as it stood (`frameworks.name` is a mutable display string
   and no framework key was persisted at all);
4. materialising tenant `control_mappings` from published crosswalk rows is
   **not** in this step, as required.

**What is NOT done, and must not be reported as done:** no canonical content is
published in any environment — the tables ship EMPTY and a migration cannot fill
them (publication requires a named human, structurally). The staging chain is
therefore unproven. See `VA-S4-assurance-wiring-plan.md` §7 step 1.

---

**Original status (2026-08-29):** RECONCILIATION ONLY. **Nothing implemented, no
migration slot consumed.** Produced under the owner ruling of 2026-08-29, which
approved the architectural principle (global mappings must reference a global
canonical control identity) but explicitly forbade assuming
`controls.canonical_control_key` is the right implementation until the existing
identity model is inventoried.

**Verdict up front: a suitable canonical control identity does NOT exist, but a
directly reusable PATTERN does — `canonical_products`. This report recommends
STOPPING for owner review before implementation, because the answer is a new
canonical entity.**

---

## 1. The six questions, answered

### 1. Does a globally stable canonical control identity already exist?

**Partly, and in the wrong place.** `TemplateControl.id` in `src/templates/*` is
a globally stable slug of the form `{industry}:control:{slug}` — e.g.
`b2b-ai:control:ai-use-policy`. It is stable, human-readable, and versioned with
the template file.

**But it is never persisted.** `templateLoader.ts` inserts:

```sql
INSERT INTO controls (organization_id, name, description, template_source)
VALUES ($1, $2, $3, $4)          -- $4 = industryId, e.g. 'b2b-ai'
ON CONFLICT (organization_id, name) DO NOTHING
```

`template_source` records **which template** a control came from, not **which
control it is**. The canonical id is discarded at load. The loader's own header
calls `template_source` "analytics-only attribution", which is exactly what it
is.

So today the only identity a tenant control has is `(organization_id, name)` —
a **mutable display string**.

### 2. Is it immutable enough for historical crosswalks?

**No.** `controls.name` is user-editable and is the dedup key. Renaming a
control today silently changes the only thing a crosswalk could have joined on,
and leaves no trace that it was ever the same control. A historical assurance
decision anchored to it could not be reproduced.

### 3. Do tenant controls already retain provenance to it?

**No** — see Q1. `template_source` is the template, not the control. And of the
14 controls on staging, **every one is `(manual)` with `template_source` NULL**,
so even that coarse signal is absent in practice.

### 4. Can the existing identity support multiple framework mappings?

**Structurally yes, in practice no.** `control_mappings` is many-to-many
(control ↔ requirement), so one control can map to several requirements across
frameworks. But the loader creates **one synthetic requirement per (framework,
template)** with `reference_id = 'industry-template:{industryId}'` and maps
controls to *that*, never to real framework requirements. So the multi-framework
capability exists and is unused: on staging, `synthetic_requirements = 0` and
the only 3 mappings are hand-made.

### 5. Can it survive framework/version updates without changing historical meaning?

**No.** `control_mappings` is `(id, control_id, requirement_id, created_at)` —
no version, no effective dates, no supersession. `frameworks.ts` **hard-DELETEs**
mappings when a framework is deleted. A framework version bump would silently
re-point or destroy the mappings a past decision relied on.

### 6. Can customer-authored controls coexist without pretending to be canonical?

**Not distinguishably.** A template-loaded control and a hand-made one differ
only by `template_source`, which is nullable, analytics-only, and null on every
staging row. There is no way to say "this control is the tenant's own and maps
to nothing canonical" as a positive statement rather than an absence.

---

## 2. The precedent the model already has

**This exact problem was solved once, for products.** The asset registry carries
a full canonical-identity stack:

| Table | Shape |
|---|---|
| `canonical_products` | `id`, **`canonical_key`**, `vendor_canonical`, `product_canonical`, `display_name` — global, no `organization_id` |
| `canonical_product_aliases` | `product_id`, `alias_raw`, `alias_canonical`, **`source`** |
| `canonical_product_external_ids` | `product_id`, `scheme`, `identifier`, **`source`** |
| `canonical_product_versions` | `product_id`, `version_raw`, `version_normalized`, **`source`** |
| `asset_product_identities` | `organization_id`, `asset_id`, **`canonical_product_id`**, **`provenance`** (`attestation` / `sbom` / `connector` / `inferred`), `confidence`, `evidence_ref`, `attested_by_user_id` |

Note what `asset_product_identities` does, because it is precisely the tenant
side of the ruling's target relationship:

- it links a **tenant object** to a **global canonical entity**;
- it records **how** the link was established (`provenance`);
- it carries a CHECK making the authority structural —
  `provenance = 'attestation'` **requires** `attested_by_user_id`, and any other
  provenance **forbids** it;
- a tenant asset with **no** identity row is a legitimate state, not an error.

That last property is exactly the ruling's "customer-specific control with no
canonical identity where appropriate".

**The pattern is proven, in-model, and tenant-safe. It is the right shape to
reuse. It is not the right TABLE to reuse — a control is not a product.**

---

## 3. What is actually missing

| Concept | State |
|---|---|
| Global canonical control entity | **MISSING** |
| Stable canonical key | **EXISTS in template content, discarded at load** |
| Tenant → canonical link with provenance | **MISSING** (`template_source` is not it) |
| Multi-framework mapping capability | EXISTS (`control_mappings` m:n), unused |
| Mapping version / effective dates / supersession | **MISSING** |
| Mapping provenance and approval state | **MISSING** |
| "This control is deliberately not canonical" | **MISSING** as a positive state |
| Precedent for all of the above | **EXISTS** (`canonical_products` stack) |

---

## 4. Recommendation — STOP for owner review

The ruling says: *if a suitable canonical identity already exists, reuse it; if
not, design the smallest mechanism — and **stop before implementation** if a
genuinely new canonical entity is required.*

**A genuinely new canonical entity is required.** So this report stops here, and
proposes the following for review rather than building it.

### 4.1 Proposed shape (for review, not built)

Three objects, mirroring the product stack:

**(a) `canonical_controls`** — global reference content, no `organization_id`.

```
id                UUID PK
canonical_key     TEXT UNIQUE      -- 'securelogic:control:mfa-privileged-access'
display_name      TEXT
description       TEXT
control_family    TEXT             -- reuse controls.control_family vocabulary
status            TEXT             -- draft | published | superseded
supersedes_id     UUID NULL        -- version chain, never in-place edit
published_at      TIMESTAMPTZ NULL
```

**Namespaced key, not `{industry}:`** — the existing template slugs are
industry-scoped (`b2b-ai:control:…`), which cannot express a control that
belongs to no industry. A `securelogic:` namespace with the industry slugs
mapped in as **aliases** preserves the existing content without freezing its
accident of origin into the canonical identity.

**(b) `canonical_control_crosswalk`** — global; requirement ↔ canonical control.

```
id                     UUID PK
framework_key          TEXT         -- 'nist-csf'
framework_version      TEXT         -- '2.0'   (versioned, per ruling)
requirement_reference   TEXT        -- 'PR.AA-05'  (stable reference, not requirements.id)
canonical_control_id   UUID
mapping_source         TEXT         -- securelogic | ai_proposed | customer
mapping_rationale      TEXT
mapping_version        TEXT
status                 TEXT         -- proposed | approved | published | superseded
proposed_by            TEXT         -- actor kind + id
approved_by_user_id    UUID NULL
effective_from         TIMESTAMPTZ
superseded_at          TIMESTAMPTZ NULL
```

Keyed on **`(framework_key, framework_version, requirement_reference)`**, not on
`requirements.id` — requirement rows are per-tenant (via `frameworks`), so a
global crosswalk cannot reference them and remain global. This also answers Q5:
a framework version bump produces new crosswalk rows, and the old ones stay
addressable for historical reconstruction.

**AI publication boundary:** `status` must reach `published` through
`approved_by_user_id`, exactly as `assurance_opinion` now requires an acceptor
(20261066) and `assessment_facts` requires one for `ai_extraction`. A CHECK, not
a convention.

**(c) `control_canonical_identities`** — tenant side, mirroring
`asset_product_identities`.

```
organization_id       UUID
control_id            UUID
canonical_control_id  UUID
provenance            TEXT   -- template | attestation | inferred | customer_mapped
confidence            INT
attested_by_user_id   UUID NULL   -- CHECK: required iff provenance='attestation'
```

A tenant control with **no** row here is a customer-specific control with no
canonical identity — a legitimate, representable state.

### 4.2 Why NOT `controls.canonical_control_key`

The ruling's caution was right. A column on `controls` would:

- give every control exactly **one** canonical identity, when a tenant control
  can legitimately implement more than one canonical control (and vice versa);
- carry **no provenance** — no way to say whether the link was templated,
  attested, or inferred, which is the distinction `asset_product_identities`
  exists to make;
- make "no canonical identity" indistinguishable from "not yet linked";
- put governed reference-data linkage inside a tenant-editable row.

### 4.3 What this does NOT require

- **No second control model.** `controls` stays exactly as it is; canonical
  identity is additive and optional.
- **No NIST-specific schema.** `framework_key` + `framework_version` is generic;
  NIST CSF is only the first content to be loaded into it.
- **No change to `control_mappings`.** It remains the tenant-resolved view. The
  crosswalk is upstream reference content; materialising tenant mappings from
  published crosswalk rows is a later, separate step.

---

## 5. Migration slots this would need

Three, if approved: `canonical_controls` + aliases, `canonical_control_crosswalk`,
`control_canonical_identities`. **None reserved, none consumed.** Next free is
`20261067` (20261051–53 remain reserved for ADR-0012, 20261066 is now applied).

## 6. Decisions required before implementation

1. Approve a **new canonical control entity** (§4.1) rather than a key column.
2. Confirm the `securelogic:` key namespace, with existing `{industry}:control:*`
   slugs mapped in as aliases rather than adopted as canonical keys.
3. Confirm the crosswalk keys on `(framework_key, framework_version,
   requirement_reference)` rather than `requirements.id`.
4. Confirm that materialising tenant `control_mappings` from published crosswalk
   rows is a **separate** step from publishing the crosswalk itself.
