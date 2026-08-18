/**
 * schedulerRunner.ts — node-cron wrapper for the Intelligence Brief scheduler.
 *
 * Schedules briefScheduler.runScheduler() to run once a week on Tuesday at
 * 7:00 AM UTC. The Brief is the single customer email; the per-finding Daily
 * Digest is disabled (see digestScheduler / dailyDigestFeatureFlag). The brief
 * covers a trailing 7-day window (briefScheduler WINDOW_DAYS = 7), so weekly
 * editions tile the calendar — each edition is a fresh rolling-7-day view.
 *
 * Generation AND email send run weekly on Tuesday; every other day is excluded
 * at the cron level (one run per week = minimal LLM spend). briefScheduler
 * additionally guards the email SEND with isBriefSendDay() as defense-in-depth,
 * so manual runs (POST /api/admin/briefs/run-scheduler) never email on a
 * non-send day either.
 *
 * OVERLAP PREVENTION
 * ------------------
 * A boolean lock (isRunning) prevents concurrent runs. If the cron fires while
 * a previous run is still in progress, the new trigger is skipped and logged.
 * This is safe for single-process deployments (Render, Fly, etc.).
 *
 * STARTUP
 * -------
 * Call startScheduler() once during server boot, after connectDatabase().
 * The cron job does not run immediately on startup — the first execution
 * is the next Tuesday 7:00 AM UTC after startup.
 *
 * TIMEZONE
 * --------
 * node-cron's timezone option is used to ensure the 7AM trigger fires at
 * 7:00 AM UTC regardless of the server's local timezone.
 *
 * CRON EXPRESSION
 * ---------------
 *   "0 7 * * 2"
 *    │ │ │ │ └── day-of-week: 2 (Tuesday)
 *    │ │ │ └──── month: * (every month)
 *    │ │ └────── day-of-month: * (every day)
 *    │ └──────── hour: 7
 *    └────────── minute: 0
 */

import { schedule } from "node-cron";
import { logger } from "../infra/logger.js";
import { runScheduler, type SchedulerRunSummary } from "./briefScheduler.js";
import { runDailyDigest } from "./digestScheduler.js";
import { runWeeklySummary } from "./summaryScheduler.js";
import { runAuthAnomalyScan } from "./authAnomaly.js";
import { runDailyPostureSnapshots } from "./postureSnapshotScheduler.js";
import { runDailySlaBreachSweep } from "./slaBreachScheduler.js";
import { runBriefStalenessCheck } from "./briefStalenessMonitor.js";

/**
 * Outcome of a guarded trigger.
 *
 * `ran: false` means the lock refused this trigger — the caller must NOT treat
 * that as a completed run. `ran: true` with `summary: null` means the run
 * started and threw; the error is reported rather than swallowed so the manual
 * trigger can answer honestly instead of returning a fake success.
 */
export type GuardedRunResult =
  | { ran: true; summary: SchedulerRunSummary }
  | { ran: true; summary: null; error: string }
  | { ran: false; reason: "overlap" };

/** True while a scheduler run is actively in progress. Prevents overlapping runs. */
let isRunning = false;

/** True while an auth-anomaly scan is in progress. Prevents overlapping runs. */
let isScanningAuthAnomalies = false;

/**
 * Run the Brief scheduler under the shared overlap lock.
 *
 * Both the weekly cron and the boot-time Tuesday catch-up (briefCatchup) go
 * through here, so the `isRunning` guard serializes them: a catch-up firing at
 * boot while the cron is mid-run (or vice-versa) is skipped, not run twice.
 *
 * Never throws — a scheduler error is logged and swallowed so it cannot crash
 * the cron tick or the boot sequence. Exported for briefCatchup.
 */
export async function runSchedulerGuarded(
  trigger: "cron" | "catchup" | "manual"
): Promise<GuardedRunResult> {
  if (isRunning) {
    logger.warn(
      { event: "scheduler_overlap_skipped", trigger },
      "Brief scheduler: previous run still in progress — skipping this trigger"
    );
    return { ran: false, reason: "overlap" };
  }

  isRunning = true;
  const startedAt = Date.now();

  logger.info(
    { event: "scheduler_cron_fired", trigger, firedAt: new Date().toISOString() },
    "Brief scheduler triggered"
  );

  try {
    const summary = await runScheduler();
    const durationMs = Date.now() - startedAt;

    logger.info(
      {
        event: "scheduler_cron_complete",
        trigger,
        durationMs,
        ...summary
      },
      "Brief scheduler run completed"
    );
    return { ran: true, summary };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logger.error(
      { event: "scheduler_cron_error", trigger, durationMs, err },
      "Brief scheduler threw an unexpected error"
    );
    return { ran: true, summary: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    isRunning = false;
  }
}

/**
 * Register the weekly cron job.
 *
 * Safe to call multiple times — node-cron deduplicates by the task handle,
 * but callers should call this only once (from server.ts boot).
 */
export function startScheduler(): void {
  schedule(
    "0 7 * * 2",
    () => runSchedulerGuarded("cron"),
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "0 7 * * 2 (UTC)", description: "Every Tuesday 7:00 AM UTC" },
    "Intelligence Brief scheduler registered"
  );

  // Daily posture snapshot — 7:30 AM UTC, BEFORE the 8:00 digest and the
  // Monday 9:00 weekly summary, so both read a fresh score. Idempotent
  // ((org, snapshot_date) upsert): a signal-driven snapshot earlier the same
  // day is refreshed, never duplicated. Continuous posture history is the
  // platform promise this cron keeps for quiet orgs.
  schedule(
    "30 7 * * *",
    async () => {
      try {
        await runDailyPostureSnapshots();
      } catch (err) {
        logger.error({ event: "daily_posture_snapshot_cron_error", err }, "Daily posture snapshot cron threw an unexpected error");
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "30 7 * * * (UTC)", description: "Daily posture snapshot 7:30 AM UTC" },
    "Daily posture snapshot scheduler registered"
  );

  // Daily digest — 8:00 AM UTC every day
  schedule(
    "0 8 * * *",
    async () => {
      try {
        await runDailyDigest();
      } catch (err) {
        logger.error({ event: "daily_digest_cron_error", err }, "Daily digest cron threw an unexpected error");
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "0 8 * * * (UTC)", description: "Daily digest 8:00 AM UTC" },
    "Daily digest scheduler registered"
  );

  // Daily SLA-breach sweep — 8:15 AM UTC (EG2 slice 11): one grouped email
  // per owner for work that BECAME overdue yesterday. Self-gating (dark
  // behind SECURELOGIC_SLA_ALERTS_ENABLED → zero-DB no-op while off).
  schedule(
    "15 8 * * *",
    async () => {
      try {
        await runDailySlaBreachSweep();
      } catch (err) {
        logger.error({ event: "sla_breach_cron_error", err }, "SLA-breach sweep cron threw an unexpected error");
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "15 8 * * * (UTC)", description: "Daily SLA-breach sweep 8:15 AM UTC" },
    "SLA-breach sweep scheduler registered"
  );

  // Daily Brief-staleness sweep — 8:30 AM UTC. Outcome-based observability
  // for the weekly Brief (ADR-0007): detects active orgs whose newest
  // published brief is missing or >8 days old — including the case where the
  // Tuesday cron never fired at all, which no per-run health check can see.
  // Operator-webhook alert only; no customer email; no flag (observability).
  schedule(
    "30 8 * * *",
    async () => {
      try {
        await runBriefStalenessCheck();
      } catch (err) {
        logger.error({ event: "brief_staleness_cron_error", err }, "Brief-staleness sweep cron threw an unexpected error");
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "30 8 * * * (UTC)", description: "Daily Brief-staleness sweep 8:30 AM UTC" },
    "Brief-staleness sweep scheduler registered"
  );

  // Weekly posture summary — 9:00 AM UTC every Monday
  schedule(
    "0 9 * * 1",
    async () => {
      try {
        await runWeeklySummary();
      } catch (err) {
        logger.error({ event: "weekly_summary_cron_error", err }, "Weekly summary cron threw an unexpected error");
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "0 9 * * 1 (UTC)", description: "Weekly summary Monday 9:00 AM UTC" },
    "Weekly summary scheduler registered"
  );

  // Auth-anomaly scan — every 5 minutes (A04-G4/A09-G2). Scans
  // security_audit_log for credential-stuffing / API-key-probing patterns.
  schedule(
    "*/5 * * * *",
    async () => {
      if (isScanningAuthAnomalies) {
        logger.warn(
          { event: "auth_anomaly_scan_overlap_skipped" },
          "Auth-anomaly scan: previous run still in progress — skipping this trigger"
        );
        return;
      }

      isScanningAuthAnomalies = true;
      const startedAt = Date.now();

      try {
        const summary = await runAuthAnomalyScan();
        logger.info(
          { event: "auth_anomaly_scan_complete", durationMs: Date.now() - startedAt, ...summary },
          "Auth-anomaly scan completed"
        );
      } catch (err) {
        logger.error(
          { event: "auth_anomaly_scan_error", durationMs: Date.now() - startedAt, err },
          "Auth-anomaly scan threw an unexpected error"
        );
      } finally {
        isScanningAuthAnomalies = false;
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "*/5 * * * * (UTC)", description: "Auth-anomaly scan every 5 min" },
    "Auth-anomaly scanner registered"
  );
}
