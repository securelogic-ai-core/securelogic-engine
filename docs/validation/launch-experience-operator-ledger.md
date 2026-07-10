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

## L-2 — Activate the workspace flags on STAGING (IaC-managed — sync the Blueprint)

> **Updated 2026-07-10:** these staging flags are no longer set by hand in the Render
> dashboard. They are **declared in `render.yaml`** and **owned by the Render
> Blueprint** (app-staging RISK+DECISION via the staging-app PR; engine-staging
> DECISION via PR #585). The operator action is to **sync the Blueprint and let the
> services redeploy**, not to edit env vars manually — a manual edit is unnecessary
> and would be reverted on the next sync.

| Field | Value |
|---|---|
| **Service** | `securelogic-app-staging`, `securelogic-engine-staging` |
| **Flags (IaC-managed in `render.yaml`, NOT dashboard-set)** | `securelogic-app-staging`: `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` **and** `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. `securelogic-engine-staging`: `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`. All three are declared `value: "true"` in the respective `render.yaml` staging blocks and owned by the Blueprint. |
| **Operator action** | 1. **Sync the Render Blueprint** so the declared values take effect. 2. Confirm **both** `securelogic-app-staging` **and** `securelogic-engine-staging` **redeploy from `branch: develop`**. 3. After redeploy, **verify each live service reads its flag = `true`** — in particular that `securelogic-engine-staging` reads `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true` (Render → Environment on each service, or the running process). **No manual dashboard flag edits.** Optional: engine `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` (still `sync:false`/dashboard) to enrich the Brief→Event drill-through (degrades honestly when off). |
| **Two-switch (`/findings/:id`)** | Requires `DECISION_WORKSPACE=true` on **both** `securelogic-app-staging` **and** `securelogic-engine-staging` (both now IaC-managed). If only the app flag is live, the detail falls back to legacy — verify the engine value after redeploy. |
| **Step** | Sync Blueprint → confirm both staging services redeploy from `develop` → verify live values `= true` → validate (L-3). |
| **Production / GATE B** | Production `securelogic-app` and `securelogic-engine` keep `RISK_WORKSPACE`/`DECISION_WORKSPACE` = `"false"` in `render.yaml`. **GATE B remains intact** — no production flag flip; prod enablement is a separate reserved ruling. |
| **Depends on** | **L-4** (the staging app service adopted/synced from IaC + its `sync:false` staging URLs/secret set) and **L-1** (saved-views table present). Activates: Findings decision queue + Day-0 empty state (RISK_WORKSPACE); Decision Workspace incl. every-source affected context, Brief→Decision + Brief→Event, My Actions depth, saved views (DECISION_WORKSPACE); Review Suggested Links + bulk select mode (RISK_WORKSPACE). |

## L-3 — Staging validation before any prod enablement

| Field | Value |
|---|---|
| **Service** | Staging (manual QA) |
| **Action** | Validate on real staging data: (a) an assessment-sourced finding (vendor/control/AI/obligation/risk) shows its affected entity in the Decision Workspace; (b) My Actions shows SLA groups + source links; (c) a brief item links to both the Decision Workspace and its supporting intelligence; (d) saving/applying/deleting a Findings saved view; (e) bulk select → Accept/Dismiss selected on Review Suggested Links, including a partial-failure case. |
| **Step** | All green on staging → operator raises GATE-B decision for prod. **No prod flag flip in this goal.** |

---

**GATE B (prod enablement) remains a reserved product/operator decision — untouched by this goal.**
No production flag, env, or DB change was made. Everything above is staging-first and reversible.
