/**
 * Vendor-extraction queue-depth alerting (Pillar 1, §E step 7 / §F.4).
 *
 * §F.4 settled "no hard per-org cap; add queue-depth alerting instead" — so a
 * backlog or runaway in the durable `vendor_assurance_extract` queue is visible
 * to operators without throttling legitimate use. The single serial worker
 * (§F.3) caps throughput, so a deep queue means work is piling up faster than it
 * drains; this surfaces that as one operator alert.
 *
 * Hosted in the intelligence-worker scheduler (it already carries
 * ALERT_WEBHOOK_URL and runs in virginia, in-region with the prod DB). Routes
 * through the shared sendSecurityAlert channel — inert until ALERT_WEBHOOK_URL
 * is configured (sendSecurityAlert no-ops).
 *
 * DEDUPE — rising-edge with re-arm on clear (NOT providerQuotaAlert's
 * once-per-process boolean, which would alert once and stay silent for days on a
 * persistent backlog). One alert when the depth first crosses the threshold; the
 * flag re-arms only once the backlog clears (< threshold), so a fresh spike
 * re-alerts. "Loud once per backlog episode, not noisy."
 */
import { pgElevated } from "../infra/postgres.js";
import { sendSecurityAlert } from "../infra/alerting.js";
import { logger } from "../infra/logger.js";

/**
 * Backlog size (queued + processing `vendor_assurance_extract` jobs) at which an
 * operator alert fires. Starting soak value; a single serial worker doing
 * multi-second Claude extractions means ~30 backlogged ≈ tens of minutes of
 * work. Tune here (or promote to an env var) once soak data lands.
 */
export const VENDOR_QUEUE_BACKLOG_THRESHOLD = 30;

// Rising-edge dedupe state. true once an alert has fired for the current backlog
// episode; reset to false when depth falls back below the threshold so the next
// crossing re-alerts. Resets on deploy/restart (a fresh process re-arms).
let alertedWhileBacklogged = false;

/**
 * Count queued + processing vendor-extraction jobs across all orgs. Platform-wide
 * operational metric, so it runs on the elevated (non-tenant) channel — same
 * pattern as the kevPoller active-orgs fan-out. `::int` so node-postgres parses
 * COUNT as a JS number, not a string.
 */
async function fetchVendorQueueDepth(): Promise<number> {
  const result = await pgElevated.query<{ depth: number }>(
    `SELECT COUNT(*)::int AS depth
       FROM jobs
      WHERE job_type = 'vendor_assurance_extract'
        AND status IN ('queued', 'processing')`,
  );
  return result.rows[0]?.depth ?? 0;
}

/**
 * One queue-depth check tick. Fires a single sendSecurityAlert on the rising edge
 * (depth crosses the threshold), re-arms when the backlog clears. Best-effort —
 * any failure (DB or webhook) is logged and swallowed so the scheduler interval
 * keeps ticking; a depth probe must never crash the worker.
 *
 * `fetchDepth` is an injectable seam for tests; production uses the real query.
 */
export async function checkVendorQueueDepth(
  opts: { fetchDepth?: () => Promise<number> } = {},
): Promise<void> {
  const fetchDepth = opts.fetchDepth ?? fetchVendorQueueDepth;

  let depth: number;
  try {
    depth = await fetchDepth();
  } catch (err) {
    logger.error(
      { event: "vendor_queue_depth_check_failed", err },
      "Vendor queue-depth check failed; skipping this tick",
    );
    return;
  }

  if (depth < VENDOR_QUEUE_BACKLOG_THRESHOLD) {
    // Backlog clear (or never crossed) — re-arm so the next crossing alerts.
    alertedWhileBacklogged = false;
    return;
  }

  if (alertedWhileBacklogged) return; // already alerted for this episode
  alertedWhileBacklogged = true;

  logger.warn(
    { event: "vendor_queue_backlog", depth, threshold: VENDOR_QUEUE_BACKLOG_THRESHOLD },
    "Vendor-extraction queue depth crossed alert threshold",
  );

  try {
    await sendSecurityAlert({
      kind: "vendor_queue_backlog",
      summary: `Vendor-extraction queue backlog: ${depth} jobs queued/processing (threshold ${VENDOR_QUEUE_BACKLOG_THRESHOLD})`,
      detail: {
        depth,
        threshold: VENDOR_QUEUE_BACKLOG_THRESHOLD,
        job_type: "vendor_assurance_extract",
      },
    });
  } catch (alertErr) {
    logger.error(
      { event: "vendor_queue_backlog_alert_send_failed", alertErr },
      "Vendor queue-depth alert send failed",
    );
  }
}

/** Test-only: reset the rising-edge dedupe flag. Do not call in production code. */
export function resetVendorQueueDepthAlertStateForTest(): void {
  alertedWhileBacklogged = false;
}
