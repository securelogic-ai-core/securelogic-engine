# EG2 / Wave 1 — Production Promotion Runbook

**Release head:** `develop` @ `b293e0cc`
**Production head at time of writing:** `main` @ `83f41957`
**Status:** promotion NOT authorized. This runbook records the order and the
evidence to collect; it does not itself authorize anything.

---

## 1. Promotion order (required)

Promote in exactly this sequence. Do not parallelize steps 1 and 3.

| # | Action | Service | Gate before continuing |
|---|---|---|---|
| 1 | Deploy the engine | `securelogic-engine` | Deploy reaches **live** |
| 2 | Confirm migrations and engine health | `securelogic-engine` | 5 migrations applied; `/health` returns 200 |
| 3 | Deploy the app | `securelogic-app` | Deploy reaches **live** |
| 4 | Confirm app health | `securelogic-app` | `/api/health` returns 200 `{"status":"ok"}` |

### Why the engine MUST precede the app

Two independent reasons, either of which is sufficient:

1. **The two-switch flags are engine-backed.** `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED`
   and `SECURELOGIC_DECISION_WORKSPACE_ENABLED` each exist on *both* services. The app
   half renders a surface that calls an engine endpoint the engine half opens —
   the Briefing calls `/api/briefing/layout`, the Decision Workspace calls
   `GET /api/findings/:id/context`. Promote the app first and those surfaces render
   against an engine that still returns 403, producing a broken experience for
   exactly the users the release is meant to impress.

2. **The engine owns migrations.** `startCommand` is `npm run migrate && npm start`
   (`render.yaml:8`). The app never migrates. Schema the new code depends on must
   exist before any client of it is promoted.

---

## 2. Migrations applied by this promotion

**Five**, all additive and idempotent. Production is at 197 migration files;
`develop` is at 202.

| File | Change | Shape |
|---|---|---|
| `20260908_asset_search_index_view.sql` | `asset_search_index_v` read-only projection + `GRANT SELECT` | `CREATE OR REPLACE VIEW` |
| `20260911_acceptance_expiring_notified.sql` | `finding_risk_acceptances.expiring_notified_at` + partial index | `ADD COLUMN IF NOT EXISTS` |
| `20260912_sso_login_codes.sql` | `sso_login_codes` table + RLS policy + index | `CREATE TABLE IF NOT EXISTS` |
| `20260913_assignment_alert_preference.sql` | `user_alert_preferences.assignment_immediate` | `ADD COLUMN IF NOT EXISTS` |
| `20260914_sla_breach_alert_preference.sql` | `user_alert_preferences.sla_breach_daily` | `ADD COLUMN IF NOT EXISTS` |

No column is dropped, renamed, retyped, or backfilled. No data is moved.

### Failure behaviour is safe by construction

`scripts/runMigrations.ts` wraps **each** migration in its own transaction and
records it in `schema_migrations` only on commit. On failure it rolls that
migration back and exits non-zero, so `npm run migrate && npm start` never reaches
`npm start`: the new engine instance does not boot, its health check never passes,
and **Render keeps the previous instance serving**. A failed migration is therefore
a failed deploy, not a half-migrated production database.

### Verifying step 2

```sql
-- Expect 5 rows.
SELECT filename, applied_at
  FROM schema_migrations
 WHERE filename IN (
   '20260908_asset_search_index_view.sql',
   '20260911_acceptance_expiring_notified.sql',
   '20260912_sso_login_codes.sql',
   '20260913_assignment_alert_preference.sql',
   '20260914_sla_breach_alert_preference.sql'
 )
 ORDER BY filename;
```

Then `GET https://<engine-host>/health` → 200.

---

## 3. Feature flags promoted with this release

Six values change in `render.yaml`. Nothing else moves.

| Service | Flag | Before | After |
|---|---|---|---|
| `securelogic-engine` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` | `true` |
| `securelogic-engine` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` | `true` |
| `securelogic-engine` | `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | *(undeclared → false)* | `true` |
| `securelogic-app` | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `false` | `true` |
| `securelogic-app` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` | `true` |
| `securelogic-app` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` | `true` |

All six are additive: they open endpoints and surfaces that currently return 403 or
render the legacy composition. No endpoint that returns 200 today changes shape.

`SECURELOGIC_VENDOR_ASSURANCE_ENABLED` was previously **undeclared** on the
production engine, so it resolved absent → false while the workspace navigation
surfaced "Vendor Assurance" unconditionally — the menu item existed and the API
403'd. Declaring it `true` brings production to parity with staging.

---

## 4. Rollback order (reverse of promotion)

| # | Action | Service |
|---|---|---|
| 1 | Revert the app first | `securelogic-app` |
| 2 | Confirm app health | `/api/health` → 200 |
| 3 | Revert the engine | `securelogic-engine` |
| 4 | Confirm engine health | `/health` → 200 |

### Why rollback reverses the order

The same dependency, read backwards. The app is the *consumer*; the engine is the
*provider*. Removing a provider while its consumer is still live reproduces exactly
the broken state promotion order exists to avoid — app surfaces calling engine
endpoints that have gone back to 403. Retire the consumer first, then the provider.

### Two independent rollback levers

Prefer the flag revert. It is faster, finer-grained, and needs no redeploy.

1. **Flag revert (first resort).** Set the six flags back to `false` on the two
   services. Both apps read them at runtime, so a restart applies them — no rebuild.
   This returns the legacy navigation and legacy finding detail byte-for-byte while
   leaving the new code deployed.
2. **Image / deploy rollback (second resort).** Roll each service back to its
   previous known-good deploy in Render, app first.

### There is no data-repair tail

Reverting the code leaves the five migrations applied. That is safe and intentional:

- The three `ADD COLUMN` / `CREATE TABLE` migrations leave **inert** structures.
  Older code does not reference `assignment_immediate`, `sla_breach_daily`,
  `expiring_notified_at`, or `sso_login_codes`, and every one is either nullable or
  defaulted, so no insert path breaks.
- `asset_search_index_v` is a read-only view over existing tables. Unreferenced by
  older code, it costs nothing.

The repository convention is forward-only: **do not hand-write down-migrations
during an incident.** Each migration file documents its manual reversal if one is
ever genuinely required.

---

## 5. Health endpoints

| Service | Path | What it proves |
|---|---|---|
| `securelogic-engine` | `/health` | Engine process up; migrations completed (the process cannot start otherwise) |
| `securelogic-app` | `/api/health` | App process up **and correctly configured** — `SESSION_SECRET` usable, `ENGINE_API_URL` set and not the localhost default |

The app probe deliberately does **not** call the engine or the database. A probe
that depended on the engine would let an engine blip fail the app's health check and
turn a one-service incident into a two-service outage. Dependency health belongs to
the engine's own `/health`.

A misconfigured app returns **503** with the *names* of the failing checks and never
their values:

```json
{"status":"unready","failed":["SESSION_SECRET"]}
```

---

## 6. Health-check activation — two risks specific to this release

This release is the first to put a `healthCheckPath` on `securelogic-app`. Render
begins *enforcing* it the moment the Blueprint is synced, which introduces two
ordering hazards that do not exist for any other change in the release.

### 6.1 Blueprint sync must not precede the code

`/api/health` ships in this release. Measured 2026-08-03, the staging app still
returns **404** for it while `/login` returns 200 — the route does not exist in the
currently deployed build.

**Consequence:** syncing the Blueprint (which applies `healthCheckPath: /api/health`)
*before* the service redeploys with this commit points the health check at a 404 on
the running instance, and Render marks a healthy service unhealthy.

**Rule:** apply the Blueprint change and the new build together, or apply the code
first. Never sync `healthCheckPath` ahead of the deploy that serves it.

### 6.2 The probe will refuse a misconfigured app — verify config first

Until now `securelogic-app` had no health check, so a deploy succeeded regardless of
whether `SESSION_SECRET` and `ENGINE_API_URL` were set. From this release a
production app missing either will return 503 and **fail the deploy**.

That is the intended behaviour — those are the app's hard requirements and a missing
`SESSION_SECRET` means session enforcement is silently disabled (`middleware.ts`
fails open by design). But it converts a previously silent misconfiguration into a
blocked promotion, so confirm before promoting rather than discovering it mid-deploy:

- `SESSION_SECRET` is set on `securelogic-app` and is **≥ 32 characters**
- `ENGINE_API_URL` is set on `securelogic-app` and points at the production engine
  (not `localhost`)

Both are `sync: false`, so they live only in the Render dashboard and cannot be
verified from the repository.

---

## 7. Evidence to capture during promotion

- [ ] Engine deploy id + timestamp, reached live
- [ ] The 5-row `schema_migrations` query result
- [ ] Engine `/health` 200
- [ ] App deploy id + timestamp, reached live
- [ ] App `/api/health` 200 `{"status":"ok"}`
- [ ] Spot-check one Wave 1 surface per flag pair (Briefing, Decision Workspace, Vendor Assurance)
- [ ] Sentry receiving events from both services under the expected environment label
