/**
 * feedHealth.ts — per-source ingestion health tracking.
 *
 * The dead RSS feeds (nydfs/enisa/ico/darkreading/theregister) rotted silently
 * for a day because nothing recorded that a source had stopped returning data.
 * This records every fetch attempt to the feed_health table (one row per source)
 * and fires ONE operator alert on the rising edge when a source has failed
 * FEED_FAILURE_ALERT_THRESHOLD consecutive runs.
 *
 * Design rules:
 *   - Health recording must NEVER break ingestion: both helpers swallow their
 *     own errors (a health-write failure is logged, not thrown).
 *   - Global (not org-scoped): a source is shared across orgs. Uses pgElevated.
 *   - The alert routes through the shared sendSecurityAlert channel — inert
 *     until ALERT_WEBHOOK_URL is configured.
 *   - "Rising edge": alert fires only on the run where consecutive_failures
 *     first REACHES the threshold, not on every subsequent failure (no spam).
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendSecurityAlert } from "../infra/alerting.js";

/** Consecutive failed runs before an operator alert fires (on the rising edge). */
export const FEED_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Record a successful fetch: resets the failure counter and stores the item
 * count. Never throws.
 */
export async function recordFeedSuccess(
  source: string,
  itemCount: number
): Promise<void> {
  try {
    await pgElevated.query(
      `
      INSERT INTO feed_health (source, last_attempt_at, last_success_at, last_item_count, consecutive_failures, last_error, updated_at)
      VALUES ($1, NOW(), NOW(), $2, 0, NULL, NOW())
      ON CONFLICT (source) DO UPDATE SET
        last_attempt_at      = NOW(),
        last_success_at      = NOW(),
        last_item_count      = EXCLUDED.last_item_count,
        consecutive_failures = 0,
        last_error           = NULL,
        updated_at           = NOW()
      `,
      [source, itemCount]
    );
  } catch (err) {
    logger.warn({ event: "feed_health_record_failed", source, err }, "feed_health success write failed (non-fatal)");
  }
}

/**
 * Record a failed fetch: increments the consecutive-failure counter and stores
 * the error. Fires a single operator alert on the run that first reaches
 * FEED_FAILURE_ALERT_THRESHOLD. Never throws.
 */
export async function recordFeedFailure(
  source: string,
  error: string
): Promise<void> {
  try {
    const result = await pgElevated.query<{ consecutive_failures: number }>(
      `
      INSERT INTO feed_health (source, last_attempt_at, last_success_at, last_item_count, consecutive_failures, last_error, updated_at)
      VALUES ($1, NOW(), NULL, NULL, 1, $2, NOW())
      ON CONFLICT (source) DO UPDATE SET
        last_attempt_at      = NOW(),
        consecutive_failures = feed_health.consecutive_failures + 1,
        last_error           = $2,
        updated_at           = NOW()
      RETURNING consecutive_failures
      `,
      [source, error.slice(0, 1000)]
    );

    const failures = result.rows[0]?.consecutive_failures ?? 0;

    // Rising edge only: alert on the run that first REACHES the threshold.
    if (failures === FEED_FAILURE_ALERT_THRESHOLD) {
      await sendSecurityAlert({
        kind: "feed_source_down",
        summary: `Ingestion source "${source}" has failed ${failures} consecutive runs`,
        detail: { source, consecutive_failures: failures, last_error: error.slice(0, 300) }
      });
    }
  } catch (err) {
    logger.warn({ event: "feed_health_record_failed", source, err }, "feed_health failure write failed (non-fatal)");
  }
}
