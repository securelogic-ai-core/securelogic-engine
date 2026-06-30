# Release Checklist — `develop → main` Promotion

> **Purpose:** The reusable, mechanical procedure for promoting staging (`develop`) to production (`main`). Use this for **every** production release, not just the initial launch.
> **Who runs what:** Static/branch/CI steps are automated-session-verifiable; Stripe/Render/DB/staging-UI steps are **operator-only**. A promotion does not proceed until both columns are green.

---

## 0. Pre-flight — confirm scope and freshness

- [ ] Confirm the **active package** in `BUILD_SEQUENCE.md` and that the staged work matches it (no scope creep into `main`).
- [ ] Confirm governing docs are not stale vs. the staged changes (run a doc-sync check if a major package landed).
- [ ] Record the current heads: production `main` = `__________`, staging `develop` = `__________`.
- [ ] Enumerate what is being promoted: `git log --oneline origin/main..origin/develop` and `git diff --stat origin/main...origin/develop`.
- [ ] Identify every **migration** in the range and every **`render.yaml`** change. List them explicitly.

## 1. CI — all 7 lanes green on the promotion head

- [ ] `typecheck`
- [ ] `lint`
- [ ] `test`
- [ ] `build`
- [ ] `cross-org-isolation`
- [ ] `tenant-coverage`
- [ ] `audit`

> The `audit` lane has flaked historically — re-verify it specifically, do not assume.

## 2. Migrations — filename-key safety (gate F-1)

The migration runner (`scripts/runMigrations.ts`) is **filename-keyed**: a reshaped migration whose filename already exists in `schema_migrations` is **silently skipped**.

- [ ] For every migration in the range, confirm it has **not** been previously applied under the same filename with different content.
- [ ] Specifically (F-1): `SELECT count(*) FROM schema_migrations WHERE filename='20260706_risk_numeric_score.sql'` returns **0** in **staging** and **prod**. Non-zero ⇒ do not promote as-is; add a re-stamp/controlled re-apply.
- [ ] Validate every staged migration applies cleanly on **staging** before promotion.
- [ ] Run any data-pre-flight required by a migration (e.g. seat-cap: confirm no legitimate 10-seat org would be wrongly lowered).
- [ ] **Operator** — DB credentials required; not runnable from CI/dev shell.

## 3. Feature flags — confirm intended production state

- [ ] List every feature flag touched by the range.
- [ ] Confirm each flag's **production** value is the intended launch state (default OFF for dark-shipped work).
- [ ] For this launch specifically: `SOURCE_QUALIFICATION`, `SIGNAL_CLUSTERING`, `SOURCE_AUTHORITY`, `BRIEF_PROVENANCE` are **OFF** in prod; `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` per decision.
- [ ] **Operator** — Render env vars.

## 4. Billing gates (when the range touches billing/pricing/checkout)

- [ ] Stripe portal configuration set (`STRIPE_PORTAL_CONFIGURATION_ID`) on the target service; "Manage billing" opens the portal.
- [ ] Stripe portal capabilities (test mode): subscription_update, price changes, prorations, cancellations; all Price IDs in the allowed-plan list.
- [ ] Staging checkout amounts correct for every plan.
- [ ] Staging portal upgrade/downgrade transitions: Stripe updates + webhook fires + `entitlement_level` correct + return-to-app, for each transition.
- [ ] **Operator** — Stripe Dashboard + staging UI + DB.

## 5. `render.yaml` & infra diff review

- [ ] Diff `render.yaml` over `main`; confirm every change is intended and **scoped to the right service** (staging changes must not touch prod blocks).
- [ ] Confirm region pins are correct for every service block (immutable post-provision).
- [ ] Confirm no secret/env var is being removed that a prod service still requires.

## 6. Rollback plan

- [ ] Record the known-good production commit to revert to: `__________`.
- [ ] Confirm migrations in the range are additive/guarded (reversible or forward-only-safe); note any that are not.
- [ ] Confirm a single `git revert` of the merge commit is a viable rollback (or document the exception).

## 7. Execute the promotion

- [ ] Open the promotion PR `develop → main`.
- [ ] **Merge with a TRUE MERGE:** `gh pr merge <N> --merge`. **Never** use the squash button — squashing makes `develop` HEAD a non-ancestor and re-surfaces the entire changeset on the next PR.
- [ ] Do not merge without explicit operator authorization.

## 8. Post-merge branch invariant

- [ ] `git fetch && git log --oneline origin/develop..origin/main` returns **empty** (`develop` fully contains `main`).
- [ ] `develop` tip is a merge commit with **2 parents** (back-merge absorbed), or a follow-up back-merge PR is opened with `--merge`.

## 9. Post-deploy verification (production)

- [ ] Render auto-deploys both services on the `main` commit; auto-migrate runs on engine start (`npm run migrate`, idempotent).
- [ ] `/version` on the **production engine** returns the promoted commit.
- [ ] `/version` on the **production app** returns the promoted commit.
- [ ] `/health` green on both services.
- [ ] Spot-check the highest-risk changed path (billing, migrations) against real prod behavior — not just code inference.
- [ ] Confirm any newly-applied migration is recorded in `schema_migrations` in prod.

## 10. Close-out

- [ ] Update `LAUNCH_MASTER_PLAN.md` / `KNOWN_ISSUES.md` launch state.
- [ ] Update `BUILD_SEQUENCE.md` "Completed" / promotion-state records if a package closed.
- [ ] Record the promotion (commit, timestamp, gates evidence) in the appropriate memory/log.

---

### Reference

- Branch-sync rule: true-merge only — `gh pr merge --merge`, never squash.
- Migration runner is filename-keyed (F-1) — `scripts/runMigrations.ts`.
- Render auto-migrates on engine deploy and redeploys all connected services on every `main` commit.
- CI lanes are defined in `.github/workflows/ci.yml`.
