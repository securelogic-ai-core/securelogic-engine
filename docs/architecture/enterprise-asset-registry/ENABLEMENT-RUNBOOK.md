# Enterprise Asset Registry — Enablement Runbook (P11)

**Status:** DOCUMENTATION ONLY. Nothing in this runbook has been executed.
Production enablement remains **GATE B — never under the EAR goal** (tracker
header ruling). This runbook exists so a future operator can enable the
registry deliberately, in the right order, with validation and rollback at
every step.

**Scope of what it enables:** everything shipped by EAR PRs #496–#509
(Item 0, Phases 0–5, P6–P11). All of it is dark today: every flag below
defaults `"false"` in all four render.yaml services.

---

## 1. Flag inventory (what each one turns on)

| Flag | Surface | Depends on |
|---|---|---|
| `SECURELOGIC_ASSET_REGISTRY_ENABLED` | `/api/assets*` (list/detail/create/patch/delete), `/api/asset-assessments*` (P10), the registry-generic signal matcher branch, registerAsset() writes on vendor/aiSystem/entity creation, the `/assets` app surface — read list/detail **and** the management UI (`/assets/new`, `/assets/:id/edit`, create/edit/archive/delete for the four detail-backed types, federated create + CSV-import entry points) | — (root flag) |
| `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | ECL: enterprise graph, applicability engine + read routes, exec dashboard; prerequisite half of the connector + citation double-fences | — (pre-EAR, root flag) |
| `SECURELOGIC_CAPABILITY_GATING_ENABLED` | P9 dual-gate: core-domain premium routes also accept an explicit per-org `organizations.core_platform_capability = TRUE` grant | — (independent; changes nothing until a grant is written) |
| `SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED` | P11: Brief GET `:id` items carry `applicability_citations` | AND `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` |
| connector sync (Phase 3b routes/worker) | `/api/enterprise-connectors*` + sync worker | double-fenced: ECL flag AND registry flag |

Independent, pre-existing, not owned by this runbook:
`SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED` (ECL dispatcher),
`SECURELOGIC_BRIEF_PROVENANCE_ENABLED` (provenance writes — required if
citation joins should also cover corroborating signals later).

## 2. Enablement order (staging first; each step is independently rollbackable)

**Step 0 — prerequisites (no flags).**
- All migrations through `20260810_asset_assessments.sql` applied (deploy does
  this; verify: `SELECT count(*) FROM information_schema.tables WHERE table_name IN ('assets','asset_assessments')` → 2).
- Backfill (idempotent, safe while dark):
  `MIGRATION_DATABASE_URL=… npx tsx scripts/backfill-asset-registry.ts`
  Exit gate: script prints zero remaining NULL `asset_id` gaps.

**Step 1 — registry read/write surface.**

*Prerequisites (in addition to Step 0):* `SECURELOGIC_ASSET_REGISTRY_ENABLED` is
a ROOT flag — the registry read/write/UI surface depends on NO other flag. The
ECL flag (Step 2), capability-gating (Step 4), and citation flag (Step 5) are
independent and are NOT required here. The org used for validation must hold the
`enterprise_context` capability (see *Capability* below).

*Enable — two staging services (the two-switch model):*
- `securelogic-engine-staging` — gates every `/api/assets*` route (404-before-auth
  while off). Its flag lives in `render.yaml` (staging engine block): set that
  block to `value: "true"` and deploy, or override the env in the Render dashboard
  for the service. Leave the prod `securelogic-engine` block at `"false"`.
- `securelogic-app-staging` — gates the "Asset Registry" nav item and the
  `/assets/new` dark panel. This service is dashboard-only (NOT defined in
  `render.yaml`), so set `SECURELOGIC_ASSET_REGISTRY_ENABLED=true` in the Render
  dashboard env for it directly.
- `securelogic-intelligence-worker-staging` is NOT required for this validation
  (it only affects background registration + connector sync + the async matcher);
  leave it dark unless validating those.

*Redeploy/restart:* the flag is RUNTIME env on both sides (the engine reads it
per request; the app reads it server-side in `layout.tsx` — NOT `NEXT_PUBLIC`, so
no rebuild). Saving the env in Render auto-triggers a redeploy/restart; wait for
BOTH services to report "Live" before validating. Order does not matter and there
is no split-brain window — each side fails closed independently (engine 404s, app
hides the nav) until its own restart completes.

*Capability:* the registry reuses the `enterprise_context` capability, granted
automatically to orgs whose entitlement is `platform`, `platform_annual`,
`premium`, or Enterprise. It is NOT granted to the Brief tiers `professional`
(Brief Pro) or `teams`/`team` (Brief Team) — a Team-tier org sees the nav but hits
a `capability_required` (403) wall. Grant it explicitly against the STAGING
database:
```sql
UPDATE organizations SET enterprise_context_capability = TRUE WHERE id = '<staging-org-id>';
-- NULL = fall back to the entitlement default; FALSE = explicit deny.
```

- Validate (staging org with API key):
  - `GET /api/assets` → 200, count equals
    `SELECT count(*) FROM asset_registry_v WHERE organization_id = '<org>'`.
  - Create an endpoint via `POST /api/assets`, read it back through
    `GET /api/assets/:id`, confirm one `assets` row + one `endpoints` row.
  - `POST /api/asset-assessments` for that asset; PATCH it
    `in_progress → deficient` with severity → exactly one `findings` row with
    `source_type='asset_assessment'`.
- Validate (app management UI). Sign in as a platform user in the same staging
  org holding the `enterprise_context` capability:
  - **Nav (single canonical entry, P12):** the "Assets" dropdown exposes exactly
    ONE item — **Asset Registry** (`/assets`). Vendors and AI Systems are NOT
    separate menu items; they are managed inside the registry as asset
    types/filters (type-filter chips on `/assets`, which also has the "+ Add
    asset" action). Their direct routes (`/vendors`, `/ai-systems`) still work
    for back-compat but are not primary navigation. (Flag off → Asset Registry
    disappears and the dropdown reverts to the legacy `[Vendors, AI Systems]`
    menu, byte-identical to before.)
  - **Create:** `/assets/new` → Infrastructure section → pick *Endpoint* →
    submit the form → lands on `/assets/:id` with the typed detail rendered.
    Cross-check one `assets` + one `endpoints` row (same as the API path).
  - **Cloud resource required field:** create a *Cloud Resource* with no
    provider → the form blocks submit (provider is required, matching the
    engine `provider_required`).
  - **Edit / archive / delete:** on the new asset's detail page → Edit changes a
    typed field; Archive flips `status → archived` (row retained); Delete (after
    confirm) removes it and returns to `/assets`.
  - **Federation (EAR-AD-1):** open a *vendor*-backed row → detail shows
    "managed on its own screen" with a deep-link, **no** Edit/Delete; the
    `/assets/new` picker routes Vendors/AI Systems to their own `/new` screens.
  - **Connect enterprise systems (P13):** `/assets/new` → "Connect enterprise
    systems" → **`/assets/connect`** lists the connector catalog grouped by
    category (CMDB / cloud / vulnerability / identity / endpoint) with each
    connector's live state (Connected / Configured / Not connected) from
    `GET /api/connectors`. This is **double-fenced** — it also needs the ECL flag
    (`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`); with ECL off it shows the neutral
    "not available" panel (NOT a "coming soon"). Credentials are operator-owned,
    so there is no self-serve credential form — configuration is administered via
    the connectors API.
  - **Setup Wizard integration (P13):** with the flag on, `/getting-started`
    step 2 becomes **"Build your asset inventory"** and its CTA launches the
    SAME canonical registry onboarding (`/assets/new` → create / import /
    connect) — the wizard owns no onboarding logic. The step completes once the
    org has ≥1 registry asset. (SOC upload stays in Vendor Management — it is NOT
    in this flow.)
  - **Dark parity:** with the app-side flag `false`, the nav entry is hidden;
    `/assets`, `/assets/new`, `/assets/:id/edit`, `/assets/connect` all render the
    neutral "not available" panel (no form, no leak); and `/getting-started`
    step 2 is byte-for-byte the legacy "Add your first vendor".
- Rollback: set `SECURELOGIC_ASSET_REGISTRY_ENABLED` back to `false` on BOTH
  `securelogic-engine-staging` (revert the render.yaml staging block if edited)
  and `securelogic-app-staging` (clear the dashboard env); let both restart. The
  whole surface 404s before auth again and the UI returns to the neutral panel;
  rows written remain (inert, additive) — optionally delete test assets via the
  UI first. Leave `enterprise_context_capability` as set, or reset with
  `UPDATE organizations SET enterprise_context_capability = NULL WHERE id = '<staging-org-id>'`.

**Step 2 — ECL (if not already on).**
Set `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED=true`.
- Owned by the ECL goal's own validation (enterprise-context tracker);
  needed here only as the second half of the two double-fences.
- Rollback: flag off; connector + citation surfaces go dark with it.

**Step 3 — connector sync (needs Steps 1+2).**
- Validate: create a connector config, run one sync, check
  `relationships_created`/`unresolved` counters in the sync summary; re-run
  sync → `relationships_existing` grows, `created` = 0 (idempotent).
- Rollback: either flag off kills the surface; connector rows persist inert.

**Step 4 — P9 dual-gate (independent of Steps 1–3).**
Set `SECURELOGIC_CAPABILITY_GATING_ENABLED=true`.
- With NO grants written, behavior is byte-identical (entitlement leg
  unchanged; capability leg only consulted on 403). Validate: premium org
  passes, starter org gets the same `insufficient_entitlement` body as
  before.
- To grant: `UPDATE organizations SET core_platform_capability = TRUE WHERE id = '<org>'`
  → that org now passes core-domain premium gates regardless of tier.
- Rollback: flag off (grants stay recorded, inert). **Removing the
  entitlement leg is the P9 STOP GATE — a product decision, never this flag.**
- P9 scope note (memo §6): `vendorAssessments`/`dependencyAssessments` still
  gate on raw `requireEntitlement("premium")` — a capability grant does NOT
  admit an org to those two stacks until the cutover decision normalizes them.

**Step 5 — Brief citations (needs Step 2).**
Set `SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED=true`.
- Validate: for an org with applicability decisions, `GET
  /api/intelligence-briefs/:id` items whose `cyber_signal_id` has decisions
  now carry `applicability_citations` (current decision per target); items
  without decisions are unchanged; with the flag off the response is
  byte-identical to before.
- Rollback: flag off. Fail-open by design: a citation lookup error logs
  `brief_applicability_citation_lookup_failed` and serves the Brief without
  citations — citation problems can never 500 the Brief.

## 3. Staging validation queries (run after Steps 1–5)

```sql
-- Registry coverage: every live backing row is registered
SELECT (SELECT count(*) FROM vendors WHERE asset_id IS NULL)
     + (SELECT count(*) FROM ai_systems WHERE asset_id IS NULL)
     + (SELECT count(*) FROM enterprise_entities WHERE asset_id IS NULL) AS unregistered; -- expect 0

-- Registry/view identity integrity
SELECT count(*) FROM asset_registry_v v LEFT JOIN assets a ON a.id = v.asset_id
 WHERE a.id IS NULL AND v.backing_kind NOT IN ('vendors','ai_systems','enterprise_entities'); -- expect 0

-- P10: findings provenance is unambiguous
SELECT source_type, count(*) FROM findings GROUP BY source_type ORDER BY 1;

-- P9: grants in effect
SELECT id, name FROM organizations WHERE core_platform_capability IS TRUE;

-- P11: citations resolvable for a brief's signals (spot check one brief id)
SELECT DISTINCT ON (aa.signal_id, aa.target_type, aa.target_id)
       ibi.brief_id, aa.signal_id, aa.target_type, aa.decision
  FROM intelligence_brief_items ibi
  JOIN applicability_assessments aa
    ON aa.organization_id = ibi.organization_id AND aa.signal_id = ibi.cyber_signal_id
 WHERE ibi.brief_id = '<brief-id>'
 ORDER BY aa.signal_id, aa.target_type, aa.target_id, aa.seq DESC;
```

## 4. Rollback map (per phase, all forward-only-safe)

| Shipped piece | Rollback |
|---|---|
| Any route surface | Its flag(s) → `false`; 404-before-auth returns |
| `20260810` asset_assessments | `DROP TABLE asset_assessments`; re-narrow findings/evidence `source_type` CHECKs (values unused while dark) |
| `20260809` capability column | `ALTER TABLE organizations DROP COLUMN core_platform_capability` |
| `20260806`–`20260808` detail/connector tables | DROP in reverse order (documented in each migration header) |
| `20260802`/`20260803` view + spine | `DROP VIEW asset_registry_v; DROP TABLE assets` — ONLY if back-pointer columns are dropped first; realistically: leave in place, they are inert |
| Backfill | No rollback needed — rows are additive and inert while dark |

## 5. Production enablement checklist (GATE B — requires an explicit Simmee ruling first)

1. ☐ Simmee ruling recorded (date, scope) — lifts GATE B.
2. ☐ Staging has run Steps 0–5 green for ≥ 1 week including a connector sync
   and a generated Brief with citations.
3. ☐ Backfill executed against prod (idempotent; run during low traffic).
4. ☐ Flags in prod in the Step 1→5 order, one deploy each, with the §3
   queries after each step.
5. ☐ P9 grants: none at enablement; grants are individual operator actions
   with audit trail.
6. ☐ Rollback rehearsal: flag-off each surface once in staging and confirm
   404-before-auth returns.
7. ☐ The P9 cutover (entitlement-leg removal) is NOT part of enablement —
   separate product decision (STOP GATE).
