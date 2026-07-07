/**
 * eventNotificationStore.ts — notification decisioning + dedup ledger for
 * canonical Intelligence Events. Intelligence Pipeline Hardening / IE.P7
 * (memo IE-AD-9).
 *
 * Applies decideNotification() then CLAIMS the (org, canonical event, channel) in
 * intelligence_event_notifications so the same event is never sent twice on the
 * same channel (goal item 9 — prevent duplicate notifications). The claim is an
 * INSERT ... ON CONFLICT DO NOTHING; a returned row means "first time — send
 * now", no row means "already notified — suppress".
 *
 * This layer OWNS the dedup + policy decision. The actual transport for an
 * 'immediate' alert (customer channel) is injected/operator-wired; the daily
 * 'digest' claim is consumed by the brief. DARK: self-gates on the flag.
 */

import { pg, withTenant } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { intelligenceEventsEnabled } from "./intelligenceEventsFeatureFlag.js";
import { decideNotification, type NotificationChannel } from "./eventNotificationPolicy.js";
import type { EventStatus } from "./intelligenceEventProjection.js";

/** The event fields the notification layer needs. */
export interface EventNotificationInput {
  /** intelligence_events.id, or null (the ledger dedups on canonical_key). */
  readonly event_id: string | null;
  readonly canonical_key: string;
  readonly severity: string;
  readonly status: EventStatus;
}

export interface NotificationOutcome {
  readonly channel: NotificationChannel;
  readonly reason: string;
  /** True when this is the first claim for (org, event, channel) — send now. */
  readonly claimed: boolean;
}

interface TenantQueryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Claim (org, canonical_key, channel); true iff this is the first claim. */
async function claim(
  client: TenantQueryable,
  orgId: string,
  input: EventNotificationInput,
  channel: NotificationChannel,
  reason: string
): Promise<boolean> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO intelligence_event_notifications
       (organization_id, event_id, canonical_key, channel, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, canonical_key, channel) DO NOTHING
     RETURNING id`,
    [orgId, input.event_id, input.canonical_key, channel, reason]
  );
  return res.rows.length > 0;
}

/**
 * Decide + dedup a notification for one (org, event). Returns the chosen channel
 * and whether this call CLAIMED it (i.e. the caller should now send). Idempotent:
 * a second call for the same (org, event, channel) returns claimed=false.
 *
 * 'none' (not customer-impacting) never touches the ledger. Flag-gated.
 */
export async function evaluateAndClaimNotification(
  orgId: string,
  event: EventNotificationInput,
  customerImpacting: boolean
): Promise<NotificationOutcome> {
  if (!intelligenceEventsEnabled()) {
    return { channel: "none", reason: "disabled", claimed: false };
  }

  const decision = decideNotification({
    severity: event.severity,
    status: event.status,
    customerImpacting
  });

  if (decision.channel === "none") {
    return { channel: "none", reason: decision.reason, claimed: false };
  }

  return withTenant(orgId, async () => {
    const claimed = await claim(pg, orgId, event, decision.channel, decision.reason);
    if (claimed) {
      logger.info(
        {
          event: "intelligence_event_notification_claimed",
          orgId,
          canonicalKey: event.canonical_key,
          channel: decision.channel,
          reason: decision.reason
        },
        "Intelligence Event notification claimed (first send on this channel)"
      );
    }
    return { channel: decision.channel, reason: decision.reason, claimed };
  });
}
