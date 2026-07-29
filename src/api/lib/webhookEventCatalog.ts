/**
 * webhookEventCatalog.ts — the canonical webhook event vocabulary.
 *
 * The event catalog is a PLATFORM CONTRACT, not UI copy: the engine decides
 * which events exist, and every surface (the webhooks route's validation, the
 * settings picker, the customer-facing reference table) renders from this one
 * list. Before this module the vocabulary was written out three times — the
 * route's VALID_EVENT_TYPES, the app's picker array, and the app's reference
 * table — so a new event type shipped by the engine stayed invisible in the
 * UI until someone remembered to hand-edit two React files.
 *
 * Wave-1 entries (DS-15) are gated on SECURELOGIC_WEBHOOK_WAVE1_ENABLED and
 * are absent from `webhookEventCatalog()` while the flag is off — so the
 * catalog endpoint reveals exactly what the route will accept, and flag-off
 * behaviour is byte-identical to pre-wave-1.
 */

import { webhookWave1Enabled, WAVE1_EVENT_TYPES } from "./webhookWave1FeatureFlag.js";

export interface WebhookEventDefinition {
  /** The wire value, e.g. "finding.created". */
  event_type: string;
  /** Customer-facing one-line description. */
  description: string;
}

/** Events available in every environment, independent of any feature flag. */
const BASE_EVENTS: readonly WebhookEventDefinition[] = [
  { event_type: "finding.created",          description: "A new finding is created" },
  { event_type: "finding.updated",          description: "A finding status or priority changes" },
  { event_type: "risk.created",             description: "A new risk is added to the register" },
  { event_type: "vendor.assessed",          description: "A vendor assessment is completed" },
  { event_type: "posture.snapshot_created", description: "A posture snapshot is computed" },
  { event_type: "action.created",           description: "A new action is created" },
  { event_type: "action.updated",           description: "An action status changes" },
];

/**
 * Wave-1 events (DS-15). Keyed by event type so the descriptions here and the
 * WAVE1_EVENT_TYPES vocabulary in the feature-flag module cannot drift: the
 * flag module stays the single owner of WHICH types are wave 1, this map only
 * supplies their prose.
 */
const WAVE1_DESCRIPTIONS: Record<string, string> = {
  "suggestion.created":   "A signal match suggestion is raised for review",
  "brief.published":      "An Intelligence Brief is published",
  "acceptance.approved":  "A finding risk-acceptance is approved",
  "acceptance.expiring":  "An approved risk-acceptance is nearing expiry",
  "signal.matched":       "An external signal is matched to your environment",
  "risk.promoted":        "An accepted finding is promoted to the risk register",
};

/**
 * The event types this deployment currently accepts, in catalog order.
 * Flag-aware: wave-1 entries appear only while the wave-1 flag is on.
 */
export function webhookEventCatalog(): WebhookEventDefinition[] {
  const catalog = [...BASE_EVENTS];
  if (webhookWave1Enabled()) {
    for (const t of WAVE1_EVENT_TYPES) {
      catalog.push({
        event_type: t,
        // A wave-1 type with no prose is still a real, registrable event —
        // fall back to the type itself rather than hiding it from customers.
        description: WAVE1_DESCRIPTIONS[t] ?? t,
      });
    }
  }
  return catalog;
}

/** Concrete (non-wildcard) event types this deployment accepts. */
export function webhookEventTypes(): string[] {
  return webhookEventCatalog().map((e) => e.event_type);
}
