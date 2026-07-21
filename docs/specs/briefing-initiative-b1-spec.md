# The Briefing Initiative — B1 Foundation (decision record)

Status: **BUILT, dark — shipped to `develop` (operator-approved 2026-07-21)**. Flag:
`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` (app-only; prod `"false"`, staging
`"true"` in render.yaml). Flag-off is the legacy `/dashboard` byte-for-byte.

Program: transform the generic Dashboard into **The Briefing** — a personalized,
role-aware opening experience — without collapsing the three concepts:
The Briefing (what matters to me now) · Operational Views (what do I inspect) ·
Dashboards (how is the organization performing). Phases B1–B5; this record
covers B1 only. Architecture reviewed pre-implementation (architect-review
verdict: approve with corrections; corrections adopted).

## Current-state ground truth (verified, 2026-07-21)

- `/dashboard` is the universal post-login landing page and the target of ~45
  entitlement-gate redirects, Stripe return URLs, and alert emails — the URL is
  load-bearing and never changes.
- The page had two rendering regimes: fixed sections (Latest Brief, Account/
  Billing, pending-review callout, Recent Findings, Framework Readiness) plus
  the 12-tile customizable posture grid (`PostureDashboard`).
- The existing customization feature (`dashboard_preferences`, migration
  `20260601`; personal → org_default → system_default; RLS'd; audited; GDPR-
  integrated) is a sound **persistence spine** but not a registry: two
  hand-synced constant arrays (engine `VALID_TILE_IDS` ↔ app `TILE_LABELS`) +
  a render switch; version-less `{id, visible, order}` layout; no scope/size/
  permission metadata; all tiles fed from one monolithic
  `GET /api/dashboard/summary` payload.
- Scope labeling existed only on the pending-review callout (`pendingReviewTile()`,
  commit `a817aa36`): personal-first, honest-null, org variant self-declares.
  The engine already returns the personal counts the dashboard never used:
  `my_work_open`, `my_pending_reviews_open` (findings summary),
  `my_open_count`/`my_overdue_count` (actions summary) — all under the strict
  server-resolved `owner=me` contract; API-key sessions omit them (honest
  unknown).
- Roles are `admin | analyst | viewer` only — no persona/team model exists.
  Flags are env-var only, dark by default (GATE B).

## B1 architecture (chosen)

**App-only, zero engine surface, zero schema, no migration.** The Briefing is an
output-surface recomposition over existing org-scoped engine reads — no
duplicated business queries.

- **Module contract + registry** — `app/src/lib/briefing/contracts.ts` +
  `registry.ts`: pure serializable data (id, title, description, zone, category,
  scope `personal|organization`, requiresUserIdentity, minEntitlement,
  requiredFlag, destination, legacyTileId). Render map lives separately in
  `app/src/app/dashboard/briefing/TheBriefing.tsx` so a future engine-side
  validation manifest can be **generated** from the registry (knowledge-index
  pattern). The registry metadata is presentation composition, NOT an
  authorization boundary — enforcement stays in the engine's per-route
  entitlement chain.
- **Eligibility resolution** — `resolveBriefing.ts`, server-side pure filter:
  entitlement × user-identity × flags. Personal modules are OMITTED (never
  zeroed) for identity-less sessions. `filterRequestedModules()` is B2's saved-
  layout enforcement point: requested ⊆ eligible, always.
- **Orchestration** — `composeBriefing.ts`: pure reshaping of the page's
  existing fetch results into per-module view models with honest states (failed
  fetch = unknown; zeros = real all-clear; null posture = insufficient data).
  Modules never fetch.
- **Default composition** (flag-on, platform tiers): three priority zones —
  **Your Work** (My Work; My Pending Reviews) → **Across Your Organization**
  (Needs Attention, Remediation Actions, Ready to Close, Security Posture,
  Recent Findings) → **Intelligence** (Latest Brief) — every module carries an
  explicit "You"/"Organization" scope chip, plus a Dashboards link row
  (/posture, /frameworks). Non-platform tiers keep the legacy page (brief card +
  sample-dashboard upsell) even flag-on.
- **Product identity**: URL stays `/dashboard`. Nav label "Briefing" renders
  ONLY when `risk_workspace` AND `briefing` flags are both on, via a cloned
  `WORKSPACE_NAV_ITEMS`; legacy `NAV_ITEMS` (the knowledge-index source) is
  byte-identical. `briefingHomeLabel()` follows the a8bbe631 helper pattern.

## Modules included / excluded (classification)

Included: my_work (new — uses previously-unused personal counts),
my_pending_reviews, needs_attention (supersedes findings_donut), overdue_actions
(supersedes actions_ring), ready_to_close, posture_score, recent_findings,
latest_brief.

Excluded from the opening experience (not migrated): Account/Billing cards
(navigational — user menu), inventory_grid (inventory, not attention), and the
nine analytical tiles (risks_breakdown, risk_heatmap, posture_trend,
domain_posture, open_items_aging, vendor_risk, framework_gaps,
compliance_coverage + Framework Readiness widget) — their home is the /posture
and /frameworks dashboards, which the Briefing links to.

## Migration behavior (ruled)

B1 renders the **canonical default composition and ignores `dashboard_preferences`
entirely** (architect ruling: a flat visible/order list has no meaningful
projection onto a sectioned composition; a lossy interim mapping would become a
behavioral contract broken again by B2; affected rows are single digits
pre-launch). Flag off = legacy page + legacy preferences, untouched. The
ratified legacy-tile → module projection exists as the pure, tested
`legacyTileToModule()` — B2's one-time migration key. New versioned layout
persistence (envelope `{version, modules:[…]}`, new table modeled on
`finding_saved_views`, engine-owned validation manifest) is **deferred to B2**,
when an edit surface exists to justify the schema.

## Alternatives rejected

- DB-driven module registry (no writer/reader yet; components are code).
- Reading/mapping legacy preferences in B1 (lossy, throwaway fetch path).
- New briefing-layout table in B1 (schema ahead of its writer).
- Renaming the legacy NAV_ITEMS label (forces knowledge-index regeneration;
  breaks the dark model).
- Flag name `SECURELOGIC_BRIEFING_ENABLED` (collides with the Intelligence-Brief
  `SECURELOGIC_BRIEF*` flag family on the ops surface).

## Tests

`registry.test.ts` (contract: unique ids, serializable, total legacy mapping,
round-trip), `resolveBriefing.test.ts` (entitlement/identity/flag matrix;
requested ⊆ eligible property), `composeBriefing.test.ts` (honest states;
a817aa36 scope rules), `briefing.render.test.tsx` (flag-off no-markers;
zones/chips; **the mandatory entitlement-branch test** — non-platform + flag-on
⇒ sample preview, zero platform hrefs; API-key ⇒ personal zone absent),
navigationFlags additions (flag matrix; legacy nav byte-identity). Full app
suite 83 files / 1105 tests green; engine knowledge-index + workflow drift
tests green; `next build` green. No isolation-harness additions — no engine SQL
changed.

## Known limitations / open items

- **Nav label RULED (operator, 2026-07-21): "Briefing" stands.** It is
  deliberately distinct from the Intelligence group's "Briefs" (the wedge
  product); the two vocabularies must not blur in future copy.
- **BUILD_SEQUENCE.md registers The Briefing Initiative** (entry added with the
  B1 commit, operator-approved). The read-surface taxonomy (Briefing vs
  Operational Views vs Dashboards) is an explicit architectural principle in
  `FINAL_PRODUCT_STANDARD.md`.
- Flag-on with an org-default tile layout saved by an admin: the Briefing
  ignores it (documented above); B2 must define org-default semantics in the
  new model.
- `briefing` label only renders with `risk_workspace` on (staging runs both).

## B1 hardening (2026-07-21, operator-directed — the pre-B2 blockers)

- **Engine-side module manifest — BUILT (discharges the B2 hard precondition).**
  `src/api/lib/briefingModuleManifest.generated.ts` is GENERATED from the
  canonical app registry (`npm run generate:briefing-manifest`, script
  `scripts/generate-briefing-module-manifest.ts`) and drift-tested by
  `src/api/tests/briefingModuleManifest.test.ts` — the Application Knowledge
  Index pattern. Validation surface: `briefingModuleManifest.ts`
  (`isKnownBriefingModuleId` / `briefingManifestModule`). INERT by construction
  — no route imports it until B2's write path, which MUST validate ids and
  scope/flag metadata through it (never trust the client catalog).
- **ACTIVE-actions presentation fallback centralized** —
  `app/src/lib/actionsMetrics.ts` `activeActionsCount()` replaces the three
  inline copies (ActionsRing, OpenItemsAging, Briefing composer); unit-tested.
  The predicate itself stays engine-owned (`metricDefinitions.ts`).
- **Flag-ownership concern resolved by documentation, not by flipping:**
  `SECURELOGIC_INDEPENDENT_REVIEW_ENABLED` belongs to the Independent
  Governance Review feature and is operator/dashboard-set (not Blueprint-owned).
  The My Pending Reviews module fails closed without it — by design. Staging
  validation of that module requires the operator to enable that feature's
  flags (both app and engine halves); B1 does not change another feature's
  rollout posture.

## B2 persistence direction — the layout envelope (B1.1; DOCUMENTED, NOT built)

**Ratified direction, documentation only.** Nothing below exists in code,
schema, persistence, serialization, or any API — B1.1 changes zero runtime
behavior. This section exists so B2 does not design an overly simple
persistence model that becomes expensive to migrate in B3/B4.

The persisted user layout (B2) MUST be designed around **module instances, not
bare module identifiers**, inside a versioned envelope. Target shape:

```jsonc
{
  "version": 1,
  "modules": [
    {
      "moduleId": "needs_attention",   // registry id — the module's IDENTITY
      "instanceKey": "…",              // stable per-instance key within the layout
      "config": {}                      // per-instance configuration (empty in B2)
    }
  ]
}
```

Why instance-shaped from day one:
- The registry is code — cheap to evolve additively. The layout is persisted
  per-user rows inherited by B3 profiles and B4 templates — expensive to
  migrate. The entry shape is therefore the ONE place a too-simple B2 decision
  compounds: bare `{moduleId, order}` rows cannot represent configured or
  multi-instance modules without a row migration across every user, profile,
  and template.
- `instanceKey` makes B3's "reuse the same module configuration across
  profiles" and B4's template-inheritance/override precedence representable
  without schema change, even though B2 ships single-instance with empty
  `config`.
- The envelope `version` (not per-row columns) is what future migrations key
  on — the version-less `dashboard_preferences` JSONB is the cautionary
  precedent.

Boundaries (mirrors the contracts.ts B1.1 object-model section): the layout
references registry ids and never restates module metadata; eligibility is
re-resolved against the registry on every render (a stored layout never grants
access); the engine validates ids via the generated manifest
(`briefingModuleManifest.ts`) on any write path.

## Recommended B2 boundary

Role-aware defaults + personal customization: (1) versioned layout persistence
(new table on the `finding_saved_views` template; the instance-shaped envelope
documented above);
(2) wire the B2 write path through the SHIPPED engine manifest validators
(`briefingModuleManifest.ts`) — precondition discharged above; (3) one-time
`dashboard_preferences` → briefing migration via `legacyTileToModule()` with
visible disclosure of dropped tiles; (4) add/remove/reorder UI + restore
default; (5) role-informed starting templates within the existing
`admin|analyst|viewer` vocabulary plus derived responsibilities (has review
assignments, has owned work) — no new persona model without an explicit domain
decision.
