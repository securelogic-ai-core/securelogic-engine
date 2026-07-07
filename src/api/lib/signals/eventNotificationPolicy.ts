/**
 * eventNotificationPolicy.ts — intelligent notification policy for canonical
 * Intelligence Events. Intelligence Pipeline Hardening / IE.P7 (memo IE-AD-9).
 *
 * Goal item 9: replace event-per-email with a policy —
 *   - IMMEDIATE alerts ONLY for customer-impacting CRITICAL events.
 *   - the DAILY Intelligence Brief summarizes events + org risk changes (digest).
 *   - the WEEKLY Executive Summary stays separate.
 *   - no duplicate notifications.
 *
 * decideNotification() is PURE — it maps an event's severity/status/impact to a
 * channel. The dedup ledger (never send the same event twice on the same
 * channel) lives in eventNotificationStore.ts.
 */

import type { EventStatus } from "./intelligenceEventProjection.js";

/**
 * immediate — page the org now (customer-impacting + critical/exploited).
 * digest    — roll into the org's daily Intelligence Brief summary.
 * none      — not org-relevant; surfaced in-app only, never emailed per-event.
 */
export type NotificationChannel = "immediate" | "digest" | "none";

export interface NotificationInput {
  readonly severity: string;
  readonly status: EventStatus;
  /** The event affects something this org tracks (vendor / AI system / asset). */
  readonly customerImpacting: boolean;
}

export interface NotificationDecision {
  readonly channel: NotificationChannel;
  readonly reason: string;
}

/**
 * Decide the notification channel for an event, per org.
 *
 *   not customer-impacting            → none    (in-app only; global intel)
 *   customer-impacting + Critical     → immediate
 *   customer-impacting + exploited    → immediate (active exploitation)
 *   customer-impacting (otherwise)    → digest   (daily brief roll-up)
 */
export function decideNotification(input: NotificationInput): NotificationDecision {
  if (!input.customerImpacting) {
    return { channel: "none", reason: "not_customer_impacting" };
  }
  if (input.severity === "Critical") {
    return { channel: "immediate", reason: "customer_impacting_critical" };
  }
  if (input.status === "actively_exploited") {
    return { channel: "immediate", reason: "customer_impacting_exploited" };
  }
  return { channel: "digest", reason: "customer_impacting_digest" };
}
