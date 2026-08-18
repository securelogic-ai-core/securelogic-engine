# Runbook — Brief scheduler and the Tuesday deployment window

**Status:** operational recommendation (secondary control).
**Primary reliability controls:** per-org idempotent scheduler rerun +
completeness-based catch-up (`fix/brief-scheduler-reconciliation`), dark behind
`SECURELOGIC_BRIEF_CATCHUP_ENABLED` until operator enablement.

## The exposure

The weekly Intelligence Brief run is an **in-process node-cron inside the
engine web service** (`schedulerRunner.ts`, `"0 7 * * 2"` — Tuesday 07:00 UTC).
It processes every active org **sequentially** and takes **multiple hours**
(observed: ~4.5 h on staging with 13 orgs; per-org time is dominated by
per-signal LLM matcher calls during ingest). Anything that restarts the engine
process during that window kills the run mid-loop:

- a deploy (push to the service's branch — `develop` auto-deploys staging,
  `main` deploys prod);
- a Render env-var change (Render restarts the service on env sync);
- a manual restart or a crash.

Orgs early in the ORDER-BY-id loop publish; the tail silently misses the
week's edition. **Observed live:** staging, 2026-08-11 — a 11:32 UTC redeploy
SIGTERM'd the run after 9 of 12 orgs; the last org (`Staging Inc`) missed two
consecutive editions and tripped the daily `brief_staleness_detected` alert.

## Recommendation (guardrail, not the fix)

**Avoid engine deploys, env-var changes, and restarts on Tuesdays between
07:00 UTC and the run's completion** (verify completion rather than assuming a
duration — see below). This applies per environment: staging deploys gate on
the staging run, prod deploys on the prod run.

This is a **recommendation, not the primary reliability control**. The primary
controls are code:

1. `runScheduler()` skips orgs that already hold this week's published brief
   (`scheduler_org_skipped_already_current`), making any rerun idempotent.
2. `runBriefCatchupIfMissed()` (boot-time, flag-gated) detects per-org
   completeness of the current weekly window and reruns the scheduler on any
   weekday until the edition is complete. Email remains Tuesday-gated
   (`isBriefSendDay` inside `runScheduler`) — a Wednesday+ catch-up generates
   in-platform briefs and sends nothing.

With the flag ON, an interrupted Tuesday run self-heals on the next boot. The
deploy-window guardrail then only avoids *delay* (a mid-run deploy still wastes
the partial run's wall-clock and defers the tail to the post-deploy boot).

## How to verify the run completed

- Log event `scheduler_run_complete` (and `scheduler_cron_complete` with
  `durationMs`) on the engine service — absence by late Tuesday UTC means the
  run died or never fired.
- Per-org: `scheduler_brief_generated` (one per org) vs `scheduler_orgs_found`
  `count`; reruns log `scheduler_org_skipped_already_current` for completed
  orgs.
- Outcome-level backstop: the daily 08:30 UTC `brief_staleness_detected` sweep
  (`briefStalenessMonitor.ts`) alerts on any active org whose newest published
  brief is older than 8 days. Note it excludes orgs younger than 8 days, so a
  recently created org that missed a run will not alarm until it ages in.

## How to recover a missed/partial run (manual, until the flag is enabled)

`POST /api/admin/briefs/run-scheduler` (admin, manual trigger) — safe to run
any day: the per-org skip regenerates only missing orgs, and the send gate
means a non-Tuesday manual run emails nothing. Prefer running it the same
Tuesday if email delivery for the missed orgs matters that week.

## Related

- `docs/manual-brief-generation.md` — manual generation paths.
- `briefCatchup.ts` / `briefCatchupFeatureFlag.ts` — recovery design and flag
  governance (operator-owned; enable only after staging validation).
- 2026-08-18 triage: `docs/validation/m1-staging-soak.md` observation log
  (staleness incident classified pre-existing, not an M-1 regression).
