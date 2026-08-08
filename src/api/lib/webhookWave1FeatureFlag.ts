/**
 * webhookWave1FeatureFlag.ts — DS-15 webhook wave 1 (issue #694 step 5).
 *
 * Gates the six wave-1 outbound event types (suggestion.created,
 * brief.published, acceptance.approved, acceptance.expiring, signal.matched,
 * risk.promoted), their registration in the webhooks route, and the envelope
 * `version` field. Flag-off is byte-identical: no new event types are
 * accepted or emitted, and the delivery envelope is exactly the pre-wave-1
 * shape — so enabling wave 1 (and with it, the moment `*` subscribers start
 * receiving the new types) is an explicit, ledgered operator decision, not a
 * deploy side effect.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate, read at call time
 * (the risk-lifecycle / promotion shape — no NODE_ENV escape hatch).
 */

export function webhookWave1Enabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_WEBHOOK_WAVE1_ENABLED"] === "true";
}

/** The wave-1 event vocabulary, exported for route validation and tests. */
export const WAVE1_EVENT_TYPES = [
  "suggestion.created",
  "brief.published",
  "acceptance.approved",
  "acceptance.expiring",
  "signal.matched",
  "risk.promoted",
] as const;

export type Wave1EventType = (typeof WAVE1_EVENT_TYPES)[number];
