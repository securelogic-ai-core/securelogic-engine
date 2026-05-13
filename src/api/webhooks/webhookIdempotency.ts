import crypto from "node:crypto";

import { pg } from "../infra/postgres.js";

export type WebhookProvider = "stripe" | "lemon";

export interface ClaimResult {
  firstSeen: boolean;
}

/**
 * Idempotency gate for inbound provider webhooks (C3).
 *
 * INSERT ... ON CONFLICT (provider, event_id) DO NOTHING is atomic at the
 * DB layer, so two concurrent calls with the same event_id will produce
 * exactly one firstSeen=true result and one firstSeen=false result.
 *
 * Throws on DB failure. Callers are REQUIRED to treat a throw as fail-
 * closed (return 500) so the provider's retry mechanism handles the
 * Postgres-unhealthy window. Silent re-processing is worse than letting
 * Stripe/Lemon retry once Postgres is back.
 */
export async function claimWebhookEvent(
  provider: WebhookProvider,
  eventId: string,
  eventType: string | null
): Promise<ClaimResult> {
  const result = await pg.query(
    `INSERT INTO webhook_events_processed (provider, event_id, event_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId, eventType]
  );
  return { firstSeen: (result.rowCount ?? 0) === 1 };
}

/**
 * Lemon Squeezy doesn't reliably publish a stable per-event id, so we derive
 * one. Preferred: meta.event_id when present. Fallback: SHA-256 of the raw
 * request body, truncated to 32 hex chars — replays of the same event have
 * byte-identical bodies; distinct events do not collide at 128 bits.
 *
 * Returns the source field so the caller can log which path was used and
 * the operator can audit, after one week of traffic, whether meta.event_id
 * is reliable enough to drop the fallback.
 */
export function deriveLemonEventId(
  payload: unknown,
  rawBody: Buffer
): { eventId: string; source: "meta_event_id" | "body_sha256" } {
  const candidate =
    typeof payload === "object" && payload !== null
      ? (payload as { meta?: { event_id?: unknown } })?.meta?.event_id
      : null;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return { eventId: trimmed, source: "meta_event_id" };
    }
  }

  const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
  return { eventId: hash.slice(0, 32), source: "body_sha256" };
}
