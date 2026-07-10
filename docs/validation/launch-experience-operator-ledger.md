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

## L-4 — Reconcile & sync the `securelogic-app-staging` service (IaC) — PREREQUISITE of L-2

| Field | Value |
|---|---|
| **Service** | `securelogic-app-staging` (Render web service) — now defined in `render.yaml` (this goal, PR adding the staging app). |
| **Why** | The customer-facing workspace/Decision UI is served by the **app** service and gated by **app-side** flags (`layout.tsx`, `findings/*`, `actions/*`, `queue/*`). There was **no `securelogic-app-staging` in IaC** before this change; a dashboard-managed one predated it. Without an app service carrying the flags `= true`, the engine flags alone change **no** UI (this was the "staging looks unchanged" root cause). |
| **Action** | 1. **Reconcile the pre-existing dashboard service:** because Render Blueprints match **by name**, syncing the Blueprint **adopts** the existing `securelogic-app-staging` (it does **not** create a duplicate). Confirm exactly one service by that name; do not manually create a second. 2. **Sync the Blueprint** so the IaC definition (branch `develop`, region `virginia`, `/login` health check, build/start = prod app) takes effect. 3. **Set the `sync: false` staging values on the service** (never prod values): `ENGINE_API_URL` → the `securelogic-engine-staging` **private** URL; `NEXT_PUBLIC_ENGINE_URL` → its **public** URL; `NEXT_PUBLIC_SITE_URL` → the **staging** website URL; a **distinct** `SESSION_SECRET` (≥32 chars, not prod); session-timeout + staging Sentry values as desired. 4. Because `NEXT_PUBLIC_*` are build-time, a value change requires a **redeploy/rebuild** (the app builds on deploy of `develop`). |
| **Step** | Adopt/sync → set staging env values → confirm the service builds from `develop` and is healthy at `/login` → then L-2. |
| **Do NOT** | Point any URL at production; copy prod secrets; declare a custom domain (none is in IaC — it keeps its Render-assigned URL). |

## L-2 — Enable the workspace flags on STAGING (app + engine)

| Field | Value |
|---|---|
| **Service** | `securelogic-app-staging`, `securelogic-engine-staging` (Render env) |
| **Action** | App (`securelogic-app-staging`): `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` **and** `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. Engine (`securelogic-engine-staging`): `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. Optionally engine `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` to enrich the Brief→Event drill-through (degrades honestly when off). Both flags are RUNTIME (a restart applies them; no rebuild). |
| **Step** | Set on staging → validate (see L-3) → hold for a separate GATE-B ruling before prod. |
| **Depends on** | **L-4** (the staging app service exists, is synced from IaC, and has its staging URLs/secret set) and **L-1** (saved-views table present). Lights up: Findings decision queue + Day-0 empty state (RISK_WORKSPACE); Decision Workspace incl. every-source affected context, Brief→Decision + Brief→Event, My Actions depth, saved views (DECISION_WORKSPACE); Review Suggested Links + bulk select mode (RISK_WORKSPACE). NOTE: `/findings/:id` Decision Workspace needs the **engine** `DECISION_WORKSPACE` flag on too (two-switch) or it falls back to legacy detail. |

## L-3 — Staging validation before any prod enablement

| Field | Value |
|---|---|
| **Service** | Staging (manual QA) |
| **Action** | Validate on real staging data: (a) an assessment-sourced finding (vendor/control/AI/obligation/risk) shows its affected entity in the Decision Workspace; (b) My Actions shows SLA groups + source links; (c) a brief item links to both the Decision Workspace and its supporting intelligence; (d) saving/applying/deleting a Findings saved view; (e) bulk select → Accept/Dismiss selected on Review Suggested Links, including a partial-failure case. |
| **Step** | All green on staging → operator raises GATE-B decision for prod. **No prod flag flip in this goal.** |

---

**GATE B (prod enablement) remains a reserved product/operator decision — untouched by this goal.**
No production flag, env, or DB change was made. Everything above is staging-first and reversible.
