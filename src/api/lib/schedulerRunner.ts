/**
 * schedulerRunner.ts — node-cron wrapper for the Intelligence Brief scheduler.
 *
 * Schedules briefScheduler.runScheduler() to run weekly on Mondays at 7:00 AM
 * UTC. The Brief is the single weekly customer email; the per-finding Daily
 * Digest is disabled (see digestScheduler / dailyDigestFeatureFlag). The brief
 * already covers a trailing 7-day window (briefScheduler WINDOW_DAYS = 7), so a
 * weekly cadence yields non-overlapping weekly editions.
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
 * is the next Monday 7:00 AM UTC after startup.
 *
 * TIMEZONE
 * --------
 * node-cron's timezone option is used to ensure the 7AM trigger fires at
 * 7:00 AM UTC regardless of the server's local timezone.
 *
 * CRON EXPRESSION
 * ---------------
 *   "0 7 * * 1"
 *    │ │ │ │ └── day-of-week: 1 (Monday)
 *    │ │ │ └──── month: * (every month)
 *    │ │ └────── day-of-month: * (every day)
 *    │ └──────── hour: 7
 *    └────────── minute: 0
 */

import { schedule } from "node-cron";
import { logger } from "../infra/logger.js";
import { runScheduler } from "./briefScheduler.js";
import { runDailyDigest } from "./digestScheduler.js";
import { runWeeklySummary } from "./summaryScheduler.js";
import { runAuthAnomalyScan } from "./authAnomaly.js";

/** True while a scheduler run is actively in progress. Prevents overlapping runs. */
let isRunning = false;

/** True while an auth-anomaly scan is in progress. Prevents overlapping runs. */
let isScanningAuthAnomalies = false;

/**
 * Register the daily cron job.
 *
 * Safe to call multiple times — node-cron deduplicates by the task handle,
 * but callers should call this only once (from server.ts boot).
 */
export function startScheduler(): void {
  schedule(
    "0 7 * * 1",
    async () => {
      if (isRunning) {
        logger.warn(
          { event: "scheduler_overlap_skipped" },
          "Brief scheduler: previous run still in progress — skipping this trigger"
        );
        return;
      }

      isRunning = true;
      const startedAt = Date.now();

      logger.info(
        { event: "scheduler_cron_fired", firedAt: new Date().toISOString() },
        "Brief scheduler cron fired"
      );

      try {
        const summary = await runScheduler();
        const durationMs = Date.now() - startedAt;

        logger.info(
          {
            event: "scheduler_cron_complete",
            durationMs,
            ...summary
          },
          "Brief scheduler cron completed"
        );
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        logger.error(
          { event: "scheduler_cron_error", durationMs, err },
          "Brief scheduler cron threw an unexpected error"
        );
      } finally {
        isRunning = false;
      }
    },
    { timezone: "UTC" }
  );

  logger.info(
    { event: "scheduler_registered", schedule: "0 7 * * 1 (UTC)", description: "Every Monday 7:00 AM UTC" },
    "Intelligence Brief scheduler registered"
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
