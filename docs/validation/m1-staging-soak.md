# M-1 staging soak — activation record and 48-hour observation log

**Status: M-1 — STAGING FUNCTIONALLY VALIDATED / EXTENDED SOAK IN PROGRESS**
(recorded 2026-08-17T21:08Z after the complete post-M1-G2 validation rerun below).
This document is the activation-configuration record required by the operator;
the observation log and final soak verdict are appended as the soak progresses.
Committed at soak sign-off.

## Soak clock (RESTARTED from the known-good configuration)

- **Start:** 2026-08-17T21:08:22Z — a FRESH clock. The earlier observation
  period (20:20–20:38Z, stopped by the M1-G2 defect) is explicitly NOT
  counted toward this soak.
- **End (48 h):** 2026-08-19T21:08:22Z
- **Code under soak:** develop @ `2e7c57c4` (M1-G2 included).
- **Final soak verdict:** pending — only after the 48 h + post-soak
  `m1-preflight.sql` (`m1.expect_flipped=1`) + `m1-proof.ts` rerun.

## Post-M1-G2 complete validation rerun (2026-08-17 20:55–21:08Z) — ALL PASS

1. **Export E2E under `app_request`:** enqueue (asTenant) → claim (elevated)
   → execute across the full category table set incl. `sso_login_codes`
   (withTenant/RLS) → terminal write: **`succeeded attempts=1` in ≤15 s**.
2. **Full preflight, `m1.expect_flipped=1`: PASS G1–G9** — including G9's
   flipped-state service check, now reachable past the fixed G5.
3. **Proof battery vs staging: 29/29 PASS** (real `app_request` login).
4. Tenant workflows: finding create → patch → value-checked read →
   lifecycle-close; findings CSV export (798 rows); audit-log 50 events;
   `/posture/latest` real data.
5. Approved admin/elevated paths: `/admin/organizations` (5 orgs),
   `/admin/ops/health` ok.
6. Cross-org isolation: DB-level re-proven live (proof section C);
   HTTP-level by the CI cross-org harness.
7. Worker cycles + background jobs: all five services swept — **zero 42501,
   zero permission failures, zero tick errors**; every strict-tenant warning
   attributed to a legitimate system path (engine pre-context set; data-rights
   boot probe; intelligence `withAdvisoryLock` — advisory locks are grant- and
   tenancy-free by nature). Zero unexplained; zero silent-empty.

## Configuration under soak

- **Code:** develop @ `fc60676a` (#799…#805 inclusive; the M-1 train is
  PR #802 grants/matrix/CI/strict-log, #803 route/worker channel closures,
  #804 preflight/proof/doc-sync, #805 workerLogger elevated fix).
- **Database:** staging `securelogic_staging`
  (`dpg-d7n0pohj2pic738iidbg`, external hostname, TLS verified per P0-1).
- **Runtime identity:** `DATABASE_URL` = `app_request` (48-hex password,
  held in the staging DB + Render env store only) on ALL FIVE services:
  engine, posture-worker, data-rights-worker, vendor-extraction-worker,
  intelligence-worker (staging).
- **Owner channel:** `MIGRATION_DATABASE_URL` = `securelogicstagingdb_9w6v_user`
  (login member) on all five — intel-worker's former direct-owner login
  (`securelogic_staging_user`) retired per ruling D-4.
- **Instrumentation:** `SECURELOGIC_DB_STRICT_TENANT_LOG=true` on all five.
- **Untouched:** production, demo, Stage 2, E-2 Increment 4, TDG.

## Activation evidence (pre-soak, 2026-08-17 19:38–20:20Z)

1. Preflight (owner channel): **PASS G1–G9, exit 0** (run before any change).
2. Proof battery vs staging (real `app_request` login + owner DSN,
   `M1_PROOF_SEED=true`): **29/29 PASS** (before any service flip).
3. Engine flip: migrations on the owner channel, boot self-test, `/health`
   `db:connected`, `app_request` in `pg_stat_activity`; walkthrough-org smoke
   (findings page 25 of 614 — truthfulness cross-checked on the owner channel;
   vendors 2; risks 0 verified-truthful; `/posture/latest` real data); zero
   42501; strict-mode warnings exclusively known-legitimate pre-context
   callers (requireApiKey, attachOrganizationContext, /health, boot probes).
4. posture-worker: full cycle, 13 orgs → **13 snapshots created** (the §4a
   silent-failure mode demonstrably absent). data-rights: clean start+ticks.
   vendor-extraction: ~8 silent healthy tick cycles.
5. **Stop condition (resolved):** intelligence worker failed scheduler
   startup with 42501 on `worker_runs` — `infra/workerLogger.ts` wrote Tier-D
   telemetry via ambient pg from the runner (outside the C-1 scan boundary).
   Rolled back per procedure (service-only), fixed as **PR #805**
   (3 sites → `pgElevated` + source-pinned regression test), re-flipped after
   the fix deployed. Post-re-flip: **zero** permission errors; full
   scheduler → pipeline (130 matcher runs) → complete cycle; **two
   `worker_runs` "success" rows written through the elevated path** (the only
   path that can write that table).
6. `feed_fetch_failed` (3×/cycle): **confirmed pre-existing** — 8 occurrences
   in the 14:30–18:00Z pre-activation window (e.g. `regulatory_nydfs`
   upstream HTTP 404). External-feed class, not an M-1 regression.
   `worker_env_missing: NEWSLETTER_FROM_EMAIL` likewise pre-existing optional
   config on the staging worker.

## Soak acceptance (operator-approved)

Runtime behavior, not deploy status: engine DB paths, worker claim/poll
cycles, background jobs, admin functions, tenant isolation (cross-org
harness), and **zero unexplained** 42501 / `db_query_outside_tenant_scope` /
silent-empty / cross-org anomalies. Warnings are triaged, never normalized or
suppressed to pass. Any new privilege or silent-empty defect stops the clock,
isolates/rolls back the affected service only, and is reported.

## Observation log

| UTC | Check | Result |
|---|---|---|
| 2026-08-17T20:20Z | Soak start — all five services clean on `app_request`; four had accumulated ~35 min clean runtime pre-clock | baseline |
| 2026-08-17T20:38Z | **SOAK CLOCK STOPPED** (operator stop rule) — accelerated functional validation surfaced a REAL M-1 defect: GDPR self-export job failed `42501 permission denied for table sso_login_codes`. The exporter derives its table set dynamically from `dataClassification` and reads every category-B table on the TENANT channel; `sso_login_codes` (category B) was Tier-D no-grant, classified from its pre-auth WRITE path only. Loud fail-closed (job retried, never silent). Bounding: the ONLY no-grant table in an export category; the exporter is its only tenant-channel consumer (reaper/retention do not iterate the classification). | STOP — defect M1-G2 |
| 2026-08-17T20:44Z | Isolation per stop rule: data-rights worker ONLY rolled back to the owner channel (live); other four services untouched and clean. Fix built: `20261022_m1_g2_sso_login_codes_export_read.sql` (SELECT only; pre-auth write path stays elevated) + Tier-D bookkeeping updated in C-3 / preflight G5 / matrix. Fresh-DB proof: migration applies, preflight PASS, `has_table_privilege('app_request','sso_login_codes','SELECT') = t`. | fix pending merge |
| 2026-08-18T~11:30Z | **Mid-soak sweep (~14.5 h elapsed), all five services, full window since 21:08:22Z:** zero `42501`, zero `permission denied`, zero error-level events on any worker; data-rights (the re-flipped service) fully clean at warn+ level; posture-worker writing snapshots normally (09:04Z cycle observed); intelligence pipeline ingesting (KEV/NVD/FedReg/CISA/RSS cycles, `errors:0`); today's Tuesday brief run generating and publishing (LLM calls succeeding). Strict-tenant warnings: exclusively the documented `/health` pre-context caller (`routes/index.js` `SELECT 1`, counter log every ~7 min). One error-level event on the engine: daily 08:30Z `brief_staleness_detected` for Staging Inc (`fe2ede61`, newest brief 2026-08-04) — **verified pre-existing**: identical alert fired daily 08:30Z on 08-14/15/16/17, before M-1 activation. External/brief-pipeline class, not an M-1 regression; flagged for separate triage. Zero unexplained; clock continues. | clean |
| 2026-08-18T~11:45Z | Staleness triage (read-only, no staging state touched): TRUE POSITIVE, pre-existing platform defect — the 08-11 Tuesday scheduler run (sequential, ~4.5 h, in-process cron) was killed by the 11:32–11:33Z engine redeploy SIGTERM (credential-rotation-day deploys) after 9 of 12 orgs; `fe2ede61` sorts last in the ORDER-BY-id loop and never generated. No retry exists: `briefCatchup` is dark AND its run-level predicate (any brief today ⇒ skip) cannot recover a partial run. Today's 08-18 run is alive (11:39Z, org b1a3da2d, 10 briefs published) and should reach `fe2ede61` barring a restart — the soak merge-freeze protects it. Not an M-1 item; fix proposal reported to operator, unimplemented. | pre-existing, triaged |

### Accelerated functional validation (operator-directed, in progress at stop)

Passed before the stop: finding CREATE→PATCH→readback (value-checked) → lifecycle
close under `app_request` RLS; findings CSV export (explicit-withTenant streaming
path); audit-log read (50 events, admin-role session); data-export ENQUEUE
(asTenant write to `jobs`) and worker CLAIM/tick cycle (claimed within one 15s
tick — the claim/poll path itself is healthy; the failure was inside job
EXECUTION on the exporter's table set). DELETE /findings/:id 404 explained:
no hard-delete route exists by design (lifecycle close is the path).

Completed after the stop (against the 4-service flipped configuration):
admin elevated paths (GET /admin/organizations 5 orgs cross-org, /admin/ops/health,
/admin/audit-log — all healthy); the stuck export job SUCCEEDED (attempts=4) the
moment the rolled-back worker retried it — service-only rollback isolation proven
end-to-end; proof battery vs staging **29/29 PASS**; preflight (m1.expect_flipped=1)
fails EXACTLY and ONLY on G5 `sso_login_codes` — the gate naming the one open
defect (G9's flipped-mode check runs after G5 and re-verifies post-fix);
all-five sweep since 20:20Z: zero 42501/tick errors everywhere except the six
known pre-rollback export failures on data-rights; engine strict-mode warnings
exclusively the documented pre-context callers (/health, requireApiKey,
attachOrganizationContext). Cross-org isolation: DB-level enforcement re-proven
by proof section C live; HTTP-level covered by the CI cross-org harness (staging
has no second-org credential; noted, not waived).

**Interim verdict: NOT recorded as functionally validated — the validation did
its job and found M1-G2.** Path to the STAGING FUNCTIONALLY VALIDATED — EXTENDED
SOAK IN PROGRESS record: merge PR #806 → staging redeploy wave → re-flip
data-rights → export E2E under app_request succeeds → full preflight
(expect_flipped) PASS + proof PASS → soak clock RESTARTS.

---

# M-1 CLOSEOUT — FINAL RECORD

## M-1 STAGING SOAK: PASS / SIGNED OFF

**Signed off 2026-08-19T00:19:04Z. Every closeout gate was executed and passed
at closeout; none was inferred from earlier evidence.**

### Authoritative window — READ THIS BEFORE CITING THIS RECORD

| | |
|---|---|
| Authoritative soak start | **2026-08-17T21:08:22Z** |
| Authoritative soak end | **2026-08-19T00:19:04Z** |
| **Actual observed duration** | **27 h 10 m** |
| Planned duration | 48 h (planned end 2026-08-19T21:08:22Z) |
| Reason for early end | **Operator decision to end the soak early.** The clock did not expire. |

This sign-off rests on **27 h 10 m** of clean observation, not 48 h. Anyone
relying on this record for a production-promotion decision must weigh the
shortened window on its own terms. The gates below all passed; the observation
period is the single respect in which this soak departs from its design.

Code under soak: `develop` @ `2e7c57c4` — unchanged start to finish.

### Gate-by-gate results

| Gate | Result | Evidence |
|---|---|---|
| 1 Final sweep — permission errors | **PASS** | zero `42501` and zero `permission denied` across all five services for the full window |
| 2 Strict-tenant-scope warnings | **PASS** | all attributable to ONE caller, `dist/api/routes/index.js:168:22` (documented `/health` pre-context `SELECT 1`); verified in two independent slices (100 rows, then 53 rows in a later slice) — no second caller exists |
| 3 Engine health / app behaviour | **PASS** | engine logging normally through 00:19Z; auth-anomaly scans completing; no error-level events other than the one below |
| 4 Worker runtime health | **PASS** | intelligence-worker 27 `worker_runs` in 27 h; posture-worker cycling; data-rights + vendor-extraction proven by Gate 5 |
| 5 Worker claim/poll positive proof | **PASS** | see below — post-soak activity |
| 6 Known anomalies remain pre-existing | **PASS** | see below |
| 7 Preflight, `m1.expect_flipped=1` | **PASS** | literal artifact captured |
| 8 Proof battery | **PASS** | 29 passed / 0 failed / 0 skipped |
| 9 Runtime identity is `app_request` | **PASS** | proof section A, from inside the service using its own `DATABASE_URL` |
| 10 No silent rollback to an owner runtime DSN | **PASS** | see channel separation below |
| 11 Soak configuration uncontaminated | **PASS** | zero commits on `develop` during the window; no held branch merged; head still `2e7c57c4` |

### Anomaly classification — verified, not pattern-matched

**`brief_staleness_detected`** — ONE error-level event in the whole window
(2026-08-18T08:30:01Z, org `fe2ede61`, Staging Inc). Confirmed **pre-existing and
not an M-1 regression** by direct evidence, not resemblance: the identical alert
fired at 08:30Z on **2026-08-14, 08-15, 08-16 and 08-17 — all before M-1
activation at 2026-08-17T19:38Z**. Root cause previously triaged: the 08-11
scheduler run was killed mid-loop by a redeploy SIGTERM; `briefCatchup` is dark
and cannot recover a partial run. External/brief-pipeline class; tracked
separately.

**`feed_fetch_failed`** — remains pre-existing, unchanged in character.

### Channel separation (Gates 9 / 10)

Runtime identity proven `app_request` with `bypassrls=false`, `createrole=false`,
owning zero public relations. Elevated operations remain confined to the approved
migration channel: proof section E exercised DDL, `schema_migrations` INSERT and
cross-org reads on the migration identity ONLY, while every equivalent operation
was refused to `app_request` with `42501`.

**Owner-channel database sessions are NOT evidence of rollback** and must not be
read as such in future sweeps: `pgElevated` legitimately connects via
`MIGRATION_DATABASE_URL`, and an operator `render psql` session also appears
under the owner login. Distinguish by which identity performs which operation,
never by counting sessions.

### A methodology correction this closeout forced

Two of the five services — `data-rights-worker` and `vendor-extraction-worker` —
produced **zero log output for the entire window**. This is not a fault: both
poll every 15 s and log only when `processed > 0`, or on warn/error. The
consequence is that **a healthy idle worker and a stopped worker emit byte-identical
evidence**, so their "zero 42501" result was *vacuous*, not clean, and the earlier
mid-soak note recording data-rights as "fully clean at warn+ level" carried no
positive information. Every zero in this closeout was therefore taken only after a
positive control confirmed the query returned data at all.

---

## POST-SOAK PROOF ACTIVITY — NOT SOAK-WINDOW EVIDENCE

**Everything in this section occurred AFTER the observation window closed at
2026-08-19T00:19:04Z.** It deliberately includes authorized writes and expected
`42501` events. These must never be conflated with soak-window anomalies.

### Gate 5 — positive worker proof (writes authorized post-window)

Two benign jobs enqueued at **2026-08-19T00:21:33Z**, cloned from the last
known-good row of each type so payload shape was exact. Nothing else was enqueued.

| Job | Worker | Claimed & completed | Attempts | Error |
|---|---|---|---|---|
| `5c941445` `vendor_assurance_extract` | vendor-extraction | 00:21:40Z (7 s) | 1 | none |
| `cc9c252e` `data_export_self` | data-rights | 00:21:42Z (9 s) | 1 | none |

Worker log evidence: `vendor_extraction_job_cuec_match` →
`vendor_extraction_job_idempotent_success` → `tick_complete processed:1`; and
`data_export_completed` (scope `user_self`) → `data_rights_job_succeeded` →
`tick_complete processed:1, durationMs=4557`. **Zero `42501`, zero
`permission denied`** on either worker.

The `data_export_self` path is the exact path that produced defect M1-G2
(`42501` on `sso_login_codes`). Its clean completion under `app_request` is a
live regression proof of the M1-G2 fix.

### Gate 7 — preflight artifact (2026-08-19T00:22:59Z)

Executed in-place via a Render one-off job on the staging engine, using
`MIGRATION_DATABASE_URL` **by reference**; the DSN was never printed, copied or
persisted. `m1.expect_flipped=1` supplied via `PGOPTIONS`.

```
/usr/bin/psql
psql:scripts/validation/m1-preflight.sql:174: NOTICE:  M1 PREFLIGHT: PASS — all gates hold (G1..G9)
PREFLIGHT_EXIT=0
```

This is the script's own designed artifact. It was captured deliberately with
real `psql -f`: `render psql` in non-interactive mode **silently swallows
`RAISE NOTICE`**, so it can only ever yield inferred silence — and this script's
doctrine is that silence is never a pass.

### Gate 8 — proof battery (2026-08-19T00:23:23Z → 00:24:06Z)

Executed in-place, both identities supplied by existing environment secrets **by
reference**; neither DSN was exposed. Seeded run.

```
M1 PROOF: PASS — 29 passed, 0 failed, 0 skipped
PROOF_EXIT=0
```

`app_request` side — identity `current_user=app_request bypassrls=false
createrole=false`, owns 0 public relations; **refused with `42501`**: CREATE
TABLE, DROP TABLE, ALTER TABLE … DISABLE TRIGGER (the WORM bypass M-1 closes),
TRUNCATE, CREATE ROLE, ALTER ROLE erasure_agent LOGIN, INSERT INTO
schema_migrations, UPDATE audit_log, DELETE FROM security_audit_log, SET ROLE
erasure_agent, SELECT FROM worker_runs (Tier D); GRANT conferred nothing.
RLS enforced — unscoped SELECT returned only the GUC org's rows, no GUC returned
zero rows (fail-closed), cross-org UPDATE/DELETE affected zero rows, cross-org
INSERT refused by policy. Legitimate tenant DML succeeded (own-org
INSERT/UPDATE/DELETE, organizations read, audit_log append).

Migration identity — DDL, `schema_migrations` INSERT, elevated cross-org read
(both probe orgs), worker claim-poll shape. Probe orgs and findings cleaned up.

**The `42501` events above are deliberate proof activity from 00:23:5x–00:24:06Z,
outside the observation window.**

---

## Limitations of this sign-off

1. **Observation was 27 h 10 m, not the designed 48 h**, by operator decision.
2. Gate 5 liveness for the two silent workers rests on post-window induced jobs,
   not on organic in-window traffic — because none occurred and their logging
   design makes idle liveness unobservable.
3. HTTP-level cross-org isolation remains covered by the CI harness rather than
   live staging, as staging has no second-org credential. Noted, not waived.
