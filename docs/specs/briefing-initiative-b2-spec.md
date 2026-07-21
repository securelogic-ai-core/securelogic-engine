# The Briefing Initiative — B2: Role-Aware Defaults & Personalization (decision record)

Status: **IN PROGRESS** (operator-authorized 2026-07-21). Builds on B1
(`docs/specs/briefing-initiative-b1-spec.md`, SHIPPED dark, staging-verified at
`42e247ca`). Flag posture unchanged: `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED`,
prod `"false"`, staging `"true"` — B2 adds the ENGINE half of the two-switch
model (same flag name on the engine services; layout routes 404 while off).

## Ground truth verified before design (2026-07-21)

- B1 assumptions re-verified: registry/resolver/composer unchanged since
  `42e247ca`; engine manifest regenerates byte-identical; flag-off byte-identity
  holds; staging serves `42e247ca`.
- **Roles**: `users.role`, values `admin | analyst | viewer` by convention —
  **no DB CHECK constraint**; DB column default is legacy `'member'`
  (`001_securelogic_platform.sql`); JWT carries `role` (`src/api/lib/jwt.ts`);
  `requireApiKey` sets `req.userRole`/`req.userId` and **globally blocks
  viewer mutations** (403 `read_only_access`); app mirrors role into
  iron-session `userRole` (login coalesces `?? "viewer"`, SSO `?? "analyst"`).
  Role and entitlement are orthogonal axes (org-level `entitlement_level`,
  platform surface = `requireEntitlement("premium")` rank 4, per
  `TENANT_ISOLATION_STANDARD.md` §9).
- **Existing customization**: `dashboard_preferences` (migration `20260601`,
  RLS'd `20260703`) — `personal` rows (unique per org+user) and `org_default`
  rows (unique per org, `user_id IS NULL`); `{id, visible, order}` JSONB over
  the 12-tile vocabulary; `GET /api/dashboard/preferences` resolves
  personal → org_default → system_default and **returns `{layout, source}`**;
  writes are `premium` + audited.
- **Persistence template**: `finding_saved_views` (migration `20260710`) — the
  cleanest per-user preference implementation: org+user scoped, chain
  `requireApiKey → attachOrganizationContext → requireEntitlement("premium")` +
  `asTenant`, pure whitelist validation lib, canonical NULLIF RLS policy +
  `GRANT … TO app_request`, real-Postgres isolation tests, dark behind an env
  flag (404 when off). Two gaps B2 must NOT copy: it writes **no audit
  events** (tenant standard §10.A requires them on mutations) and has no PUT.
- **No role-default or layout-template concept exists anywhere** (verified).
- **B1 weakness discovered (reported, not fixed here — see Concerns)**: the
  analytical tiles' "home is /posture" ruling is aspirational. `PostureDashboard`
  (the 12-tile grid incl. risk_heatmap / posture_trend / open_items_aging …)
  renders ONLY on `/dashboard`'s flag-off branch; `/posture` renders a simpler
  summary and does not include those tiles. Flag-on therefore removes the
  analytical grid from the product surface. This constrains B2's migration
  *disclosure copy* (must not promise /posture parity) and must gate prod
  enablement (GATE B) of the Briefing flag.

## Mandatory design exercise — the long-term model for The Briefing

Question: should SecureLogic ultimately have (1) exactly one personalized
Briefing, (2) multiple user-created Briefings, or (3) a dynamically generated
Briefing?

**Recommendation: (1) for B2 — exactly one personalized Briefing per user,
stored in a schema that is already profile-shaped so (2) is B3's additive
upgrade, with dynamism permanently bounded to deterministic composition rules.**

- *One Briefing* wins on operational simplicity (one row per org+user, GET/PUT/
  DELETE, no lifecycle UI), discoverability (`/dashboard` IS your Briefing — no
  "which layout am I in?" state), and user expectation (an opening experience is
  singular; the platform already offers analytical variety through Dashboards —
  the FINAL_PRODUCT_STANDARD §5 taxonomy exists precisely so the Briefing does
  not become a dashboard builder). Migration from `dashboard_preferences`
  (a single implicit layout) is 1:1. B4 org templates get simple precedence
  (template < user override) instead of "which of the user's N briefings does
  the template bind to?".
- *Multiple named Briefings* is B3 (profiles) verbatim — a layout with identity
  and lifecycle. Building it now front-loads naming/switching/default-marking UI
  before evidence that users customize even one layout, and adds state that
  hurts discoverability. B2's obligation is only that the schema not preclude
  it: B3 = "allow N rows + add `name` + an active pointer" (additive migration;
  existing rows survive as the active profile). Nothing is lost by deferring.
- *Dynamically generated* is rejected as the layout model: a layout that
  recomputes per visit destroys placement trust, undermines the "every number
  links to a destination that reproduces it at the same scope" principle, and
  preempts B5 (the intelligent Briefing) without its authorization. The CORRECT
  dynamic elements are kept and bounded: eligibility re-resolution on every
  render (permissions override personalization), data-presence collapse (empty
  personal modules hide), role-aware INITIAL defaults computed at request time,
  and deterministic, dismissible suggestions (never auto-applied).

This conclusion **confirms** the approved roadmap (B2 → B3 → B4 → B5) rather
than changing it; no design deviation to explain.

## Architect review (pre-implementation)

architect-review verdict: **approve-with-corrections** (2026-07-21); all
corrections adopted:

- **C1 GDPR (blocking)**: the users-row CASCADE never fires (erasure tombstones
  the row) — `briefing_layouts` is added to `accountDeletionReaper.ts`'s
  Category-B per-user DELETE block, with test coverage. The review also found
  `finding_saved_views` was ALREADY missing from that block — a pre-existing
  GDPR erasure defect in the template B2 copies; fixed in the same block as a
  clearly-marked one-line rider (operator may strike it at commit review).
  Export decision recorded: preference objects (`dashboard_preferences`,
  `finding_saved_views`, `briefing_layouts`) are deliberately EXCLUDED from the
  data-rights export bundle — consistent with the existing policy, which
  exports none of them.
- **C2 reset semantics (ruled)**: UI "Restore role default" loads the role
  default into the customize panel and finishes with an EXPLICIT save (a
  persisted snapshot — the user's deliberate choice). Bare API
  `DELETE /api/briefing/layout` means "return to the unsaved state": the legacy
  projection if a legacy personal/org row still exists, else the live role
  default. Never fixed by writing to `dashboard_preferences` (cross-feature
  writes would corrupt the flag-off surface).
- **C3 B3/B4 hygiene**: unique constraint is NAMED
  (`briefing_layouts_one_per_user`) so B3's DROP is deterministic; B3 must add
  a replacement `(organization_id, user_id)` lookup index and rewrite the
  `ON CONFLICT` upsert. `user_id` is NOT NULL permanently — B4 org templates
  are a separate table (contracts.ts boundary #4); the `dashboard_preferences`
  `org_default` dual-purpose-row pattern is explicitly rejected.
- **C4 eligibility-on-write (ruled)**: PUT ACCEPTS a known-but-currently-
  ineligible module id (flag off / entitlement-shy). Eligibility is a
  render-time concern — a stored layout never grants access, and rejecting
  would fail saves whenever a flag flips. The manifest validates identity and
  shape, not session eligibility.
- **C5 (deferred)**: the legacy projection has no sunset — every flag-on render
  for a never-saved user with legacy rows re-fetches preferences. Acceptable at
  current scale; B3 should either skip the fetch when no legacy rows exist or
  retire the projection.
- **C6 copy**: viewers cannot save at all (platform viewer-mutation block), so
  role-default omissions are effectively fixed for them — the customize surface
  is hidden for viewer sessions, not "addable". Interleaved saved orders render
  a zone title more than once (contiguous-run grouping) — accepted behavior,
  not a bug.

## B2 architecture (chosen)

### Persistence — `briefing_layouts` (migration `20260721_briefing_layouts.sql`)

Modeled on `finding_saved_views`; one ACTIVE layout per user:

- `id` UUID PK; `organization_id` UUID NOT NULL FK CASCADE; `user_id` UUID NOT
  NULL FK users CASCADE; `layout` JSONB NOT NULL; `created_at` / `updated_at`;
  **`UNIQUE (organization_id, user_id)`** (the B2 "exactly one" rule — B3
  relaxes it additively).
- Canonical NULLIF RLS policy + `GRANT SELECT, INSERT, UPDATE, DELETE … TO
  app_request` (inert until the role flip, mandatory on new customer-data
  tables).
- `layout` holds ONLY the ratified instance-shaped versioned envelope:
  `{"version": 1, "modules": [{"moduleId", "instanceKey", "config"}]}`.
  B2 invariants (enforced by engine validation): `version === 1`;
  `instanceKey === moduleId` (single-instance phase); `config` must be `{}`
  (no speculative fields — evolution policy); no duplicate `moduleId`; every
  `moduleId` known to the **generated engine manifest** (never the client
  catalog); 1..24 modules. The layout is the COMPLETE ordered statement of what
  is shown — absence = hidden (no `visible:false` rows).

### Engine surface — `src/api/routes/briefingLayouts.ts`

Dark behind `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` on the ENGINE service
(404 while off — the `findingSavedViews` two-switch posture; render.yaml gets
the flag on both engine services: prod `"false"`, staging `"true"`).

- `GET /api/briefing/layout` — the caller's saved envelope or `{layout: null}`.
- `PUT /api/briefing/layout` — validate via the pure lib
  `src/api/lib/briefingLayoutValidation.ts` (discriminated union; consumes
  `briefingModuleManifest.ts` — the B1-hardening validators, first consumer);
  upsert `ON CONFLICT (organization_id, user_id)`; audit
  `briefing.layout_updated`.
- `DELETE /api/briefing/layout` — reset to defaults (idempotent delete; audit
  `briefing.layout_reset` when a row existed).
- Chain: `requireApiKey → attachOrganizationContext →
  requireEntitlement("premium")` (§9: platform surface) + `requireNotViewer` on
  mutations (defense-in-depth) + `asTenant`. Org id from context, user id from
  `req.userId` — never request input. API-key sessions (no user identity) get
  400 `briefing_layout_requires_user_identity` (the saved-views rule).

### Role-aware defaults — code, not rows

`defaultBriefingModulesForRole(role)` in `app/src/lib/briefing/layout.ts`:
pure, deterministic, computed at request time on EVERY render for users with no
saved row — so default improvements reach non-customizers automatically and a
role change re-seeds the starting experience ("roles influence the initial
experience, not permanently define it"). Defaults are never persisted
implicitly; a row is written only by explicit user save.

- `admin` — canonical registry order (personal work → org picture →
  intelligence; the B1 composition).
- `analyst` — work-first: my_work, my_pending_reviews, needs_attention,
  overdue_actions, ready_to_close, recent_findings, posture_score, latest_brief.
- `viewer` — read-only consumer: posture_score, needs_attention,
  recent_findings, latest_brief. Workflow modules are omitted from the default;
  since viewers cannot persist a layout at all (platform-wide viewer-mutation
  block — see Concerns), this default IS the viewer experience.
- unknown / legacy `'member'` / API-key session — canonical order (safe
  fallback).

Eligibility still gates everything: the resolved list is
`filterRequestedModules(orderedIds, ctx)` — requested ⊆ eligible, always.

### Deterministic recommendations (no AI)

`suggestBriefingModules()` — pure function of (current layout, eligible set,
composed view-model counts): e.g. My Pending Reviews absent while
`myPendingReviews.mine > 0`; a role-default module absent from a saved layout
(surfaces newly-shipped modules to customizers). Rendered ONLY inside the
customize panel as dismissible "Suggested" entries; never auto-applied.

### Migration from `dashboard_preferences` — lazy projection, persist-on-save

No bulk data migration. On flag-on render with **no saved briefing_layouts
row**, the app fetches the EXISTING `GET /api/dashboard/preferences`
(`{layout, source}` — no new query path, no engine read of another feature's
table):

- `source === "system_default"` → pure role default, no banner.
- `source === "personal" | "org_default"` → seed through the ratified, tested
  `legacyTileToModule()`: superseded tiles carry their visibility (a hidden
  `findings_donut` hides `needs_attention`); tiles with no counterpart are
  DROPPED — **visibly**: a disclosure banner names the dropped tiles and where
  their data lives today (honest copy — no /posture-parity promise, per the B1
  weakness above). The projection is deterministic and recomputed per render
  until the user saves ("Save this layout") or resets to role default; only an
  explicit save writes a row. Affected rows are single digits pre-launch.
- Legacy `org_default` rows influence B2 only through this read-time resolution;
  org-published Briefing templates (incl. mandatory-module policy) remain B4
  scope by the contracts.ts object-model boundaries.

### Rendering a saved order

`TheBriefing` renders modules in resolved order, grouped into sections by
**contiguous zone runs** (each module keeps its registry zone title; the
canonical order reproduces exactly the B1 three-section rendering as the
degenerate case). Scope chips survive any placement — the invariant is the
chip, not the zone (contracts.ts B1.1). A failed org summary still renders the
single explicit org error panel; org modules collapse into it.

### Customize surface

Client panel (`CustomizeBriefing.tsx`, modeled on the PostureDashboard
CustomizePanel / SavedViewsBar patterns — dependency-free reorder controls):
show/hide + reorder eligible modules, "Restore role default", suggestions,
save via server actions (`briefingLayoutActions.ts`, the savedViewActions
pattern: engineFetch PUT/DELETE + `revalidatePath("/dashboard")`). Hidden for
viewer sessions (the platform-wide viewer-mutation block means a viewer's save
would 403; see Concerns).

## Seven-section brief (condensed)

1. **Current state** — B1 registry/resolver/composer + inert engine manifest;
   `finding_saved_views` as the persistence sibling; `dashboard_preferences`
   as the legacy spine; roles live and enforced; no defaults concept. (Ground
   truth above, with citations.)
2. **Fit** — new org+user-scoped preference table + premium `asTenant` route
   (engine); pure composition/default/projection logic in `app/src/lib/briefing`
   (app); first consumer of the B1-hardening manifest validators; no new
   patterns invented.
3. **Risks** — tenant (new table: mitigated by template copy + RLS + isolation
   tests); trust-boundary (client-supplied module ids: engine manifest
   validation, requested ⊆ eligible re-resolution); data-model (envelope is
   ratified B1.1 shape; version field owned by envelope); operational
   (forward-only auto-boot migration, idempotent; flag-off = 404, zero prod
   surface); sequencing (B2 explicitly authorized; B3/B4 boundaries respected).
4. **Plan** — migration → validation lib (+tests) → route (+mount, render.yaml
   engine flags) → isolation/RLS tests → app layout lib (+tests) → api.ts
   fetchers + server actions → TheBriefing/page wiring + customize panel →
   render tests → docs.
5. **Files** — listed in §Deliverables of the final report.
6. **Validation** — engine unit (validation matrix), isolation lane
   (cross-org/cross-user + RLS SET ROLE fail-closed), app unit (defaults /
   projection / suggestions / envelope round-trip), render tests (saved order,
   disclosure, viewer read-only, flag-off byte-identity untouched), tsc + build
   both surfaces.
7. **Docs** — this spec; BUILD_SEQUENCE.md Briefing entry updated (B2 status);
   FINAL_PRODUCT_STANDARD taxonomy unchanged (no new principle needed).

## Explicitly deferred (documented, NOT implemented)

- **Blueprint flag → declarative platform state**: today's two-switch env-flag
  model (render.yaml + operator-owned exceptions) is operationally sound but
  invisible to the app at runtime and non-auditable per-org. A future
  platform-state service (per-org feature enablement as data) should absorb it;
  that is an ops/platform package, not a Briefing phase.
- **Ready-to-close canonical service**: `composeBriefing` sources the org-wide
  ready-to-close count from a two-endpoint fallback (`dashboard/summary` →
  `findings/summary`). Both implement one predicate today; the coupling is
  comment-documented. The right fix is a shared engine-side metric definition
  consumed by both summaries (Metric Contract extension) — recommend bundling
  with the next findings-summary engine change, not forcing an engine deploy
  from a personalization package.
- **B3 readiness**: `briefing_layouts` upgrades to profiles by adding `name` +
  an active pointer and relaxing the unique constraint — additive; no row
  migration. Confirmed by design above.

## Concerns raised to the operator (see final B2 report)

1. The `/posture` analytical-home gap (B1 weakness, blocks GATE B for the
   Briefing flag, not B2 completion).
2. Viewer personalization is impossible under the platform-wide viewer-mutation
   block (`requireApiKey`); viewers receive role defaults only. If "every user
   retains control" must include viewers, a later phase needs an explicit,
   security-reviewed allowlist for self-scoped preference writes.
3. `users.role` has no DB CHECK constraint and a legacy `'member'` default —
   pre-existing; B2 treats unknown roles as canonical-default and never
   branches security on role strings.
