# Launch Experience — Operator Ledger

Operator-only actions (Render / env / prod DB / flags) required to make the completed,
dark launch-experience work VISIBLE. **Recorded, NOT executed** — per goal governance the
build agent never performs operator actions. Staging-first, then a GATE-B ruling for prod.

Scope: the "Complete the SecureLogic Launch Experience" goal (2026-07-09/10). All code is
merged to `develop` and dark; nothing below changes customer-visible behavior until the
operator acts.

---

## L-1 — Run the saved-views migration (DB)

| Field | Value |
|---|---|
| **Service** | Postgres (staging, then prod) |
| **Action** | Apply migration `db/migrations/20260710_finding_saved_views.sql` (creates `finding_saved_views` + inert RLS + `app_request` grants). Additive; no backfill; reversible via `DROP TABLE finding_saved_views`. |
| **Step** | Runs automatically via `scripts/runMigrations.ts` on deploy of `develop` to staging; confirm it applied (row in `schema_migrations`). |
| **Depends on** | §1 saved views (PR #580 engine). Must be applied before enabling `DECISION_WORKSPACE` on the engine, or `GET/POST/DELETE /api/finding-saved-views` will 500 on a missing table (they 404 while the flag is off regardless, so order is not strictly gating, but apply first). |

## L-2 — Enable the workspace flags on STAGING (app + engine)

| Field | Value |
|---|---|
| **Service** | `securelogic-app-staging`, `securelogic-engine-staging` (Render env) |
| **Action** | App: `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` **and** `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. Engine: `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. Optionally engine `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` to enrich the Brief→Event drill-through (degrades honestly when off). |
| **Step** | Set on staging → validate (see L-3) → hold for a separate GATE-B ruling before prod. |
| **Depends on** | L-1 (saved-views table present). Lights up: Findings decision queue + Day-0 empty state (RISK_WORKSPACE); Decision Workspace incl. every-source affected context, Brief→Decision + Brief→Event, My Actions depth, saved views (DECISION_WORKSPACE); Review Suggested Links + bulk select mode (RISK_WORKSPACE). |

## L-3 — Staging validation before any prod enablement

| Field | Value |
|---|---|
| **Service** | Staging (manual QA) |
| **Action** | Validate on real staging data: (a) an assessment-sourced finding (vendor/control/AI/obligation/risk) shows its affected entity in the Decision Workspace; (b) My Actions shows SLA groups + source links; (c) a brief item links to both the Decision Workspace and its supporting intelligence; (d) saving/applying/deleting a Findings saved view; (e) bulk select → Accept/Dismiss selected on Review Suggested Links, including a partial-failure case. |
| **Step** | All green on staging → operator raises GATE-B decision for prod. **No prod flag flip in this goal.** |

---

**GATE B (prod enablement) remains a reserved product/operator decision — untouched by this goal.**
No production flag, env, or DB change was made. Everything above is staging-first and reversible.
