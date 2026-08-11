# EG2 / Wave 1 — Production Promotion Runbook

**Release head:** `develop` @ `e54928fb` (PR #740 merged 2026-08-04; documentation-only
above `cc61ced4`)
**Production head at time of writing:** `main` @ `83f41957` (verified unchanged 2026-08-04)
**Status:** promotion NOT authorized. This runbook records the order and the
evidence to collect; it does not itself authorize anything.

---

## 1. Promotion order (required)

Promote in exactly this sequence. Do not parallelize steps 1 and 3.

| # | Action | Service | Gate before continuing |
|---|---|---|---|
| 1 | Deploy the engine | `securelogic-engine` | Deploy reaches **live** at the intended commit SHA |
| 2 | Confirm migrations and engine health | `securelogic-engine` | 5 migrations applied; `/health` returns 200 |
| 3 | Deploy the app | `securelogic-app` | Deploy reaches **live** at the intended commit SHA |
| 4 | Confirm app health | `securelogic-app` | `/api/health` returns 200 `{"status":"ok"}` |

Gates 1 and 3 require the **deployed commit SHA**, not merely a live deploy on the
right branch. The two are not the same check, and the staging rehearsal proved it
(§7.2, "How a deploy is actually triggered").

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

**Five values change and two keys are added.** Measured 2026-08-04 by diffing
`render.yaml` @ `develop` against the **live** production dashboards via the
Render API — not by reading `render.yaml` alone. The distinction matters: the
Blueprint has been **paused since 2026-07-26** (§6.1), so the repository and the
live dashboard have drifted, and only the live value predicts what a sync does.

| Service | Flag | Live value today | After sync | Effect |
|---|---|---|---|---|
| `securelogic-engine` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` | `true` | **changes** |
| `securelogic-engine` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` | `true` | **changes** |
| `securelogic-engine` | `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | **`true`** | `true` | **no-op — already live** |
| `securelogic-engine` | `SECURELOGIC_MATCHER_ALERTS_ENABLED` | *(absent)* | `false` | added, inert |
| `securelogic-engine` | `SECURELOGIC_SLA_ALERTS_ENABLED` | *(absent)* | `false` | added, inert |
| `securelogic-app` | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `false` | `true` | **changes** |
| `securelogic-app` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` | `true` | **changes** |
| `securelogic-app` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` | `true` | **changes** |

The five real changes are additive: they open endpoints and surfaces that currently
return 403 or render the legacy composition. No endpoint that returns 200 today
changes shape.

### 3.1 Vendor Assurance is ALREADY ENABLED in production

`SECURELOGIC_VENDOR_ASSURANCE_ENABLED` is **`true` on the live production engine
right now.** It is declared nowhere in `render.yaml` @ `main` for the production
engine (only for `securelogic-engine-staging`, L427), so it was set directly in
the Render dashboard during the paused-Blueprint window.

**Consequences, both of which this runbook previously got wrong:**

- This promotion does **not** enable Vendor Assurance. Syncing `develop`'s
  `render.yaml` (which declares it `true` for the production engine, L220) simply
  records the value that is already in effect. It is a no-op, not a change.
- Any rollback that sets this flag to `false` **disables a capability that is live
  in production today**. It is not part of this release and must not be reverted
  with it. See §4 and §7.1.

> **Unresolved, non-blocking for promotion:** who enabled it directly on the
> dashboard, and under what authorization, is not recorded here and has not been
> established. Confirm before promotion if that provenance matters to you; the
> promotion itself is unaffected either way.

### 3.2 The two added alert flags are inert

`SECURELOGIC_MATCHER_ALERTS_ENABLED` and `SECURELOGIC_SLA_ALERTS_ENABLED` are
absent from the live production engine and arrive as `false`. Both gate on a
strict equality test — `env[...] === "true"`
(`src/api/lib/alerting/matcherAlertsFeatureFlag.ts:18`,
`src/api/lib/slaBreachScheduler.ts:49`) — so *absent*, *empty* and *`false`* are
behaviourally identical. Declaring them changes no behaviour; it only makes the
dark state explicit. The SLA sweep stays a zero-DB no-op with its cron inert
(`src/api/lib/schedulerRunner.ts:170`).

---

## 4. Rollback order (reverse of promotion)

| # | Action | Service | Gate before continuing |
|---|---|---|---|
| 1 | Rebuild and redeploy the known-good commit | `securelogic-app` | Deploy reaches **live** |
| 2 | Confirm app health **and compatibility with the still-current engine** | `securelogic-app` | Health 200; critical authenticated routes pass |
| 3 | Rebuild and redeploy the known-good commit | `securelogic-engine` | Deploy reaches **live** |
| 4 | Confirm engine health, schema compatibility, critical workflows | `securelogic-engine` | `/health` 200; migrate is a no-op |
| 5 | Restore the approved known-good flag state | both | §7.1 table applied; VENDOR_ASSURANCE untouched |

### Why rollback reverses the order

The same dependency, read backwards. The app is the *consumer*; the engine is the
*provider*. Verified in code:

| Direction | Evidence |
|---|---|
| App consumes engine | `app/src/lib/api.ts:2017` → `/api/briefing/layout`; `app/src/lib/api.ts:2375` → `/api/findings/${id}/context` |
| Engine provides | `src/api/routes/findings.ts:1194` |
| Engine owns migrations | `render.yaml:8` (`npm run migrate && npm start`); the app is `next start` only (`render.yaml:1115`), stated outright at `render.yaml:878` |

Because the release is purely additive on the engine — no endpoint returning 200
today changes shape (§3) — the new engine is a **superset** of the old one's API.
That makes the two mixed-version states asymmetric:

- **old app + new engine → safe.** The old app calls only endpoints that already
  existed; all are still served.
- **new app + old engine → broken.** The new app renders the Briefing and Decision
  Workspace surfaces, which call the two endpoints above; the old engine 403s them.

App-first sits in the safe state. It has no broken window.

### Engine-first rollback: considered and rejected

Engine-first was proposed on the reasoning that schema compatibility should be
confirmed before the app moves. It is **rejected**, for two reasons:

1. **It manufactures the broken mixed-version state.** Reverting the engine first
   removes endpoints and contracts still required by the newer app, and holds that
   state for the *entire duration of the app rebuild* (§4.1 — rebuilds are minutes,
   not seconds). This is precisely the state promotion order exists to avoid.
2. **It buys nothing on the migration axis.** Rollback applies no down-migrations;
   the database stays at 202 either way (see "There is no data-repair tail" below).
   Schema compatibility is proven whenever the old engine boots — at step 3 under
   app-first exactly as well as at step 1 under engine-first.

Do not re-derive engine-first from the promotion order. Promotion is provider-first
because the consumer needs the provider ready; rollback is consumer-first for the
same reason read backwards.

### The assumption this ordering rests on — and which the rehearsal must prove

App-first is safe **only if the known-good app is backward-compatible with the
temporarily newer engine.** That is an inference from the release being additive,
not an observation. It has not been executed.

The staging rehearsal (§7) exists to verify it, not to restate it. Step 2 of the
rehearsal is the test: the known-good app running against the release-candidate
engine, with critical authenticated routes exercised. **If the known-good app is
incompatible with the newer engine during that interval, the rehearsal is a
failure** — see §7.2.

### 4.1 What "rollback" means here — rebuild and redeploy

**Render exposes no rollback operation.** Verified 2026-08-04: `render deploys`
offers only `cancel`, `create`, and `list` (CLI v2.21.0), and superseded deploys
carry status `deactivated` rather than a retained, restorable image.

Rollback on this platform therefore means **rebuild and redeploy the designated
known-good commit**. This runbook does not claim Render restores a previous deploy
object or image directly, and earlier revisions that said "roll back to the previous
deploy" were describing a capability that does not exist.

**Risk this adds:** rollback duration now includes a full build and deploy cycle for
each service, not a near-instant image swap. Two consequences to plan for:

- Time-to-recover is measured in build minutes per service, not seconds. Capture the
  actual elapsed time during the rehearsal (§7.3) so the real number replaces this
  estimate.
- The mixed-version window under app-first lasts as long as the *engine* rebuild.
  It is the safe state, but it is not brief, which is why the compatibility
  assumption above must be verified rather than assumed.

A build failure during rollback leaves the previous instance serving — the same
failure behaviour as promotion (§2) — so a failed rollback build is not an outage.
But it does mean the rollback has not happened, and the flag revert below remains
the only fast lever.

### Two independent rollback levers

Prefer the flag revert. It is faster, finer-grained, and needs no redeploy.

1. **Flag revert (first resort).** Set these **five** flags back to `false`. Both
   apps read them at runtime, so a restart applies them — no rebuild. This returns
   the legacy navigation and legacy finding detail byte-for-byte while leaving the
   new code deployed.

   | Service | Flag | Revert to |
   |---|---|---|
   | `securelogic-engine` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` |
   | `securelogic-engine` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` |
   | `securelogic-app` | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `false` |
   | `securelogic-app` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` |
   | `securelogic-app` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` |

   > **DO NOT revert `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`.** It is `true` in
   > production *before* this release (§3.1). Setting it `false` during a rollback
   > would take down a live capability that this release did not introduce — a new
   > outage caused by the rollback itself. Leave it `true`.

   `SECURELOGIC_MATCHER_ALERTS_ENABLED` and `SECURELOGIC_SLA_ALERTS_ENABLED` need
   no action either: they arrive `false`, which is behaviourally identical to the
   absent state they replace (§3.2). Leave them as they are.

2. **Rebuild and redeploy the known-good commit (second resort).** App first, then
   engine (§4). This is a fresh build of `4ff7811b`, not an image restore — Render
   has no rollback operation (§4.1). Budget build time accordingly.

### There is no data-repair tail

Reverting the code leaves the five migrations applied. That is safe and intentional:

- The **four** `ADD COLUMN` / `CREATE TABLE` migrations leave **inert** structures.
  Older code does not reference `assignment_immediate`, `sla_breach_daily`,
  `expiring_notified_at`, or `sso_login_codes`, and every one is either nullable or
  defaulted, so no insert path breaks. (An earlier revision said "three" while
  listing four; the migration table in §2 is the authority — 1 view + 3 `ADD COLUMN`
  + 1 `CREATE TABLE` = 5.)
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

**Verified Blueprint state (Render API, 2026-08-04):** `securelogic-blueprint`
(`exs-d7abh4tm5p6s73a65q2g`) — `autoSync: false`, `status: paused`, tracks `main`,
`lastSync` `2026-07-26T23:40Z`. Nothing syncs on its own; every value in §3 reaches
production only through a deliberate operator sync. This is also why the live
dashboard has drifted from `render.yaml` (§3.1).

`/api/health` ships in this release. Measured 2026-08-04 **before** the Phase 0
staging repoint, the staging app returned **404** for it while `/login` returned 200
— the route did not exist in the then-deployed build (both staging services were
pinned to `feat/brief-generation-org-entitlement` @ `d927301d`). **After** the Phase 0
repoint to `develop` @ `cc61ced4`, the staging app serves `/api/health` → 200
`{"status":"ok"}`. Production remains at `main` @ `83f41957` and still 404s.

Render is nonetheless **still probing `/login`** on the staging app, and will
continue to until a Blueprint synchronization updates the service configuration —
`healthCheckPath` lives in `render.yaml`, and the Blueprint is paused. Serving the
route and *enforcing* it are two separate events.

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

## 7. Staging rollback rehearsal (operator-executed)

Run this on **staging only**.

> **Correction to an earlier revision.** This section previously stated that the
> rehearsal could not be prepared or verified because "no Render credential exists
> in the authoring environment (`api.render.com` returns 401)." That was wrong in
> method: it probed only the `RENDER_API_KEY` / `RENDER_TOKEN` / `RENDER_API_TOKEN`
> environment variables, which are indeed absent, and missed the authenticated
> `render` CLI whose token lives in `~/.render/cli.yaml`. Service state, branch
> pinning, deploy history, live environment values, and Blueprint status are all
> readable, and every "verified live" claim in this runbook rests on that access.
> The claim of no credential is retracted; the operator-executed designation stands,
> because *writing* to the control plane remains an operator decision.

### 7.1 Known-good targets (pinned)

| Ref | Commit | Migration files | Role |
|---|---|---|---|
| Release candidate | `develop` @ `e54928fb` | 202 | What is being rehearsed (includes PRs #738, #739, #740) |
| Staging known-good | **`4ff7811b`** | **197** | Re-pinned — schema-equivalent to production |
| Production current | `main` @ `83f41957` | 197 | Untouched by this rehearsal |

The known-good target stays pinned to the literal SHA `4ff7811b`: it is chosen for a
fixed property (schema equivalence with production at 197 migrations) that a moving
reference would destroy.

#### Why the release candidate moved from `cc61ced4` to `e54928fb`

`cc61ced4` → `e54928fb` is **documentation-only**: the application code, migrations,
and runtime behaviour under test are unchanged, the Phase 0 evidence recorded below
remains valid for the code under test, and **no additional redeploy is required
before Phase 1 solely because documentation-only commits landed.**

Verified rather than asserted. `git diff --name-status cc61ced4 e54928fb` reports a
single changed file — this runbook (PR #740). The `src/` and `db/` trees and
`render.yaml`, `package.json` and `package-lock.json` are byte-identical across the
two commits, and both carry **202** migration files; the two commits are the same
code.

> **Corrected after the rehearsal.** An earlier revision of this paragraph stated
> that staging "is running `cc61ced4` from Phase 0 and stays there for the
> rehearsal". That did not hold: when PR #740 landed on `develop`, Render Auto
> Deploy — then still `autoDeploy: yes` — rebuilt **both** services to `e54928fb`
> before the rehearsal continued. The code was identical either way, so no evidence
> was affected, but the statement described an intent rather than the observed state.
> **The validated post-rehearsal staging baseline is `develop` @ `a976f3dc`**, both
> services live and healthy, five flags `true`. Both services now carry
> `autoDeploy: no`.

**Rule — documentation-only commits do not invalidate runtime evidence.** Once the
rehearsal is pinned, commits that land on `develop` afterwards and touch **only**
documentation do not invalidate evidence already collected and do not require a
rebuild or redeploy to keep the rehearsal valid. They change what this runbook says,
not what the services run. Two obligations survive that rule:

- **Classify before relying on it.** A commit touching application code, migrations,
  `render.yaml`, or dependencies **does** invalidate the pin and requires
  re-establishing Phase 0. Confirm which kind it is with
  `git diff --name-status <pinned-sha> <develop-head>`; do not infer it from the
  commit message or the branch name.
- **The exact promotion SHA must be re-confirmed at promotion time.** It is not
  inherited from this document. This pin records what the rehearsal ran against;
  what gets promoted is the `develop` head verified at the moment of promotion.

#### Why the known-good was re-pinned from `62f21e10` to `4ff7811b`

`62f21e10` carries **200** migration files. It already contains three of the five
migrations this release applies, so rolling back to it exercises only two
(`20260913_assignment_alert_preference`, `20260914_sla_breach_alert_preference`)
and silently leaves the other three untested. That is not the scenario production
would face.

Production is at **197**. The claim being rehearsed is that 197-era code runs
correctly against a 202-migration database with **no down-migration** — so the
rollback target must sit at 197.

`4ff7811b` does. Verified by `git ls-tree`: its `db/migrations` tree hash is
**byte-identical to `main` @ `83f41957`**, it is an ancestor of `develop`, and it
is the **latest** such commit (2026-07-23), making it the smallest possible code
regression that still reproduces production's schema position. Rolling staging code
to it while the staging database holds all 202 migrations exercises **all five**
release migrations.

**Two limits, stated rather than assumed:**

- `4ff7811b` is *schema*-identical to production, not *code*-identical. `main` @
  `83f41957` is a later commit that is **not** an ancestor of `develop`, so no
  single commit is both. Schema equivalence is the property this rehearsal tests;
  code equivalence is not claimed.
- **Image retention is not a question any more, because it is not a mechanism any
  more.** An earlier revision of this section asked the operator to confirm whether
  Render still retained a "rollback-eligible image" for `4ff7811b`. That question is
  void: Render exposes no rollback operation at all (§4.1), so the target is reached
  by rebuilding the commit regardless of what images exist. The commit is reachable
  from `develop`, which is the only property that matters. What the operator must
  budget for instead is **build time**, and what they must confirm is that
  `4ff7811b` still *builds* — a commit that no longer compiles against current
  lockfiles would be discovered only at rollback time.

#### Flag values a revert must reproduce

**Five** flags, not six:

| Service | Flag | Known-good value |
|---|---|---|
| `securelogic-engine` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` |
| `securelogic-engine` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` |
| `securelogic-app` | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `false` |
| `securelogic-app` | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` |
| `securelogic-app` | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` |

> **`SECURELOGIC_VENDOR_ASSURANCE_ENABLED` is deliberately absent from this table.**
> An earlier revision listed its known-good as *(undeclared → false)*. That was
> wrong: the flag is `true` on the live production engine and is not part of this
> release (§3.1). Reverting it would cause an outage the rollback was supposed to
> prevent. On staging, set it to whatever staging holds today and leave it there —
> it is outside the rehearsal.

`SECURELOGIC_MATCHER_ALERTS_ENABLED` / `SECURELOGIC_SLA_ALERTS_ENABLED` are also
outside the revert set: `false` and absent are the same behaviour (§3.2), so there
is nothing to reproduce.

### 7.2 Procedure

#### Precondition — repointing staging to `develop` (operator-authorized)

Verified live via the Render API, 2026-08-04, **before** the Phase 0 repoint:

| Service | Service id | Branch | Live commit | `healthCheckPath` | `autoDeploy` |
|---|---|---|---|---|---|
| `securelogic-app-staging` | `srv-d7n0ss3bc2fs738hltf0` | `feat/brief-generation-org-entitlement` | `d927301d` (`dep-d9o6lbht0dsc739idjo0`) | **`/login`** | **yes** |
| `securelogic-engine-staging` | `srv-d7n0rju8bjmc738jbs7g` | `feat/brief-generation-org-entitlement` | `d927301d` (`dep-d9o6lbht0dsc739idk5g`) | `/health` | **yes** |

In that state both services were missing PRs #737 and #738, which is why the staging
app 404'd on `/api/health`; the rehearsal baseline could not pass. **This has since
been resolved** — see the executed record under Phase 0 below. The table is retained
as the pre-repoint snapshot and as the rollback reference for the deploy ids.

**Operator decision, recorded 2026-08-04:** repoint both services to `develop`,
accepting the loss of the `d927301d` feature-branch staging state on the grounds
that its validation evidence has already been captured
(`EG2-WAVE1-W3-W6-VALIDATION-RECORD.md`). **That decision stands as recorded and was
correctly conditioned** — the operator authorized giving up a validated environment
only because its evidence was already durable.

**Technical clarification from the Phase 0 execution.** What the repoint costs should
be read on two separate axes, which the original single phrase collapsed:

- **Git history — no commits are lost.** `d927301d` is an **ancestor of** `develop` @
  `cc61ced4`, having reached it via PRs #736/#737. The repoint is a fast-forward: no
  commit and no code becomes unreachable, and the feature-branch work is fully
  contained in the new baseline.
- **Operational staging state — it transitions.** The environment moves from the
  **release-validation state** it held on `feat/brief-generation-org-entitlement` @
  `d927301d` — the exact deployed build the W3–W6 record was executed against — to
  the **current `develop` integration state** at `cc61ced4`. The validated
  environment no longer stands to be re-observed; reproducing it means rebuilding
  that commit (§4.1), since Render exposes no rollback operation.

The distinction matters for how the W3–W6 evidence is read: it is the durable record
of an environment that no longer exists, not a description of what staging is serving
now. After the rehearsal both services remain on `develop` at the current release
candidate; they are **not** returned to `feat/brief-generation-org-entitlement`.

#### How a deploy is actually triggered — corrected against observed behaviour

> **Correction to an earlier revision.** This section previously stated that
> `autoDeploy: yes` means "**the repoint is itself the deploy** — changing the branch
> triggers a build immediately. There is no separate 'repoint, then deploy' step."
> **That is wrong, and the Phase 0 repoint on 2026-08-04 disproved it.**

Verified during the Phase 0 repoint:

- **Changing the tracked branch does NOT trigger a deployment.** After
  `PATCH /v1/services/srv-d7n0rju8bjmc738jbs7g {"branch":"develop"}` returned
  `branch=develop` at 17:22:36Z, the service's deploy list was polled for
  approximately 60 seconds and **no new deploy was created**. The latest deploy
  remained `dep-d9o6lbht0dsc739idk5g` at `d927301d` — the old feature-branch commit.
- **Render Auto Deploy responds to new commits on the tracked branch, not to
  branch-field changes.** `autoDeploy: yes` with `autoDeployTrigger: commit` is a
  webhook on incoming commits. Repointing to a branch whose head already exists
  produces no commit event, so nothing fires.
- **Deployment verification must therefore include the deployed commit SHA, not only
  the tracked branch.** Between 17:22:36Z and the explicit deploy, the service
  reported `branch=develop` while still *running* `d927301d`. Any check that read
  only the branch field would have reported success.

**Why this matters more than a procedural nit:** the previous procedure would have
had the operator repoint both services, observe `branch=develop`, and proceed —
**rehearsing the rollback against `d927301d`, the wrong deployed commit**, while
every dashboard indicated `develop`. The rehearsal is the sole evidence behind §4's
ordering; run against the wrong commit it would have evidenced nothing, and the
failure would have been invisible rather than loud.

**Required sequence, per service:**

| # | Step | Check |
|---|---|---|
| 1 | Repoint the service to the desired branch | `PATCH /v1/services/{id} {"branch":"<branch>"}` |
| 2 | Verify the branch change succeeded | `GET /v1/services/{id}` → `branch` is the desired branch |
| 3 | **Explicitly deploy the intended commit**, SHA-pinned | `POST /v1/services/{id}/deploys {"commitId":"<sha>"}` |
| 4 | Wait for deployment completion | deploy status reaches **live** |
| 5 | **Verify the deployed commit matches the intended SHA** | deploy record `commit.id` == intended SHA |
| 6 | Verify service health | engine `/health` 200; app `/api/health` 200 |
| 7 | Continue with the next service | only after 1–6 pass |

SHA-pinning at step 3 is not ceremony: it makes the deploy target explicit and
immune to a branch head that moves between the repoint and the deploy.

**An environment-variable change does not take effect on its own under
`autoDeploy: no`.** Verified during the rehearsal: writing new values via
`PUT /v1/services/{id}/env-vars/{key}` returned the updated values and created
**no deploy and no restart**. The running processes kept serving the previous
values — confirmed by request, not assumed — until an explicit
`POST /v1/services/{id}/restart` was issued. Only then did the new values apply.

The hazard is that this failure is **silent and looks like success**: the API and
dashboard both report the new value, so an operator who changes a variable and
watches for a deploy sees nothing happen and may reasonably conclude it applied. Any
verification that reads the configured value rather than the served behaviour would
report success while the change was still inert. Verify by observing the behaviour
the variable controls.

This is the same shape as the branch-repoint correction above — a configuration
write that Render accepts without acting on — and it applies to any environment
variable, feature flags included.

**Scope of this evidence, stated rather than assumed.** The no-auto-deploy behaviour
was observed directly on `securelogic-engine-staging` over a ~60-second window. The
app repoint followed the corrected sequence with its deploy issued immediately after
the `PATCH`, so it provides **no independent observation window** and corroborates
nothing on its own. The claim rests on the engine observation. This correction is
based on observed platform behaviour, not on inference from Render's documentation.

Note also that `healthCheckPath` on `securelogic-app-staging` is live as `/login`,
not `/api/health`; the Blueprint is paused (§6.1) so `render.yaml`'s value has not
reached it. **This remains true after the Phase 0 repoint:** the app now serves
`/api/health` → 200 `{"status":"ok"}`, but **Render is still probing `/login`**, and
will continue to until a Blueprint synchronization updates the service
configuration. The probe is not yet load-bearing on staging. This is convenient for
the rehearsal — the app can move between commits that do and do not serve
`/api/health` without the probe failing — but it means the staging run does **not**
exercise the health-check activation hazard of §6.

**Before starting:** confirm Auto Sync is OFF at the Blueprint (verified OFF and
paused — §6.1), and record the pre-rehearsal deploy ids above.

#### Phase 0 — establish the release candidate on staging

0. **Repoint and build.** For each service in turn — **engine first, then app** —
   run the seven-step sequence in "How a deploy is actually triggered" above:
   repoint, verify the branch changed, **explicitly deploy the intended SHA**, wait
   for **live**, **verify the deployed commit equals the intended SHA**, verify
   health, then move to the next service. Do not assume the repoint deploys anything;
   it does not. Record deploy ids and elapsed build time — this is the first real
   measurement of how long a rebuild takes on these services, and §4.1 depends on it.

   > **Executed 2026-08-04.** Engine `dep-d9p1vvlbedkc73duqca0` and app
   > `dep-d9p214j7uimc73ae8980`, both **live** at `cc61ced4`; build+deploy **88s**
   > (engine) and **182s** (app); engine `Migrations complete` applying nothing;
   > mixed-version interval **4m02s**. `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`
   > confirmed `true` on the staging engine, unchanged. Verdict: **PHASE 0 PASS**.
1. **Baseline.** `GET /health` on the staging engine → 200
   `{"status":"ok","db":"connected"}`. `GET /api/health` on the staging app → 200
   `{"status":"ok"}`. Record the five flag values as they stand. Record
   `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` as it stands on staging.

#### Phase 1 — the cheap lever (flag revert)

2. **Flag revert.** Set the **five** flags to their known-good values (§7.1) and
   restart. **App first, then engine** (§4). Expect the legacy navigation and legacy
   finding detail, byte-for-byte. Confirm both health endpoints still return 200 — a
   flag revert must not affect readiness. **Do not touch
   `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`.**
3. **Restore the flags to `true`** and confirm the Wave 1 surfaces return. This
   isolates the cheap lever from the heavy one so a failure in Phase 2 is not
   confounded with flag state.

#### Phase 2 — the heavy lever (rebuild and redeploy, app-first)

This is the sequence a real rollback would follow (§4). It is a **rebuild of
`4ff7811b`**, not an image restore (§4.1).

4. **Rebuild and redeploy the app to the designated known-good commit `4ff7811b`.**
   The engine stays at the release-candidate commit established in Phase 0.
   Record start time, deploy id, and completion time. Expect `/api/health` to 404
   while rolled back — `4ff7811b` predates the route — and do not read that as a
   failure; the live probe is `/login` (see precondition).
5. **Verify the compatibility assumption — this is the point of the rehearsal.**
   With the **known-good app running against the still-newer engine**, exercise the
   critical authenticated routes: login/session, dashboard, findings list, finding
   detail, vendor surfaces. Record results and any error in either service's logs.

   > **If the known-good app is incompatible with the newer engine during this
   > interval — broken routes, 5xx, session failure, or contract errors in the logs —
   > STOP and issue `REHEARSAL FAIL`.** The app-first ordering in §4 rests on this
   > assumption; if it does not hold, the rollback plan itself is invalid and must be
   > redesigned before promotion is reconsidered. Do not continue to step 6 to "see
   > if it recovers."

   Record the **mixed-version duration** — from app cutover at step 4 to engine
   cutover at step 6. Under a real rollback this is the exposure window.
6. **Rebuild and redeploy the engine to `4ff7811b`.** Record start time, deploy id,
   completion time. Confirm `/health` → 200.
7. **Confirm the migration behaviour and the absence of a data-repair tail.** The
   engine's `startCommand` runs `npm run migrate` before `npm start`. At `4ff7811b`
   it carries 197 migration files, **all already recorded** in `schema_migrations`,
   so the migrate step must be an observable **no-op** — capture the log lines
   proving it applied nothing. Then verify the five release migrations are still
   present and nothing errors:
   ```sql
   SELECT filename FROM schema_migrations
    WHERE filename LIKE '202609%' ORDER BY filename;
   ```
   The older code must run correctly with those columns, table and view present.
   That is the whole claim being rehearsed: rollback needs no down-migration.
8. **Apply the known-good flag state** (§7.1, five flags → `false`) and confirm the
   fully-rolled-back system is coherent: health 200 on both, legacy surfaces,
   critical workflows pass. **Confirm `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` is
   unchanged from the value recorded at step 1.**

#### Phase 3 — restore

9. **Return both services to `develop` at the release-candidate commit established in
   Phase 0** — **engine first, then the app, then restore the five flags to `true`**
   — and re-confirm both health endpoints and the Wave 1
   surfaces. Record the final branch, commit, deploy ids, and flag state. Both
   services **stay** on `develop` — this is the new staging baseline, not a temporary
   state.

   > **Ordering corrected against the executed rehearsal.** An earlier revision said
   > "app first then engine". That is the rollback ordering (§4) applied to a move in
   > the promotion direction. Phase 3 moves *forward* to the release candidate, so
   > **§1 governs, not §4** — the same dependency read forwards.
   >
   > Following the earlier wording would have produced RC-app against known-good
   > engine and held it for the whole engine rebuild (~90–100s measured). The engine
   > route surface is **strictly additive** across this release — 343 routes at
   > `4ff7811b`, 358 at the release candidate, none removed — and the RC app calls
   > several of the added ones, including `/api/search`, `/api/evidence/recent`,
   > `/api/briefing/changes`, `/api/sso/exchange`, the five `*/export.csv` routes and
   > the `*/:id/history` routes. Those would 404. The history and export BFF routes
   > carry **no flag gate**, so the breakage is not suppressed by the flags being
   > `false` during the window.
   >
   > Restoring flags only after both services are at the release candidate keeps the
   > Wave 1 surfaces from being enabled against older code at any point. The sequence
   > written above is the one the rehearsal actually executed.

**Fallback if `4ff7811b` cannot be built or deployed:** issue `REHEARSAL FAIL` and
stop. Do not substitute `62f21e10` — it carries 200 migration files and would
exercise only two of the five migrations (§7.1), which does not evidence the
rollback claim. A fallback run is not a passing run.

### 7.3 Evidence to collect

Record every item. An unrecorded item is an unproven claim, and this rehearsal is
the only evidence standing behind §4's ordering and §4.1's duration risk.

**Commits and deploys**

- [ ] Pre-rehearsal branch, commit, and deploy id for each service (the values in the
      §7.2 precondition table, re-confirmed at run time)
- [ ] Source **and** target commit for each service at each transition
- [ ] Deploy id for every build triggered during the rehearsal
- [ ] Start and completion timestamp for every deploy

**Timing — the numbers §4.1 currently lacks**

- [ ] Build duration per service, per transition
- [ ] **Total rollback duration** — step 4 start to step 8 completion
- [ ] **App-first mixed-version duration** — app cutover (step 4) to engine cutover
      (step 6). This is the real exposure window a production rollback would carry.
- [ ] Any period of partial or mixed-version availability beyond that window,
      including anything observed during the Phase 0 repoint

**Health and behaviour**

- [ ] App and engine health results at: baseline, after flag revert, after flag
      restore, after app rollback, after engine rollback, after final restore
- [ ] **Critical authenticated route results with the known-good app against the
      newer engine** (step 5) — the compatibility assumption under test
- [ ] Critical workflow results with both services rolled back (step 8)
- [ ] Whether the known-good commit successfully restores service — stated
      explicitly as pass or fail, not implied by the absence of complaints

**Schema and migrations**

- [ ] Log evidence that `npm run migrate` at `4ff7811b` applied **nothing** (step 7)
- [ ] The `schema_migrations` query result while rolled back
- [ ] Confirmation that no error appeared in either service's logs attributable to
      the extra schema

**Flags**

- [ ] Five-flag state **before, during, and after** — at baseline, under flag revert,
      under full rollback, and after restore
- [ ] `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` recorded at baseline and re-confirmed
      unchanged at step 8 and step 9
- [ ] Note that legacy navigation returned under flag revert (screenshot or log)

**Outcome**

- [ ] Any errors or unexpected behaviour, including ones that did not stop the run
- [ ] Final staging state: both services on `develop` at the release-candidate commit
      established in Phase 0, deploy ids recorded, five flags `true`, health 200 on
      both
- [ ] Explicit verdict: rehearsal **PASS** or **REHEARSAL FAIL**, with the failing
      step named if applicable

---

## 8. Evidence to capture during promotion

- [ ] Engine deploy id + timestamp, reached live
- [ ] The 5-row `schema_migrations` query result
- [ ] Engine `/health` 200
- [ ] App deploy id + timestamp, reached live
- [ ] App `/api/health` 200 `{"status":"ok"}`
- [ ] Spot-check one Wave 1 surface per flag pair (Briefing, Decision Workspace, Vendor Assurance)
- [ ] Sentry receiving events from both services under the expected environment
      label — **read §9 first; two of the obvious ways to check this do not work**

---

## 9. Sentry — verified state and two real limitations

All ten Sentry variables are `sync: false`, so they live only in the Render
dashboard. That does **not** make them unverifiable, and an earlier assessment
that called them so has been corrected (see §9.3).

### 9.1 What is verified

Read live from the production services, 2026-08-04:

| Variable | Production state |
|---|---|
| `SENTRY_DSN_ENGINE` | present (95 chars) |
| `SENTRY_DSN_APP` | present (95 chars) |
| `NEXT_PUBLIC_SENTRY_DSN_APP` | present (95 chars) |
| `SENTRY_ENV` | `production` |
| `NEXT_PUBLIC_SENTRY_ENV` | `production` |

Engine initialization is proven by execution, not by inspection: it logs
`{"event":"sentry_initialized","environment":…}` on success and
`{"event":"sentry_disabled"}` otherwise (`src/api/lib/sentry.ts:146,165`), and the
DSN never appears in output. Grep the engine's Render logs for those two events —
that is the secret-safe check.

### 9.2 Limitation 1 — the client release label is dead

`app/sentry.client.config.ts:27` sets `release: process.env.NEXT_PUBLIC_RENDER_GIT_COMMIT`.

**That variable is declared nowhere in `render.yaml`** — not for
`securelogic-app`, not for staging. (`NEXT_PUBLIC_SENTRY_ENV` *is* declared, at
`render.yaml:1250` and `:1382`; the commit variable is not.) It is therefore
undefined at build time on every environment, and `release` falls through to
Sentry's own detection.

**Consequence:** browser-side Sentry events cannot be attributed to a specific
deploy of this release. Do not plan to use the Sentry release label to tell
pre-promotion from post-promotion client errors — it will not distinguish them.
This is a pre-existing gap, not something this release introduces, and it is **not
a promotion blocker**. Fixing it means declaring the variable in `render.yaml`;
that is out of scope here and deliberately not bundled into this promotion.

### 9.3 Limitation 2 — the app gives no boot-time Sentry signal

`app/sentry.server.config.ts` and `app/sentry.edge.config.ts` emit **no log line at
all** on initialization — verified by inspection. Unlike the engine, there is no
`sentry_initialized` / `sentry_disabled` equivalent, so **log inspection cannot
tell you whether app Sentry came up.** Attempting it and finding nothing is not
evidence of failure; it is evidence of nothing.

The two checks that do work:

- Browser devtools on a loaded page — `window.__SENTRY__` present.
- A deliberate test error, confirmed to land in the expected project and
  environment.

### 9.4 A trap in verifying the app DSN

`NEXT_PUBLIC_SENTRY_DSN_APP` is **inlined into the browser bundle at build time**
(stated in the header comment of `app/sentry.client.config.ts`, and inherent to
`NEXT_PUBLIC_*`). Setting or changing it in the Render dashboard does nothing until
the app is rebuilt.

**So verify it against the deployed bundle, not the dashboard value.** A dashboard
showing the right DSN while the running bundle was built without one is a
consistent, silent failure — and precisely the state the §8 checkbox would
otherwise be ticked against.
