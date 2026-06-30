# Sprint 1 — Production Go-Live (Launch-Blocking Only)

> **Status:** ACTIVE — **NO-GO** (re-confirmed 2026-06-30).
> **Goal:** Promote the staged `develop` release to production `main` safely.
> **Scope discipline:** This sprint contains **ONLY** work that blocks production go-live. No features, no polish, no post-launch items. Anything not on this list belongs to Sprint 2 or Sprint 3.

---

## Launch state (verified)

- **Production (`main`):** `959951b9` — carries only the Priority-4 4A.1 contract-stubs foundation; stable, known-good.
- **Staging (`develop`):** `b221c0c8` — ~90 commits + **6 migrations** ahead of `main`. The entire Phase-4 B/C/D signal batch is flag-gated/inert. Website Phase 1/2A and app/auth branding are website-only.
- **Branch range:** `origin/develop..origin/main = 0` is **not** the relevant direction here — the staged work lives in `origin/main..origin/develop`. The promotion is the merge that moves it to `main`.

**Static evidence already PASS (automated-session-verifiable — do not re-block on these):**
- All 7 CI lanes green on `develop` HEAD: `typecheck`, `lint`, `test`, `build`, `cross-org-isolation`, `tenant-coverage`, `audit`.
- Canonical checkout routing: only canonical plan tokens (`professional` / `teams` / `platform` / `platform_annual`); `resolvePriceId` + `tierToDbLevel` correct; `checkoutPlanRouting.test.ts` green; engine suite green.
- Seat-cap migration SQL reviewed: default → 6, backfill `WHERE max_members = 10` only, orgs > 10 untouched, idempotent.
- `render.yaml` diff over `main` is limited to a **staging-only** `STRIPE_PORTAL_CONFIGURATION_ID` declaration on `securelogic-engine-staging`; **prod service blocks unchanged**.
- Phase-4 flags (`SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE`) absent from `render.yaml` → default OFF (prod runtime still operator-verify).

These do not need re-doing. **The remaining blockers are all operator-only** and cannot be executed by an automated session.

---

## The 5 launch-blocking gates

All five must pass before a Go decision. **Owner: operator** (requires Render / Stripe / staging-UI / production-DB access). An automated session cannot run any of them.

### Gate 1 — Stripe Billing Portal configuration (Render + Stripe)
**Blocking because:** "Manage billing" is broken without it.
- [ ] Set `STRIPE_PORTAL_CONFIGURATION_ID` on `securelogic-engine-staging`, redeploy, record timestamp.
- [ ] Confirm `STRIPE_PORTAL_CONFIGURATION_ID` is set on the **production** engine service (or confirm portal is intentionally optional for launch).
- **Acceptance:** staging "Manage billing" opens the Stripe portal; prod env var present (or documented exception).
- **Note:** Portal *features* are Stripe-Dashboard config with no code counterpart — this gate is entirely operator-side.

### Gate 2 — Stripe test-mode portal capabilities (Stripe Dashboard)
**Blocking because:** customers must be able to manage subscriptions post-launch.
- [ ] Test-mode portal config enables: subscription_update, price changes, prorations, cancellations (per decision).
- [ ] All 4 test-mode Price IDs present in the allowed-plan list.
- **Acceptance:** a test customer can upgrade/downgrade/cancel through the portal in test mode.

### Gate 3 — Staging checkout amounts (staging UI)
**Blocking because:** wrong prices at launch are a commercial and trust failure.
- [ ] Brief Pro = **$49 / mo**
- [ ] Team Professional = **$199 / mo**
- [ ] Platform Professional — Annual = **$7,200 / yr**
- [ ] Platform Professional monthly ($800/mo) remains **Billing-Portal-only** (no primary checkout CTA).
- **Acceptance:** each checkout session shows the correct amount against the correct plan.
- **Static counterpart (already PASS):** routing maps these to canonical tokens correctly; this gate validates the *amounts render* end-to-end.

### Gate 4 — Staging portal upgrade/downgrade transitions (staging UI + webhook + DB)
**Blocking because:** entitlement correctness across plan changes is core to the commercial model.
- [ ] Exercise the 5 plan transitions. For **each** transition confirm:
  - Stripe subscription updates,
  - webhook fires,
  - `entitlement_level` is set correctly in the DB,
  - the portal returns the user to the app.
- **Acceptance:** all 5 transitions produce the correct `entitlement_level` with no stuck/incorrect state.

### Gate 5 — Migration validation + production pre-flight (staging DB + prod DB)
**Blocking because:** the migration runner is filename-keyed and can silently skip a reshaped migration (`BUILD_SEQUENCE.md` gate **F-1**).
- [ ] Validate **all 6** staged migrations apply cleanly on **staging**:
  - `20260706_risk_numeric_score.sql`
  - `20260707_sources.sql`
  - `20260708_sources_authority.sql`
  - `20260709_cyber_signals_cluster_key.sql`
  - `20260710_brief_item_signal_provenance.sql`
  - `20260711_team_seat_cap_6.sql`
- [ ] **F-1 check:** confirm `SELECT count(*) FROM schema_migrations WHERE filename='20260706_risk_numeric_score.sql'` returns **0** in staging **and** prod (PR #382 reshaped this migration after first commit; non-zero ⇒ do **not** promote as-is, add a re-stamp/controlled re-apply).
- [ ] **Seat-cap pre-flight (prod):** confirm `SELECT ... WHERE max_members = 10` shows no legitimate 10-seat org that would be wrongly lowered to 6.
- **Acceptance:** all 6 migrations applied on staging, F-1 returns 0 in both environments, no legit 10-seat org at risk.

---

## Promotion-readiness gate (CI + flags + branch hygiene)

Must also hold at promotion time (mix of automated-verifiable and operator-confirm):
- [ ] All 7 CI lanes green on the exact promotion head.
- [ ] Phase-4 flags confirmed **OFF** in the **production** engine env (`SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE`).
- [ ] Promotion executed as a **true merge** (`gh pr merge <N> --merge` — never the squash button).
- [ ] Post-merge: `origin/develop..origin/main = 0` and `develop` tip has 2 parents (back-merge invariant).
- [ ] Post-deploy: `/version` on production engine **and** app returns the promoted commit.

Full procedure: `RELEASE_CHECKLIST.md`.

---

## Definition of done (Sprint 1)

Sprint 1 is complete when:
1. Gates 1–5 all pass with recorded evidence/timestamps.
2. The promotion PR is merged to `main` via a true merge with all 7 CI lanes green.
3. Phase-4 flags verified OFF in prod.
4. Post-deploy `/version` confirms the promoted commit on both prod services.
5. The launch state is updated from **NO-GO** to **LIVE** in `LAUNCH_MASTER_PLAN.md` and `KNOWN_ISSUES.md`.

**Do not** start Sprint 2 work until this is true.

---

## Explicitly out of scope for Sprint 1

These are real and queued, but they do **not** block go-live and must not creep in:
- Export-delivery email (GDPR PR #4) — exports are intentionally inert until then → Sprint 2.
- In-app price-label reconciliation (stale BriefCard/UpgradeCard/`/pricing` labels) → Sprint 2.
- Vendor-assurance production enablement confirmation + rank-2 route gate flip → Sprint 2.
- Brand-asset swap (interim icon-only PNG is launch-approved) → Sprint 2.
- A04-G1 `app_request` RLS flip → Sprint 3.
- GDPR deletion reaper → Sprint 3.
- Priority-4 signal-ingestion 4B/4C/4D → Sprint 3.
