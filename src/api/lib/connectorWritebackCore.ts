/**
 * connectorWritebackCore.ts — ERIP Epic 2 (E2a): the PURE writeback decision
 * (ERIP-AD-12). No I/O. Given an intent's desired value, the external system's
 * CURRENT value, and the value WE last pushed, decide what the writeback worker
 * should do — apply, adopt (already at desired), or hold as a conflict.
 *
 * This is optimistic concurrency on a single external field:
 *   - external_current === desired          → 'noop'     (already at desired;
 *                                              adopt it as our last-pushed)
 *   - last_pushed === null                  → 'apply'    (first assertion — we
 *                                              establish SecureLogic's value)
 *   - external_current === last_pushed      → 'apply'    (we own the field; the
 *                                              external system has not drifted)
 *   - otherwise                             → 'conflict' (someone changed the
 *                                              field externally AFTER our last
 *                                              push — never silently overwrite)
 *
 * Comparison is exact-string: the intent carries the literal EXTERNAL value and
 * readCurrent returns the literal external value, so drift detection is sound.
 * A null external_current means the field/record is absent externally; that is
 * treated as "not equal to desired" (a non-null desired), so it applies on
 * first push and conflicts only if we had previously pushed a non-null value.
 */

export type WritebackDecision = "apply" | "noop" | "conflict";

export interface WritebackDecisionInput {
  desiredValue: string;
  /** The external system's current value for this field; null = absent. */
  externalCurrent: string | null;
  /** The value we last successfully pushed; null = never pushed. */
  lastPushed: string | null;
}

export function decideWriteback(input: WritebackDecisionInput): WritebackDecision {
  const { desiredValue, externalCurrent, lastPushed } = input;
  if (externalCurrent === desiredValue) return "noop";
  if (lastPushed === null) return "apply";
  if (externalCurrent === lastPushed) return "apply";
  return "conflict";
}

/** Terminal statuses never re-scanned by the worker. */
export const TERMINAL_WRITEBACK_STATUSES = ["applied", "conflict", "failed"] as const;

/**
 * Transient-failure backoff (minutes) for a writeback push that errored (e.g. a
 * 5xx from the external API). Same shape as the connector schedule backoff:
 * exponential, bounded. attempts is the NEW attempt count (>= 1).
 */
export function writebackBackoffMinutes(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(60, 2 ** (n - 1)); // 1, 2, 4, 8, 16, 32, capped 60
}
