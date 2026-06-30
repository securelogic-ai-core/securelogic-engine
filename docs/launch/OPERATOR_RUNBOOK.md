# SecureLogic AI — Operator Runbook (Production Launch)

> **Status:** definitive launch runbook for the **operator-only** gates that block the first `develop → main` promotion. Part A (app hardening, A1–A5) is complete on `develop`; this document reduces **Part B** to a precise, executable checklist.
>
> **Relationship to other docs:**
> - `RELEASE_CHECKLIST.md` — the reusable, *mechanical* `develop → main` procedure (CI, true-merge, branch invariants, post-deploy). Use it for **every** release.
> - **This file** — the *launch-specific*, gate-by-gate operator playbook with copy-pasteable commands/SQL and PASS/FAIL evidence. Use it **once** to clear Gates 1–5, then keep it as the canonical billing/migration verification reference.
> - `SPRINT_1.md` — sprint scope + status. `KNOWN_ISSUES.md` — the live L-1…L-x gate tracker.
>
> **Hard rules for this runbook:** do **not** promote to `main`, do **not** open a promotion PR, do **not** enable any feature flag while executing it. These gates are *validation in staging + config*, not code or release actions.

---

## 0. Before you start

### 0.1 What you need access to
- **Render dashboard** — both `securelogic-engine` (prod) and `securelogic-engine-staging`; env vars + redeploy + deploy logs.
- **Stripe dashboard** — **Test mode** for Gates 2–4; the live-mode Price IDs for the Gate-3 amount cross-check.
- **Database** — `psql` (or Render PSQL console) for **staging** and **prod**. Credentials are operator-only; none of the SQL below is runnable from CI or a dev shell.
- The staging app + engine URLs (for portal/checkout click-through and `/version`).

### 0.2 The four canonical plans (single source of truth)
Engine `resolvePriceId()` — `src/api/routes/billing.ts:89-98`; entitlement mapping — `src/api/webhooks/stripeWebhook.ts:277-290`; labels — `app/src/lib/api.ts:48-53`.

| Plan token | Stripe Price-ID env var | Billing | Expected amount | DB `entitlement_level` | Product name |
|---|---|---|---|---|---|
| `professional` | `STRIPE_PRICE_ID_PROFESSIONAL` | monthly | **$49/mo** | `professional` | Brief Pro |
| `teams` | `STRIPE_PRICE_ID_TEAMS` | monthly | **$199/mo** | `professional` | Team Professional |
| `platform` | `STRIPE_PRICE_ID_PLATFORM` | monthly | **$800/mo** | `premium` | Platform Professional (monthly) |
| `platform_annual` | `STRIPE_PRICE_ID_PLATFORM_ANNUAL` | annual | **$7,200/yr** (= $600/mo billed annually) | `premium` | Platform Professional (annual) |

> All four Price-ID vars are declared `sync: false` in `render.yaml` on **both** services — i.e. operator-set secrets, never in the repo. They are **required at engine boot** in production (`src/api/startup/validateEnv.ts:15-18`); a missing one fails checkout with `503 billing_not_configured`.

### 0.3 ⚠️ Three pre-launch findings to resolve (surfaced from a code audit, not yet decided)
These are **decisions/verifications**, not part of the mechanical pass. Read them before Gate 3/4 — two contradict the written commercial model.

- **D-1 (Gate 3) — `platform` monthly is currently a *checkout* line, not portal-only.** `SPRINT_1.md` and `LAUNCH_MASTER_PLAN.md` state Platform monthly ($800) is **Billing-Portal-only**. The code does **not** enforce that: `VALID_TIERS` includes `platform` (`billing.ts:87`) and the app renders a "Platform Professional — $800/mo" checkout button (`app/src/components/UpgradeCard.tsx:64,72`; also `account/page.tsx:304`, `dashboard/page.tsx:388`; `verify-email` auto-posts it). **Decision required:** either (a) accept self-serve `platform` monthly checkout (update the docs), or (b) before launch remove the `platform` checkout button + drop `platform` from `VALID_TIERS` (code change — **out of this runbook's scope**, raise as a Sprint item). Until decided, Gate 3 cannot honestly claim "platform is portal-only."
- **D-2 (Gate 4) — Enterprise (`admin`) entitlement is not produced by the Stripe webhook.** The app maps `admin → Enterprise` (`api.ts:50`), but the webhook collapses legacy `admin → premium` and never writes `admin` (`stripeWebhook.ts:281-287`). Enterprise must be granted by another path. **Not a launch blocker** unless Enterprise is sold self-serve at launch (it is not — Enterprise is "Custom"). Note it so no one expects Stripe to grant Enterprise.
- **D-3 (Gate 4) — member seats (`max_members`) are not metered by the webhook.** The webhook raises only the *entity* cap (`max_monitored_entities`, `GREATEST(…,50)`, `stripeWebhook.ts:381`); it never writes `max_members`. Seat caps come from the seat-cap migration (Gate 5) + app default `DEFAULT_MAX_SEATS = 6` (`src/api/lib/seatLimit.ts:33`). So a Team→Platform upgrade does **not** auto-raise seats via Stripe. Confirm this matches intent before validating Gate 4 "entitlement correct."

### 0.4 Evidence log (fill one row per gate)
Attach to the promotion PR / launch record.

| Gate | Result (PASS/FAIL) | Operator | Timestamp (UTC) | Evidence artifact |
|---|---|---|---|---|
| 1 | | | | Render env screenshot + redeploy ts + portal-opens screenshot |
| 2 | | | | Stripe portal-config screenshot (capabilities + allowed prices) |
| 3 | | | | 4× checkout screenshots (amount + interval) + Stripe Price amounts |
| 4 | | | | 5× before/after `entitlement_level` query + webhook event IDs |
| 5 | | | | F-1 count output + seat-cap pre-flight output + staging apply log |

---

## Gate 1 — Stripe Billing Portal configuration

### Objective
Guarantee that **"Manage billing"** opens a working Stripe Billing Portal session in production. The customer-facing failure this prevents is the `/account?billing_error=portal_failed` dead-end.

### Why it exists
The engine's portal route fails **closed** if its return URL is unset, and the portal is useless for plan changes if no portal *configuration* is attached. Both are operator-set secrets (`sync: false`), so neither is guaranteed by deploying code — they must be set per environment by hand.

### What the evidence is / where it comes from
- Route: `POST /billing/portal` — `src/api/routes/billing.ts:212`.
- **Hard gate:** `STRIPE_PORTAL_RETURN_URL` (`billing.ts:214`). If falsy → log `billing_portal_misconfigured` → **`503 {"error":"billing_not_configured"}`** (`billing.ts:216-222`). Required at boot (`validateEnv.ts:21`).
- **Plan-change enabler:** `STRIPE_PORTAL_CONFIGURATION_ID` (`billing.ts:278`), applied as `{ configuration: portalConfigId }` only if set (`billing.ts:288`). If unset the portal **still opens** (Stripe default config: payment-method management only) — upgrade/downgrade/cancel will be missing. It is **not** in `render.yaml` for prod (dashboard-only); it **is** declared for staging (`render.yaml:237-238`, `sync:false`).
- App surfacing: `app/src/app/api/billing/portal/route.ts:54-58` → 303 `…/account?billing_error=portal_failed&reason=<engine-error>`; message at `app/src/app/account/page.tsx:35`.

### Step-by-step operator instructions
1. **Staging engine** (`securelogic-engine-staging`) → Render → Environment. Confirm/set:
   - `STRIPE_PORTAL_RETURN_URL` = the staging account URL (e.g. `https://<staging-app>/account`).
   - `STRIPE_PORTAL_CONFIGURATION_ID` = the Test-mode portal config id (`bpc_…`) created in Gate 2.
2. **Production engine** (`securelogic-engine`) → Environment. Confirm `STRIPE_PORTAL_RETURN_URL` is set (prod account URL). **Add `STRIPE_PORTAL_CONFIGURATION_ID`** (live-mode `bpc_…`) — it is absent from `render.yaml` by design and must be set here.
3. Redeploy each service after changing env vars (Render → Manual Deploy / "Save, rebuild, and deploy"). **Record the redeploy timestamp.**
4. On staging, sign in as a customer with an active subscription → **Account → Manage billing**. Confirm a Stripe portal page opens (not the `billing_error=portal_failed` banner).

### Expected results
- "Manage billing" navigates to a `billing.stripe.com` portal session and back to your `…/account` return URL.
- No `billing_not_configured` / `portal_failed` banner.

### Evidence required
- Render env screenshot (both services) showing both vars present (values may be redacted).
- Redeploy timestamps.
- Screenshot of the opened Stripe portal from staging.

### PASS criteria
- Both vars set on **both** services; both redeployed; staging "Manage billing" opens the portal and returns to `/account`.

### FAIL criteria
- `503 billing_not_configured` / `?billing_error=portal_failed` on staging → `STRIPE_PORTAL_RETURN_URL` missing/empty on that engine.
- Portal opens but has no plan-change options → `STRIPE_PORTAL_CONFIGURATION_ID` missing (proceed to Gate 2 to create/attach it).

### Common mistakes
- Setting `STRIPE_PORTAL_RETURN_URL` but assuming `STRIPE_PORTAL_CONFIGURATION_ID` is optional — without it Gate 2/4 cannot pass.
- Setting the var but **not redeploying** (env changes need a deploy).
- Setting the **Test-mode** `bpc_…` on the **prod** engine (use the live-mode config id in prod, test-mode in staging).
- Confusing the two vars — `RETURN_URL` is the 503 gate; `CONFIGURATION_ID` is the capability enabler.

### Estimated time
**15–20 min** (incl. two redeploys).

---

## Gate 2 — Stripe Billing Portal capabilities (Test mode)

### Objective
Ensure the attached portal configuration actually allows the operations customers need — plan **price** changes with **prorations** and **cancellation** — and that all four plan Price IDs are in the portal's allowed-update list.

### Why it exists
The portal session inherits its allowed operations from the Stripe **portal configuration** (`bpc_…`). A config that omits `subscription_update` or the plan prices will open fine yet silently forbid upgrades/downgrades — making Gate 4 impossible.

### What the evidence is / where it comes from
Required config is documented in-code at `src/api/routes/billing.ts:261-277` and as a gate in `RELEASE_CHECKLIST.md:48`. The four prices to allow are the §0.2 `STRIPE_PRICE_ID_*` values.

### Step-by-step operator instructions
1. Stripe Dashboard → **Test mode** → Settings → Billing → **Customer portal**.
2. Enable / confirm:
   - **Subscriptions → Customers can switch plans** = ON, with **allowed updates = price**, **proration = Create prorations**.
   - **Subscriptions → Customers can cancel subscriptions** = ON, **at end of billing period**, cancellation reasons enabled.
   - **Customers can update payment methods** = ON; **Invoice history** = ON.
3. **Allowed plan updates / products:** add all four Test-mode Prices (the `professional`, `teams`, `platform`, `platform_annual` prices). Every plan a customer can move between must be in this list.
4. Save. Copy the resulting **portal configuration id** (`bpc_…`) → this is the value used in Gate 1 step 1 (staging). Repeat in **live mode** to get the prod `bpc_…`.

### Expected results
- A saved portal configuration exposing price-switch (with prorations) + cancel-at-period-end, listing all four plan prices.

### Evidence required
- Screenshot of the Test-mode portal configuration showing the enabled capabilities and the four allowed prices.
- The `bpc_…` ids (test + live) recorded for Gate 1.

### PASS criteria
- `subscription_update` (price, create_prorations) + `subscription_cancel` (at period end) enabled; all four Price IDs present in allowed updates; `bpc_…` captured for both modes.

### FAIL criteria
- Any of the four prices missing from allowed updates → that transition will be blocked in Gate 4.
- Plan switching disabled, or proration not set → upgrades won't reprice correctly.

### Common mistakes
- Configuring **live** mode but testing Gate 4 in **test** mode (or vice-versa) — keep mode consistent end-to-end.
- Adding **products** but not the **specific Prices** customers actually subscribe to.
- Forgetting to attach the resulting `bpc_…` back onto the engine (Gate 1) — a config that isn't referenced does nothing.

### Estimated time
**15–25 min** (test + live).

---

## Gate 3 — Checkout validation (staging)

### Objective
Confirm every self-serve checkout charges the correct amount at the correct interval for each offered plan.

### Why it exists
Checkout sends only `{ price: priceId, quantity: 1 }` (`billing.ts:165`) — the amount lives entirely in the Stripe **Price** object. A mis-mapped env var or a wrong Price amount is invisible in code and only catchable by exercising checkout and reading the Stripe Price.

### What the evidence is / where it comes from
- Route `POST /api/billing/checkout` (`billing.ts:104-191`); tier→price map (`billing.ts:89-98`); allow-list `VALID_TIERS` (`billing.ts:87`) → invalid → `400 invalid_tier` (`billing.ts:117-122`).
- Displayed labels are **hardcoded** in the app (drift risk) — e.g. `verify-email/page.tsx:29-32`, `signup/SignupForm.tsx:32-35`, `UpgradeCard.tsx`, `account/page.tsx:286-313`, `pricing/page.tsx`. The **authoritative** amount is the Stripe Price, not these labels.
- **Read §0.3 D-1 first** — decide `platform` monthly's checkout-vs-portal status before this gate.

### Step-by-step operator instructions
For each plan, on **staging**, start checkout and read the Stripe-hosted page total (use a Stripe test card `4242 4242 4242 4242`):
1. **Brief Pro** — `…/signup?plan=professional` → verify email → auto-redirect to checkout (or **Briefs → upgrade**). Expect **$49.00 / month**.
2. **Team Professional** — `plan=teams`. Expect **$199.00 / month**.
3. **Platform Annual** — `plan=platform_annual`. Expect **$7,200.00 / year** (Stripe may show "$600.00/month billed annually" depending on the Price's interval config — confirm the **annual total is $7,200**).
4. **Platform monthly** — per D-1: if kept self-serve, `plan=platform` → expect **$800.00 / month**; if it is to be portal-only, confirm the checkout button is removed (else this is a FAIL against the stated model).
5. Cross-check each Stripe **Price** object's `unit_amount` × interval in the Stripe dashboard equals the above.
6. Confirm an unknown tier (e.g. `plan=bogus`) is rejected (`invalid_tier`) and never reaches Stripe.

### Expected results
- Each checkout opens a Stripe page with the exact amount + interval in the table above; the Stripe Price amounts match.

### Evidence required
- One screenshot per plan of the Stripe checkout page (amount + interval).
- Screenshot of each Stripe Price `unit_amount`/interval.
- Note the D-1 decision (platform monthly: self-serve vs portal-only).

### PASS criteria
- professional $49/mo, teams $199/mo, platform_annual $7,200/yr all correct; platform monthly $800/mo correct **or** intentionally not offered per D-1; invalid tier rejected.

### FAIL criteria
- Any amount/interval mismatch → wrong Price in the env var, or wrong amount on the Stripe Price.
- `503 billing_not_configured` at checkout → that plan's `STRIPE_PRICE_ID_*` env var is unset on the engine.
- platform monthly offered as checkout while the model says portal-only, with no D-1 decision recorded.

### Common mistakes
- Trusting the **hardcoded UI label** instead of the Stripe page / Price object (labels can drift from Stripe).
- Testing with **live** Prices on staging, or mixing test/live Price IDs.
- Reading the annual plan's "$600/mo" sub-label and concluding the annual total is wrong — confirm the **yearly** figure ($7,200).

### Estimated time
**25–35 min** (4 plans + Price cross-check).

---

## Gate 4 — Upgrade / downgrade + webhook + entitlement (staging)

### Objective
Prove that each portal-driven plan transition (a) updates the Stripe subscription, (b) fires the webhook, (c) writes the correct `entitlement_level` to `organizations`, and (d) returns the user to the app.

### Why it exists
Entitlement is derived **from the current Stripe Price** on `customer.subscription.updated` (`stripeWebhook.ts:107-165`), not from checkout metadata. A broken webhook (bad secret, rejected signature, idempotency error) silently leaves a customer on the wrong tier. This is the only gate that exercises the full money→access path.

### What the evidence is / where it comes from
- Webhook route `POST /webhooks/stripe` (`src/api/app.ts:355-367`); secret `STRIPE_WEBHOOK_SECRET` (required, `validateEnv.ts:14`); signature verify `stripeWebhook.ts:632`.
- Events handled: grant = `checkout.session.completed`, `customer.subscription.created|updated`; revoke = `customer.subscription.deleted`; `invoice.payment_failed` stamps `payment_failed_at` (no revoke) (`stripeWebhook.ts:23-46,544-582`).
- Entitlement write: `UPDATE organizations … SET entitlement_level=$1` (`stripeWebhook.ts:367,381`).
- **Idempotency fails CLOSED:** duplicate → `idempotent_replay` 200; claim INSERT error → `500` so Stripe retries (`stripeWebhook.ts:655-681`, `webhookIdempotency.ts:23-35`).
- Stale-revoke guard: a deleted sub ≠ current `stripe_subscription_id` is **not** revoked (`stripeWebhook.ts:759-780`) — so upgrades don't self-downgrade.
- **Read §0.3 D-2 (no Enterprise via webhook) and D-3 (seats not metered) first.**

### The five transitions and their expected `entitlement_level`
Derived from `billing.ts:71-78` + `stripeWebhook.ts:136-200,277-290`:

| # | Transition | Stripe event | Expected `entitlement_level` |
|---|---|---|---|
| 1 | Brief Pro ↔ Team (`professional` ↔ `teams`) | `subscription.updated` (active) | `professional` (unchanged) |
| 2 | Brief/Team → Platform (`platform`) | `subscription.updated` (active) | `premium` |
| 3 | Platform monthly ↔ Platform annual | `subscription.updated` (active) | `premium` (unchanged) |
| 4 | Platform → Brief/Team (downgrade) | `subscription.updated` (active) | `professional` |
| 5 | Any paid → cancel | `subscription.deleted` (or `updated` → canceled/past_due/unpaid) | `starter` |

### Step-by-step operator instructions
For each transition above, on **staging** (test mode):
1. As a customer on the start plan, open **Manage billing** → change to the target plan (or cancel for #5).
2. In **Stripe → Developers → Events** (and the webhook endpoint's delivery log), confirm the event fired and returned **2xx** (note the `evt_…` id).
3. Query the org's entitlement **before and after**:
   ```sql
   -- replace with the test org id
   SELECT id, name, entitlement_level, stripe_subscription_id, max_monitored_entities
   FROM organizations WHERE id = '<org-uuid>';
   ```
   Confirm `entitlement_level` matches the table.
4. Confirm the browser returns to the app's `STRIPE_PORTAL_RETURN_URL` (`/account`).
5. (Idempotency spot-check) In Stripe, **Resend** one delivered event; confirm the endpoint responds 200 `idempotent_replay` and the row is unchanged.

### Expected results
- Each transition: Stripe sub reflects the new price, webhook 2xx, `entitlement_level` exactly as the table, user back on `/account`, resend is a no-op.

### Evidence required
- Per transition: the `evt_…` id + delivery 2xx, and the before/after `entitlement_level` query output.
- One resend showing `idempotent_replay` + unchanged row.

### PASS criteria
- All 5 transitions produce the expected `entitlement_level`; webhook 2xx each; resend is idempotent.

### FAIL criteria
- Webhook delivery non-2xx → check `STRIPE_WEBHOOK_SECRET` matches the endpoint's signing secret; a `500` means the idempotency claim couldn't be recorded (DB issue) — investigate, do **not** disable the gate.
- `entitlement_level` wrong/unchanged after a transition → price→tier map or env Price IDs misaligned (cross-check Gate 3).
- Cancellation doesn't drop to `starter` → revoke path / stale-sub guard misfire.

### Common mistakes
- Expecting an **Enterprise** result from any transition (D-2 — webhook never writes `admin`).
- Expecting **seats** to change on Team→Platform (D-3 — webhook doesn't touch `max_members`).
- Reading entitlement from Redis cache assumptions instead of the **Postgres `organizations`** row (the DB is the gate's source of truth).
- Testing with a webhook secret from the wrong endpoint/mode.

### Estimated time
**40–60 min** (5 transitions + idempotency check).

---

## Gate 5 — Migration validation + production pre-flight

### Objective
Confirm the six staged migrations (`20260706`–`20260711`) apply cleanly on staging, are not silently skipped by the filename-keyed runner (F-1), and that the seat-cap migration won't wrongly lower a legitimately-provisioned 10-seat org.

### Why it exists
The migration runner is **filename-keyed** (`scripts/runMigrations.ts:71-77`): a migration whose filename already exists in `schema_migrations` is silently skipped — so a reshaped file can deploy with **none of its DDL applied**. Separately, `20260711` runs `UPDATE organizations SET max_members=6 WHERE max_members=10`, which cannot tell a *stale-default* 10 from a *deliberately-set* 10.

### What the evidence is / where it comes from
- Runner: `scripts/runMigrations.ts` — `MIGRATION_DATABASE_URL ?? DATABASE_URL` (line 6); tracking table `schema_migrations(filename UNIQUE)` (lines 22-30); skip-if-applied (lines 71-77); per-file `BEGIN…COMMIT` (40-59). Auto-runs on engine deploy (`RELEASE_CHECKLIST.md:78`).
- The six migrations in `db/migrations/` (all additive + `IF NOT EXISTS`/idempotent):
  - `20260706_risk_numeric_score.sql` — `risks` adds `residual_score/inherent_score/score_basis` + range CHECKs + backfill + index. Nullable, re-runnable.
  - `20260707_sources.sql` — `CREATE TABLE sources` (global, no RLS) + 13-row seed `ON CONFLICT DO NOTHING`. Reversible `DROP TABLE sources`.
  - `20260708_sources_authority.sql` — DML updates to `sources` + guarded `sources_authority_vocab_check`.
  - `20260709_cyber_signals_cluster_key.sql` — `cyber_signals ADD COLUMN cluster_key` + **non-unique** partial index; **dedup_hash/unique dedup indexes untouched** (R-1 invariant).
  - `20260710_brief_item_signal_provenance.sql` — `CREATE TABLE intelligence_brief_item_provenance` + RLS policy (NOT FORCE; INERT until A04-G1 flip).
  - `20260711_team_seat_cap_6.sql` — `max_members` DEFAULT 6 + `UPDATE … WHERE max_members=10`. **Not auto-reversible** (a 6 could be original or backfilled).
- `/version` contract (post-deploy): engine `src/api/routes/index.ts:180-187`, app `app/src/app/api/version/route.ts:5-12` → `{commit,service,branch,deployedAt}`.
- Flags that must be **OFF in prod** (these gate the new migrations' consumers): `SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE` (`RELEASE_CHECKLIST.md:42`).

### Step-by-step operator instructions
**A. F-1 filename-key check — run in BOTH staging and prod:**
```sql
SELECT filename
FROM schema_migrations
WHERE filename IN (
  '20260706_risk_numeric_score.sql',
  '20260707_sources.sql',
  '20260708_sources_authority.sql',
  '20260709_cyber_signals_cluster_key.sql',
  '20260710_brief_item_signal_provenance.sql',
  '20260711_team_seat_cap_6.sql'
);
```
Expected: **0 rows** (none applied yet under these names). Any returned filename whose committed content differs from what's recorded ⇒ **do not promote**; re-stamp or rename before release.

**B. Seat-cap pre-flight — run in BOTH staging and prod, BEFORE promotion:**
```sql
SELECT id, name, max_members
FROM organizations
WHERE max_members = 10;
```
Expected: **0 rows**, or only rows you can confirm are **stale-default** orgs (never deliberately set to 10). Any legitimately-provisioned 10-seat org here would be silently lowered to 6 by `20260711`.

**C. Staging apply validation:** ensure staging has auto-applied all six (it deploys from `develop`). Confirm:
```sql
SELECT filename, applied_at FROM schema_migrations
WHERE filename LIKE '202607%' ORDER BY filename;
```
Expected: all six present with recent `applied_at`, and no migration errors in the staging engine deploy log.

**D. Flag state:** confirm `SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE` are **OFF / unset** in the **production** engine env. (Do not enable them.)

**E. Post-deploy (after the operator-authorized promotion, per `RELEASE_CHECKLIST.md` §9 — not part of clearing this gate):** `/version` on prod engine and app both return the promoted commit; `/health` green; the six filenames now appear in prod `schema_migrations`.

### Expected results
- F-1 returns 0 in staging + prod; seat-cap pre-flight returns no legitimate 10-seat org; all six applied cleanly on staging; the four flags OFF in prod.

### Evidence required
- F-1 query output (staging + prod).
- Seat-cap pre-flight output (staging + prod) with a note on any 10-row's legitimacy.
- Staging `schema_migrations` listing of the six + clean deploy log.
- Screenshot/listing of the four flags OFF in prod env.

### PASS criteria
- All of the above true. (Post-promotion: prod `/version` = promoted commit and the six rows recorded.)

### FAIL criteria
- F-1 non-zero for any of the six with changed content → silent-skip risk; halt.
- Seat-cap pre-flight returns a real 10-seat customer → it would be cut to 6; halt and adjust the migration or the org.
- A staging migration errored / a filename missing from staging `schema_migrations` → fix before promotion.
- Any of the four flags ON in prod → stop; this launch ships them OFF.

### Common mistakes
- Running the SQL only in staging and not **prod** (F-1 and seat-cap must be checked in **both**).
- Assuming "additive/idempotent" means reversible — `20260711` is **not** auto-reversible; rollback restores DEFAULT 10 only.
- Enabling a Phase-4 flag "to test it" during the gate — these ship OFF.
- Treating `max_monitored_entities` (entity cap, raised by the webhook) as the same thing as `max_members` (seat cap, set by migration).

### Estimated time
**30–45 min** (excludes the separate promotion + post-deploy steps).

---

## Done — what "all gates green" means
When Gates 1–5 each have a **PASS** row in §0.4 with attached evidence, Part B's operator gates are cleared. Promotion itself is a **separate, explicitly-authorized step**: follow `RELEASE_CHECKLIST.md` §7–§10 (true-merge only, branch invariant, `/version` post-deploy, close-out). Do not promote, open a promotion PR, or enable flags as part of this runbook.

### Total estimated operator time
**~2.5–3.5 hours** across Gates 1–5 (plus the separate promotion window).
