/**
 * webhookRetryWorker.ts — the retry half of the webhook delivery contract.
 *
 * The dispatcher has always SCHEDULED retries — a failed delivery gets
 * status='retrying' and a next_retry_at (1 min, then 5 min; terminal 'failed'
 * after 3 attempts) — but nothing ever picked those rows back up. A consumer
 * endpoint down for thirty seconds permanently lost the event while the
 * delivery log said "retrying" forever. This worker makes the advertised
 * contract true.
 *
 * Design:
 *   - LEASE CLAIM, not status flip: claiming a due row means advancing its
 *     next_retry_at by LEASE_MINUTES (FOR UPDATE SKIP LOCKED, multi-instance
 *     safe). A worker that crashes mid-delivery leaves the row 'retrying'
 *     with a future next_retry_at — it simply becomes due again. At-least-
 *     once, bounded by scheduleRetry's existing 3-attempt terminal rule.
 *   - BOUNDED REDELIVERY WINDOW: rows older than RETRY_WINDOW_HOURS are
 *     terminally failed (error 'retry_window_expired') instead of delivered.
 *     Without this, the first deploy of this worker would replay every
 *     delivery stranded since the surface shipped — days-old events arriving
 *     out of nowhere is worse for a consumer than an honest failure mark.
 *   - Endpoint state respected: rows whose endpoint is gone or no longer
 *     active are terminally failed ('endpoint_inactive'), so a disabled
 *     endpoint can never be posted to again.
 *   - Delivery itself is attemptWebhookDelivery — the SAME code path as the
 *     first attempt (SSRF re-validation + IP pinning, timeout, redirect
 *     blocking, success/retry bookkeeping). Retries sign with the endpoint's
 *     CURRENT secret, matching the rotation contract.
 *
 * All DB access via pgElevated (the dispatcher's documented owner-pool
 * pattern — deliveries span orgs; every query filters explicitly).
 *
 * Ops brake: SECURELOGIC_WEBHOOK_RETRY_DISABLED=true skips every tick.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { attemptWebhookDelivery } from "../lib/webhookDispatcher.js";

const INTERVAL_MS = 60 * 1000; // retry delays are 1 and 5 minutes
const BATCH_SIZE = 50;
const LEASE_MINUTES = 10;
const RETRY_WINDOW_HOURS = 24;

export function webhookRetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_WEBHOOK_RETRY_DISABLED"] === "true";
}

interface ClaimedDelivery {
  id: string;
  webhook_endpoint_id: string;
  organization_id: string;
  payload: unknown;
}

export async function runWebhookRetrySweep(): Promise<{
  claimed: number;
  delivered: number;
  expired: number;
  endpoint_inactive: number;
}> {
  if (webhookRetryDisabled()) {
    return { claimed: 0, delivered: 0, expired: 0, endpoint_inactive: 0 };
  }

  // Terminal-fail rows past the redelivery window BEFORE claiming, so the
  // claim below can never resurrect a stale event.
  const expiredResult = await pgElevated.query(
    `UPDATE webhook_deliveries
        SET status = 'failed',
            error_message = 'retry_window_expired'
      WHERE status = 'retrying'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= NOW()
        AND created_at < NOW() - ($1 * INTERVAL '1 hour')`,
    [RETRY_WINDOW_HOURS]
  );

  // Lease-claim the due batch: advancing next_retry_at IS the claim.
  const claimedResult = await pgElevated.query<ClaimedDelivery>(
    `UPDATE webhook_deliveries d
        SET next_retry_at = NOW() + ($2 * INTERVAL '1 minute')
      WHERE d.id IN (
        SELECT id FROM webhook_deliveries
         WHERE status = 'retrying'
           AND next_retry_at IS NOT NULL
           AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING d.id, d.webhook_endpoint_id, d.organization_id, d.payload`,
    [BATCH_SIZE, LEASE_MINUTES]
  );

  let delivered = 0;
  let endpointInactive = 0;

  for (const row of claimedResult.rows) {
    try {
      const endpointResult = await pgElevated.query<{
        id: string;
        url: string;
        secret: string;
        status: string;
      }>(
        `SELECT id, url, secret, status
           FROM webhook_endpoints
          WHERE id = $1 AND organization_id = $2`,
        [row.webhook_endpoint_id, row.organization_id]
      );
      const endpoint = endpointResult.rows[0];

      if (!endpoint || endpoint.status !== "active") {
        await pgElevated.query(
          `UPDATE webhook_deliveries
              SET status = 'failed', error_message = 'endpoint_inactive'
            WHERE id = $1`,
          [row.id]
        );
        endpointInactive += 1;
        continue;
      }

      // jsonb round-trips as an object; the signed body is this exact
      // serialization, so signature and body always agree.
      const payload =
        typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);

      const result = await attemptWebhookDelivery(row.id, endpoint, payload);
      if (result.status === "delivered") delivered += 1;
    } catch (err) {
      // One delivery's unexpected failure must not stop the batch; the lease
      // makes the row due again after LEASE_MINUTES.
      logger.error(
        { event: "webhook_retry_attempt_failed", deliveryId: row.id, err },
        "Webhook retry attempt failed unexpectedly"
      );
    }
  }

  const claimed = claimedResult.rowCount ?? 0;
  const expired = expiredResult.rowCount ?? 0;
  if (claimed > 0 || expired > 0) {
    logger.info(
      {
        event: "webhook_retry_sweep_complete",
        claimed,
        delivered,
        expired,
        endpoint_inactive: endpointInactive,
      },
      "Webhook retry sweep complete"
    );
  }

  return { claimed, delivered, expired, endpoint_inactive: endpointInactive };
}

export function startWebhookRetryWorker(): void {
  if (webhookRetryDisabled()) {
    logger.info(
      { event: "webhook_retry_worker_disabled" },
      "Webhook retry worker: SECURELOGIC_WEBHOOK_RETRY_DISABLED — not starting"
    );
    return;
  }

  const tick = (): void => {
    runWebhookRetrySweep().catch((err) =>
      logger.error(
        { event: "webhook_retry_sweep_failed", err },
        "Webhook retry sweep failed"
      )
    );
  };

  setInterval(tick, INTERVAL_MS).unref();
  logger.info(
    { event: "webhook_retry_worker_started", intervalMs: INTERVAL_MS },
    "Webhook retry worker started"
  );
}
