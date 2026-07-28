import { dispatchWebhookEvent } from "./webhookDispatcher.js";
import { webhookWave1Enabled } from "./webhookWave1FeatureFlag.js";

/**
 * briefWebhookEmitter.ts — wave-1 (DS-15) brief.published event.
 *
 * One payload builder for BOTH publication points (the customer generate
 * route and the scheduler) so the two sites cannot drift. Payload carries
 * canonical IDs and counts only — never brief content (content_json is
 * encrypted at rest for a reason; a webhook must not become the plaintext
 * side channel).
 *
 * Fire-and-forget; no-op while SECURELOGIC_WEBHOOK_WAVE1_ENABLED is off.
 */
export function emitBriefPublished(
  orgId: string,
  data: {
    brief_id: string;
    signal_count: number;
    item_count: number;
    /** 'scheduler' (weekly run) or 'on_demand' (customer generate route). */
    trigger: "scheduler" | "on_demand";
  }
): void {
  if (!webhookWave1Enabled()) return;
  dispatchWebhookEvent({
    event_type: "brief.published",
    organization_id: orgId,
    data,
  }).catch(() => {});
}
