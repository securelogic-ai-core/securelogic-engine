# BL-1 — Migration Lock Exposure: measured

**Executed** 2026-08-15, read-only against production plus a local restored-schema
harness. **Ruling: GO** — with one recommended hardening that is not a blocker,
and one condition that expires.

**Nothing was modified in production.** The production connection ran inside
`BEGIN READ ONLY` with `default_transaction_read_only = on`, `lock_timeout = 1s`
and `statement_timeout`, and issued only catalog reads, row counts and a
`pg_dump --schema-only`. No migration was applied to production, no production
configuration changed, nothing deployed or merged.

---

## 1. Production row counts — the finding that resolves BL-1

Measured directly (exact `count(*)`, not estimates — `reltuples` is `-1`, meaning
the tables have never been analyzed).

| Table | Rows | Total size |
|---|---:|---|
| **`evidence`** | **0** | 48 kB |
| **`findings`** | **0** | 88 kB |
| **`requirements`** | **0** | 32 kB |
| `risks` | 0 | 96 kB |
| `vendors`, `controls`, `assessments`, `vendor_reviews`, `requirement_responses` | 0 | — |
| `vendor_assurance_documents`, `vendor_assurance_extractions` | 0 | — |
| `jobs` | 0 | 48 kB |
| `organizations` | **1** | 80 kB |
| `users` | **1** | 144 kB |

**Every table the 15 migrations touch is empty.** Production is a one-org,
one-user tenant database that has never carried customer workload — consistent
with the standing record of no organic production traffic since 2026-07-03.

The only substantial tables in production are **global intelligence data**, and
**no migration in this delta touches any of them**:

`cyber_signals` 55 MB · `signals` 19 MB · `trends` 13 MB · `insights` 9.6 MB ·
`email_provider_events` 5 MB · `worker_runs` 2.2 MB

### Preconditions verified

- **`app_request` role exists in production** — `to_regrole('app_request') IS NOT NULL`
  → true, and `20260618_create_app_request_role.sql` is recorded applied. This
  matters: `20260919` issues a bare `GRANT … TO app_request` with no `DO`-block
  guard, which would abort the boot migration if the role were absent. It is not.
- **Migration sequence is contiguous.** Production's most recently applied
  migration is `20260918_api_key_seat_binding.sql`; the delta begins at
  `20260919`. No gap, no overlap. Ledger: 207 applied.
- **No target column or constraint already exists** in production — the
  migrations are genuinely unapplied, not partially applied.

---

## 2. Method

Absolute timings are indicative (a local container, not Render's managed
Postgres); **lock semantics are exact** — same PostgreSQL major version.

- **Production**: PostgreSQL **18.3**
- **Harness**: PostgreSQL **18.6** in Docker, loaded from
  `pg_dump --schema-only --no-owner --no-privileges` of production — **127 tables,
  zero `COPY` statements**, so real production DDL with no customer data.
- Each measurement subtracts a measured `docker exec`+psql overhead of **309 ms**.

Running against the restored production schema — rather than a fresh test
database — is what surfaced the `app_request` dependency. The isolation suite
builds a clean database and would not have.

---

## 3. Test A — production reality today (all target tables 0 rows)

All 15 migrations, in order, against the restored production schema:

**15/15 applied cleanly. 0 failures. 2,560 ms total wall clock**, of which
~4,600 ms is process overhead across 15 invocations — i.e. **the true DDL time is
below the measurement floor.**

| Migration | wall ms |
|---|---:|
| 20260919 vendor_engagements | 143 |
| 20260920 vendor_engagements_rls | 153 |
| 20260921 vendor_tier_b_rls | 176 |
| 20260922 ask_conversations | 213 |
| 20260923 vendor_portal_access | 215 |
| 20260924 vendor_engagement_scope | 232 |
| 20260925 vendor_portal_evidence_comments | 190 |
| 20260926 requirement_scope_tags | 185 |
| 20260927 engagement_intake_and_effectiveness | 194 |
| 20260928 vendor_engagement_findings | 131 |
| 20260929 vendor_engagement_monitoring | 137 |
| 20260930 engagement_evidence_analysis | 150 |
| 20261001 org_voice_enablement | 132 |
| 20261002 ask_proposed_actions | 140 |
| 20261010 ask_async_provenance | 169 |

**Boot-blocking exposure at today's production scale: effectively zero.**

---

## 4. Test B — scaled, to answer "what if production had data"

Same restored schema, seeded to **`evidence` 250,000 rows / 102 MB**,
**`findings` 250,000 / 56 MB**, **`requirements` 100,000 / 20 MB**.

| Migration | net ms | What dominates |
|---|---:|---|
| 20260925 evidence (ALTER shared table) | **15** | CHECK validation + 3 nullable FK columns |
| **20260926 requirement_scope_tags** | **6,891** | **the heuristic backfill `UPDATE`** |
| 20260927 engagement intake | 3 | new/empty table |
| 20260928 findings (ALTER shared table) | **203** | CHECK widening + partial index |
| 20260929 monitoring | 0 | `risks` empty |
| 20260930 evidence_analysis | 0 | new table |
| 20261001 org voice | 0 | metadata-only default (PG11+) |
| 20261002 proposed actions | 0 | new table |
| 20261010 async provenance | 0 | new table |

**This overturns the audit's provisional risk ranking.** The audit flagged
`20260925` and `20260928` as HIGH because they take `ACCESS EXCLUSIVE` on shared
populated tables. Measured, they cost **15 ms** and **203 ms** at a quarter-million
rows. All five CHECK constraints were confirmed `convalidated = true`, so the
full-table scans genuinely ran — they are simply cheap.

The real cost is **`20260926`**, which the audit rated only Medium. It is a single
`UPDATE requirements` (line 119) and scales linearly: **~69 µs/row → ~69 s at 1M
requirements.**

**But it takes the wrong lock to matter.** `UPDATE` holds `ROW EXCLUSIVE`, which
does **not** block `SELECT`. A 69-second backfill blocks concurrent *writers* to
`requirements`, not readers. Splitting reader-blocking from writer-blocking
exposure:

| Lock class | Blocks | Measured worst case at 250k |
|---|---|---|
| `ACCESS EXCLUSIVE` (ALTER/CREATE INDEX) | **everything, including SELECT** | **~220 ms total** |
| `ROW EXCLUSIVE` (the 20260926 backfill) | writers only | 6.9 s |

---

## 5. The actual risk is the lock *wait*, not the lock *hold* — demonstrated

DDL duration was never the danger. The danger is that `ALTER TABLE` must first
**acquire** `ACCESS EXCLUSIVE`, and while it waits, every later query on that
table queues behind it. With **no `lock_timeout`, that wait is unbounded.**

Demonstrated on the harness:

| Scenario | Result |
|---|---|
| Long read in flight on `findings`; `ALTER` arrives (**as shipped — no timeout**); ordinary `SELECT` arrives after | **The `SELECT` blocked 7,989 ms** — for a 203 ms ALTER |
| Identical scenario with `SET lock_timeout='2s'` on the DDL session | ALTER **fails fast at 2,116 ms**; the next reader **unblocked in 123 ms** |

Confirmed: **`scripts/runMigrations.ts` sets neither `lock_timeout` nor
`statement_timeout`.** Migrations run inside the engine's
`startCommand: npm run migrate && npm start`, so this executes while the previous
instance is still serving.

**A 203 ms migration can therefore cause an unbounded read outage** on a busy
table — determined entirely by the longest in-flight query, not by the migration.
At production's current scale (no traffic, no rows) there is nothing to queue
behind, which is why today's exposure is nil.

---

## 6. Rollback implications

Unchanged by measurement, and cheap at this scale because the tables are empty:

- 12 of 15 are plain `DROP TABLE` / `DROP COLUMN` reversals.
- `20260924`, `20260925`, `20260928` **must drop constraints before columns**, or
  the rollback itself errors.
- `20260926` is the only one that is not cleanly reversible in principle: the
  backfill's pre-existing values are not retained. **At production's actual scale
  this is moot — it would backfill 0 rows.** It remains idempotent and never
  overwrites rows marked `curated`; heuristic tags stay distinguishable via
  `scope_tags_source`.
- Re-narrowing the widened CHECKs on `evidence`, `findings` and `jobs` requires
  confirming no surviving rows carry the new enum values first.

---

## 7. BL-1 ruling: **GO**

BL-1 asked for the exposure to be quantified. It is:

**Worst-case reader-blocking exposure at promotion, today: ~220 ms of
`ACCESS EXCLUSIVE` across all 15 migrations, against tables holding zero rows,
with no concurrent traffic to queue behind. Total boot-blocking migration time
measured at 2.56 s including process overhead.**

No maintenance window is required. No production-sized restore rehearsal is
required, because production *is* the small case — the restore test was run
anyway and passed 15/15.

### The condition, and when it expires

**This ruling is valid only while production remains empty.** It is a
point-in-time measurement, not a property of the migrations. If promotion slips
past the first real customer data load — particularly a framework import that
populates `requirements` — re-measure before promoting. The 20260926 backfill
scales linearly and the lock-queue exposure scales with traffic, not row count.

### Recommended hardening — not a BL-1 blocker

> **IMPLEMENTED 2026-08-15 at `b363e144`**, as its own commit exactly as this
> section required. Defaults `lock_timeout=5s` / `statement_timeout=300s`, with
> 22 unit + 6 real-Postgres regression tests. Evidence:
> `docs/validation/migration-timeout-hardening.md`.

Set `lock_timeout` (2–5 s) and a `statement_timeout` in `scripts/runMigrations.ts`.
Measured benefit: converts an unbounded read stall into a fast, retryable deploy
failure — 7,989 ms of blocked reads became 123 ms. The trade is that a contended
migration fails the deploy rather than stalling production, which for a
boot-blocking migration is the better failure. This is cheap to do now while the
consequence is theoretical, and expensive to retrofit after production carries
load. It should be its own change, not smuggled into the promotion.

### What BL-1 does **not** clear

BL-2 (staging walkthrough unexecuted), BL-3 (CI unverified on the promotion SHA)
and BL-4 (Vendor Assurance navigation decision) are untouched by this work and
remain open. The promotion verdict stays **NO-GO** on those three.
