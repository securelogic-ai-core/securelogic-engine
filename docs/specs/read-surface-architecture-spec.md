# Read-Surface Architecture — GATE B resolution (decision record)

Status: **RATIFIED & IMPLEMENTED — D1 shipped (operator approval 2026-07-21).**
Reviewed, approved, implemented, and validated; committed to `develop` with the
D1 implementation. §6's "NOT authorized yet" marker is superseded by this
status. One §6 refinement ruled at implementation review: the legacy flag-off
`/dashboard` keeps its Executive Report export until it retires with the
Briefing flag (§5 byte-identity controls); "move the entry point" (§6.2) is
realized as hosting the export on `/posture`, not removing it from the legacy
surface. D2 items remain future, unauthorized packages.
Operator /goal 2026-07-21. Companion to `briefing-initiative-b1-spec.md` /
`briefing-initiative-b2-spec.md` and `FINAL_PRODUCT_STANDARD.md` §Product
standards 5 (the ratified read-surface taxonomy, which this record extends and
does NOT replace). Ground truth below verified against the live route tree,
`app/src/lib/navigation.ts`, and the ERIP workspace audit
(`docs/architecture/erip/ENTERPRISE-RISK-WORKSPACE-AUDIT.md` §2, §5.3).

## 1. Current state (verified)

**First screen.** `/` and the login flow both land every authenticated session
on `/dashboard`, for every role and tier. There is exactly one landing route.

**`/dashboard` is polymorphic.** Flag-on + platform tier → The Briefing (8
modules in 3 zones, scope-chipped, summarize-and-link, B2 personalization).
Otherwise → the legacy page, which mixes FOUR kinds of surface on one screen:
brief reading entry (Latest Brief), account/billing cards, attention elements
(pending-review tile, recent findings), and `PostureDashboard` — the 12-tile
customizable org-analytics grid with the Executive Report PDF export.

**The analytical grid has no other home.** Nine capabilities exist ONLY inside
`PostureDashboard` on the flag-off branch: `risk_heatmap`, `posture_trend`
(90-day), `vendor_risk`, `framework_gaps`, `compliance_coverage`,
`risks_breakdown`, `open_items_aging`, `actions_ring`, `inventory_grid` — plus
layout customize (`dashboard_preferences`) and the Executive Report PDF export.
`/posture` renders only a thin subset (overall score, severity stat cards,
domain table) and appears in NEITHER navigation model (legacy `NAV_ITEMS` nor
dark `WORKSPACE_NAV_ITEMS`) — it is reachable only from tiles and links.

**Dashboards are scattered.** Org-performance analytics live in five places
with no unifying concept: `PostureDashboard` (flag-off `/dashboard`),
`/posture` (thin subset, orphaned), `/executive` (rich cross-dimension
leadership analytics, dark behind `risk_intelligence`), `/frameworks`
(readiness dashboard + template catalog), `/vendors/risk` (vendor analytics;
ERIP audit already ruled it should merge into `/vendors`), and
`/enterprise-context/dashboard` (dark). Framework analytics are implemented
THREE times (`framework_gaps` tile, `compliance_coverage` tile,
`FrameworkReadinessWidget`, vs `/frameworks` readiness cards).

**Operational views are in good shape.** `/findings` correctly separates the
Operations Workspace (13 bucket defs; work-ordering, no rows) from the Finding
Explorer (`?queue=all`; search/investigate), with Decision Workspace detail;
`/actions` (mine/team), `/approvals` (two approval families), `/queue` (Review
Suggested Links), `/vendor-assurance/queue`, `/risks` (register =
list/explorer + stat cards, correctly NOT analytics), `/ask` (org-scoped NL
investigation). This layer matches the ratified taxonomy already.

**Registries are consistent as a family** (`/assets`, `/vendors`,
`/ai-systems`, `/controls`, `/policies`, `/obligations`,
`/enterprise-context`): org-scoped inventories with at most small count
rollups; analytics deliberately live on separate routes. (Known pre-existing
inconsistency: some hard-redirect non-platform users, others render an
upsell/unavailable panel — recorded as debt, out of scope here.)

**Other families:** `/briefs` (wedge reading surface, entitlement-tiered);
admin/account surfaces (`/audit-log` admin-only, `/account`, `/settings/*`);
no `/compliance` or `/intelligence` index routes exist (detail drill-throughs
only, deliberate).

## 2. Problems discovered

- **P1 (GATE B root cause).** B1 split the two concepts squatting on
  `/dashboard` but only built one of them. The Briefing exists; the analytical
  Dashboard was never re-homed. The B1 ruling "the analytical tiles' home is
  /posture and /frameworks" was aspirational — `/posture` never received the
  content. Flag-on therefore REMOVES nine analytical capabilities, customize,
  and the PDF export from the product. This is a missing-destination problem,
  not a taxonomy problem.
- **P2.** `/posture` — the claimed canonical posture destination and the
  Briefing's `posture_score` link target — is nav-orphaned in both IAs and too
  thin to honor the "every number links to a destination that reproduces it"
  rule at analytical depth.
- **P3.** Dashboards as a concept are scattered (5+ locations), duplicated
  (framework analytics ×3, vendor analytics ×2, posture elements ×2), and have
  no navigation identity: flag-on relabels "Dashboard" → "Briefing" and no
  Dashboards destination remains in the header at all (Executive is dark).
- **P4.** Personalization semantics are muddled on the legacy grid:
  `dashboard_preferences` personalizes an ORG-performance surface. Under the
  ratified taxonomy, personalization is a Briefing property ("what matters to
  me"); dashboards are shared organizational truth.
- **P5 (recorded, not GATE B).** Registry entitlement-gate inconsistency;
  `/vendors`+`/vendors/risk` duplication (ERIP merge verdict stands, deferred);
  audit-log is admin-only, which will not serve a future auditor persona.

## 3. Recommended read-surface architecture

Keep the three ratified primary read surfaces. No new primary category is
needed; the inventory pages are classified as a named SUB-FAMILY of
Operational Views. Dynamism/AI stays bounded per B2 (deterministic
composition; B5 not authorized).

1. **The Briefing** (`/dashboard`) — *"What matters to me right now?"*
   - Audience: every signed-in platform user; the universal first screen.
   - Owns: personal work summaries, org attention deltas, prioritized
     pointers, the latest Intelligence Brief card, B2 personalization + role
     defaults + deterministic suggestions.
   - Behavior: summarizes and DIRECTS. Every number links to the destination
     that reproduces it at the same scope. Never hosts explorers, grids,
     trends, heatmaps, inventories, account/billing, or exports.
   - Relationship: the router INTO both other surfaces; owns no data view of
     its own.

2. **Operational Views** — *"What do I need to inspect or work on?"*
   - Audience: practitioners (analysts, reviewers, approvers, TPRM/compliance
     owners).
   - Members: Operations Workspace, Finding Explorer, Decision Workspace,
     Actions, Approvals, Review Suggested Links, Vendor Assurance queue, Risk
     Register (+ detail), Ask (conversational investigation).
   - Sub-family — **Registries** (inventory views): Assets, Vendors, AI
     Systems, Controls, Policies, Obligations, Enterprise Context. They answer
     "what do we have and what state is it in" — inspection substrate, not
     work-ordering and not analytics. They stay under their existing Assets /
     Compliance nav groups; naming them a sub-family solves the classification
     question without inventing navigation.
   - Behavior: lists, filters, queues, search, execution; org-scoped with
     explicit personal filters (`owner=me`, `view=mine`).
   - Relationship: destination of Briefing links and dashboard drill-downs;
     detail pages are where decisions are recorded.

3. **Dashboards** — *"How is the organization performing?"*
   - A first-class CONCEPT realized as a small set of named destinations —
     deliberately NOT one page called "Dashboard" and NOT a dashboard builder:
     - **Posture Dashboard** (`/posture`, canonical org-performance home):
       score + severity + domain breakdown PLUS the analytical grid re-homed
       from `PostureDashboard` (heatmap, trend, aging, risks breakdown,
       vendor risk, framework gaps, compliance coverage, inventory rollup) and
       the Executive Report PDF export. Practitioner/leadership operating
       analytics.
     - **Executive** (`/executive`): cross-dimension leadership KPIs, trends,
       forecast, connector health — board packaging. Distinct audience and
       cadence from Posture; keep separate.
     - **Domain dashboards**: Framework Readiness (on `/frameworks`), Vendor
       Risk (`/vendors/risk`, until the ERIP merge), Context analytics (dark).
   - Behavior: org-scope only, shared truth, NO per-user personalization
     (personalization is a Briefing property). Fixed canonical composition;
     every chart drills into the operational view that reproduces it.
   - Relationship: linked from the Briefing's Dashboards row and nav; drills
     down into Operational Views.

Supporting families (not read-surface peers): **Reading** (`/briefs`, the
wedge), **Admin/Account** (`/audit-log`, `/settings/*`, `/account`),
onboarding.

**Movement model:** Briefing → (work) Operational Views | → (performance)
Dashboards; Dashboards → drill → Operational Views (filtered); Operational
Views → detail → decision → posture reflects it. This is the ERIP spine
(Intelligence funnel → Finding work → Action → Posture measurement) expressed
as navigation.

**Landing answers:** everyone lands on the Briefing; roles differ by B2
composition, not by destination. Executives' Briefing leads with posture +
attention and links to Executive/Posture; analysts lead with My Work;
reviewers with My Pending Reviews; a future auditor persona reads compliance
registries + evidence (audit-log gating is a later decision). B2
personalization strengthens the single-landing model and changes none of
these answers.

## 4. Navigation recommendation

- Legacy `NAV_ITEMS` (prod-live, knowledge-index source): UNTOUCHED.
- `WORKSPACE_NAV_ITEMS` (dark): add ONE entry — a top-level **"Posture"** link
  to `/posture` (platform), alongside Executive. This fixes the only material
  gap (the canonical dashboard is unreachable from nav). Do NOT create a
  "Dashboards" nav group for two entries; revisit grouping only if a third
  peer dashboard becomes nav-worthy. No renames; no other moves.

## 5. Migration strategy

- **D1 — close GATE B (smallest coherent change, below).**
- **D2 (separate, later packages; not GATE B blockers):** consolidate the
  three framework-analytics implementations; execute the ERIP
  `/vendors`+`/vendors/risk` merge; registry entitlement-gate consistency
  pass; `dashboard_preferences` sunset (with the B3 legacy-projection sunset
  already noted in the B2 spec).
- Legacy flag-off `/dashboard` (incl. its customize + preferences) remains
  byte-identical until the Briefing flag flips in prod; after the flip it is
  retired naturally with the flag.

## 6. Smallest implementation to close GATE B (D1 — SHIPPED; marker superseded per the header note)

App-only; no schema, no engine change, no new flags.

1. Re-home the analytical grid to `/posture`: render the existing chart
   components (`DashboardCharts.tsx` etc. — reuse, don't fork) in a fixed
   canonical composition below the current summary, platform-gated, org scope;
   add the page-level fetches `/posture` lacks (posture history, findings
   summary — all existing endpoints). De-duplicate against `/posture`'s
   existing score/severity/domain elements. No per-user customization.
2. Move the Executive Report PDF export entry point to `/posture`.
3. Add the dark "Posture" link to `WORKSPACE_NAV_ITEMS` (flag-off nav and
   knowledge index byte-identical).
4. Update the B2 migration-disclosure copy: once `/posture` has parity, the
   banner may truthfully say where each dropped tile lives.
5. Tests: `/posture` render (composition, entitlement, drill links), nav flag
   test, Briefing disclosure copy test; flag-off byte-identity re-asserted.

Exit criterion: with the Briefing flag ON, no analytical capability, export,
or destination is lost anywhere in the product → GATE B for
`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` is dischargeable (prod flip remains a
separate operator ruling).

## 7. Remaining risks

- Composition judgment on `/posture` (overlap between its existing elements
  and grid tiles) — settled at implementation review, low risk.
- Losing per-user grid customization is a deliberate simplification; the B2
  disclosure banner plus Briefing personalization are the answer. If evidence
  shows demand for personalized ANALYTICS (not attention), that is a new
  product question — not assumed.
- Executive vs Posture boundary must stay ruled: Posture = operating
  analytics; Executive = cross-dimension leadership KPIs/forecast. Guard in
  review.
- Knowledge index reflects flag-off nav until prod flip (existing accepted
  dark-launch caveat).
- P5 debts (registry gating, vendor merge, auditor access) remain open and
  tracked; none block GATE B.
