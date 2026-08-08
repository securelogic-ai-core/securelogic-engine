import { dispatchWebhookEvent } from "./webhookDispatcher.js";
import { webhookWave1Enabled } from "./webhookWave1FeatureFlag.js";

/**
 * acceptanceWebhookEmitter.ts — wave-1 (DS-15) events for the risk-governance
 * seam: acceptance.approved, acceptance.expiring, risk.promoted.
 *
 * One emitter for the approve route and the expiry worker so the payload
 * discipline stays in one place: canonical IDs and governance facts only
 * (acceptance/finding/risk ids, expiry, ownership) — never rationale text or
 * decision content, which belong to the authenticated API surface.
 *
 * Fire-and-forget; no-op while SECURELOGIC_WEBHOOK_WAVE1_ENABLED is off.
 */
export function emitAcceptanceEvent(
  eventType: "acceptance.approved" | "acceptance.expiring" | "risk.promoted",
  orgId: string,
  data: Record<string, unknown>
): void {
  if (!webhookWave1Enabled()) return;
  dispatchWebhookEvent({
    event_type: eventType,
    organization_id: orgId,
    data,
  }).catch(() => {});
}
