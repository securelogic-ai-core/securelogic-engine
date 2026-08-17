# Disaster Recovery & Business Continuity Plan

Status: ACTIVE — closes security-audit finding **E3-G1** ("no documented DR plan, RTO/RPO, or tested restore procedure").
Owner: Platform operator. Last reviewed: 2026-07-30.

> Honesty note: sections marked **[OPERATOR-VERIFY]** depend on Render dashboard
> settings that are not represented in this repository. This plan is not
> considered complete until each of those boxes has been checked once against
> the live dashboard and the restore test in §6 has been executed.

## 1. Recovery objectives (proposed — ratify before quoting to customers)

| Objective | Target | Basis |
|---|---|---|
| RPO (data loss tolerance) | ≤ 24 h baseline; ≤ 5 min if PITR is enabled on the Postgres plan | Render managed-Postgres backup cadence [OPERATOR-VERIFY plan tier] |
| RTO (service restoration) | ≤ 4 h for the platform; ≤ 8 h for full worker backfill | Manual restore + redeploy flow in §5 |
| Intelligence-pipeline gap tolerance | 24 h | Scheduler catch-up + 15-min KEV re-sync repopulate signals; briefs regenerate |

## 2. Infrastructure inventory (source of truth: `render.yaml`)

**14 Render services** — production/staging pairs, all `env: node`, staging tracks `develop`:

| Pair | Type | Role |
|---|---|---|
| securelogic-engine[-staging] | web | Express API — all customer data paths |
| securelogic-app[-staging] | web | Next.js customer portal |
| securelogic-website[-staging] | web | Marketing site (stateless) |
| securelogic-intelligence-worker[-staging] | worker | Scheduled pipeline, KEV sync, matcher fan-out |
| securelogic-posture-worker[-staging] | worker | Posture/risk-history snapshots |
| securelogic-data-rights-worker[-staging] | worker | GDPR export jobs → R2 |
| securelogic-vendor-extraction-worker[-staging] | worker | Assurance-document extraction |

**Stateful dependencies (all external to Render services, injected via `sync: false`):**
- **Postgres** (`DATABASE_URL`, separate staging DB) — the only system of record.
- **Redis** (`REDIS_URL`) — rate-limit counters and queues; safe to lose (rate limiting fails open by design, queues rebuild).
- **Cloudflare R2** (`R2_*`) — uploaded evidence, assurance documents, export bundles.
- **Resend** (email), **Anthropic/OpenAI** (LLM), **Sentry** (errors), **Lemon Squeezy** (billing webhooks).

Secrets: ~40 distinct dashboard-managed keys (155 `sync: false` instances). The dashboard is the only place they exist — **§4 makes them recoverable**.

## 3. Backup strategy

| Asset | Mechanism | Cadence | [OPERATOR-VERIFY] |
|---|---|---|---|
| Postgres (prod) | Render managed backups | Daily minimum; PITR if plan supports | ☐ Confirm backup schedule + retention + PITR on the prod instance |
| Postgres (staging) | Render managed backups | Best-effort | ☐ Confirm it exists (throwaway-acceptable) |
| R2 objects | Cloudflare durability (11 nines); no cross-provider copy | — | ☐ Decide whether evidence requires a second-provider copy (product decision) |
| `render.yaml` + code | GitHub (`main`/`develop`) | Continuous | ☐ Confirm branch protection on `main` |
| Secrets | **Not automatically backed up by anything** | — | ☐ Export a sealed offline copy of the ~40 keys to the org password manager, dated |

Known wrinkle: Render Postgres uses a single default role; `pg_dump`/restore flows must account for RLS object ownership (documented in `docs/A04-G1-rls-rollout-plan.md`). The §6 test exists to prove this wrinkle is handled, not to assume it.

## 4. Restore procedures

### 4a. Database loss (worst case)
1. Declare the incident (§7) and freeze deploys.
2. Render dashboard → Postgres instance → Restore (choose PITR timestamp or latest snapshot). If instance is unrecoverable, create a new instance and restore the snapshot into it.
3. If the instance changed: update `DATABASE_URL` on **all 7 production services** (engine, app, website if applicable, 4 workers). **Post-M-1 activation there are TWO database env keys per DB-connected service** — `DATABASE_URL` (the `app_request` runtime credential) **and** `MIGRATION_DATABASE_URL` (the owner login) — and any DB credential rotation or restore must update BOTH; a missed `MIGRATION_DATABASE_URL` breaks the elevated channel and boot migrations while `/health` stays green (the 2026-08-11 rotation trap). A restored instance must also re-verify the `app_request` role exists with its password (`scripts/validation/m1-preflight.sql` is the gate).
4. Verify: `GET /health` returns `{"status":"ok","db":"connected"}`.
5. Run migration check: migrations are filename-tracked and idempotent — a restored DB at an older migration point self-heals on next deploy.
6. Post-restore validation: run the smoke set in `docs/validation/staging-smoke-2026-07-30.md` §Method against production with an internal tenant.
7. Workers self-recover: scheduler catch-up runs, KEV re-syncs within 15 min, posture snapshots upsert idempotently, webhook retry worker resumes (24 h redelivery window bounds replays), export purge sweeps on boot.

### 4b. Single-service failure
Render → service → Manual Deploy → "Rollback to previous deploy". All services are stateless; no data steps.

### 4c. Full-region / provider outage
Cold-standby posture (accepted for private beta): re-create services from `render.yaml` Blueprint sync in a new region/workspace, restore Postgres from snapshot, re-enter secrets from the sealed copy (§3), repoint DNS. Estimated 4–8 h. No hot standby exists — see §9.

### 4d. Secret compromise
Rotate in dashboard (JWT_SECRET invalidates all sessions — acceptable; FIELD_ENCRYPTION_KEY / MFA_SECRET_KEY rotation requires data re-encryption — **do not rotate without a migration plan**). Webhook endpoint secrets rotate per-endpoint in-app (show-once).

## 5. Recovery validation checklist (run after ANY restore)

☐ `/health` green on engine (db connected) · ☐ app login (password + MFA + SSO) · ☐ team members list correct · ☐ one register list + detail + history renders · ☐ one export downloads · ☐ audit log shows pre-incident events (WORM survived) · ☐ scheduler ran within the hour (run ledger) · ☐ webhook test delivery succeeds · ☐ Sentry receiving · ☐ R2 object fetch (one evidence file opens).

## 6. Testing cadence

- **Restore test: once before private beta go-live** (staging DB → scratch instance → §5 checklist), then quarterly. Record date/duration/issues below.
- Rollback test (4b): monthly, piggybacked on any routine deploy.

| Date | Type | Duration | Outcome |
|---|---|---|---|
| _none yet — REQUIRED before go-live_ | | | |

## 7. Incident response during recovery

- Single incident commander (operator). Communication: status note to affected tenants at declare + hourly (private beta scale: direct email).
- During DB restore: put engine in maintenance by scaling web service to 0 rather than serving stale/partial data.
- Do not run destructive ops (deletes, purge workers) until §5 passes: set `SECURELOGIC_EXPORT_PURGE_DISABLED=true` and `SECURELOGIC_WEBHOOK_RETRY_DISABLED=true` during recovery, unset after.

## 8. Ownership

| Responsibility | Owner |
|---|---|
| Backup verification, restore execution, secret custody, DNS | Platform operator |
| This document + quarterly test | Platform operator (review each quarter or after any architecture change) |

## 9. Risks and limitations (accepted for private beta)

1. **Cold standby only** — provider-level outage means hours, not minutes.
2. **R2 has no second-provider copy** — evidence durability rests on Cloudflare.
3. **Backup posture is dashboard-config, not IaC** — drift is possible; the [OPERATOR-VERIFY] boxes above are the control.
4. **Restore has never been exercised** (as of this writing) — §6 first test is a go-live gate.
5. Single-operator bus factor on secrets custody (mitigated by §3 sealed copy).
