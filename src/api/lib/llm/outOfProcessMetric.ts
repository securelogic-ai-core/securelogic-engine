/**
 * outOfProcessMetric.ts — the difference between "zero" and "not measured here".
 *
 * A run summary that reports `0` for work it never observed is worse than one
 * that omits the field: the zero reads as evidence. That is exactly what
 * happened to the Wave 4 Tier 2 gate (#826) — the Brief scheduler's summary
 * carried `verdict_cache: {hits: 0, misses: 0, lookups: 0, tokens_saved: 0}`
 * for a run during which the matcher worker performed real cache lookups in a
 * DIFFERENT PROCESS. Nothing was wrong with the number; it was answering a
 * question the scheduler cannot answer.
 *
 * This module gives that state a name, so a reader (or a gate) can tell the two
 * apart without knowing the process topology:
 *
 *   {hits: 0, ...}                                   -> measured, and it was zero
 *   {measurement: "NOT_MEASURED_IN_THIS_PROCESS"}    -> this process cannot know
 *
 * The marker names the producer that CAN answer and the log event that carries
 * the real numbers, so the reader's next step is unambiguous.
 */

export const NOT_MEASURED_IN_THIS_PROCESS = "NOT_MEASURED_IN_THIS_PROCESS" as const;

export type OutOfProcessMetric = {
  measurement: typeof NOT_MEASURED_IN_THIS_PROCESS;
  /** The service that owns the measurement and can report it truthfully. */
  producer: string;
  /** The structured log event emitted by `producer` carrying the real totals. */
  event: string;
  /** Why this process cannot measure it — the architectural reason, not an excuse. */
  reason: string;
};

export function notMeasuredInThisProcess(
  producer: string,
  event: string,
  reason: string
): OutOfProcessMetric {
  return { measurement: NOT_MEASURED_IN_THIS_PROCESS, producer, event, reason };
}

/**
 * Type guard for consumers (dashboards, gate tooling) that must branch on
 * "did anyone actually measure this" before doing arithmetic on the value.
 */
export function isNotMeasuredInThisProcess(value: unknown): value is OutOfProcessMetric {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { measurement?: unknown }).measurement === NOT_MEASURED_IN_THIS_PROCESS
  );
}
