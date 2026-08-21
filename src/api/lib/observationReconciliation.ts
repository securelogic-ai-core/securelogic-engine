/**
 * observationReconciliation.ts — deciding presence from evidence.
 *
 * PURE. Same pure/IO split as occurrenceLifecycle and findingSlaPolicyRules: the
 * decisions are made here and applied by the store, so the one rule that must
 * never be got wrong is unit-testable without a scanner, a database or a clock.
 *
 * ══ MISSING FROM A SCAN DOES NOT MEAN FIXED ═══════════════════════════════
 *
 * A vulnerability disappears from a report for many reasons and only one of them
 * is good news: it was remediated, or the host was off, or credentials expired,
 * or the scan template changed, or the asset was never in scope. A report cannot
 * tell those apart, so absence is NEVER inferred from a vulnerability's absence
 * in a report.
 *
 * It is inferred from an ASSET'S PRESENCE in a completed, scope-declared run,
 * combined with the vulnerability not being reported against that asset. Two
 * different claims; only the second is safe to act on.
 *
 * Three conditions, all required, none negotiable:
 *   1. the run COMPLETED — an aborted run proves nothing about what it did not
 *      reach;
 *   2. the run DECLARED ITS SCOPE — it said what it looked at, not just what it
 *      found;
 *   3. the ASSET WAS IN THAT SCOPE — otherwise the run never looked, and silence
 *      about it is not evidence.
 *
 * ══ AND EVEN THEN, ONLY THAT SOURCE GOES QUIET ════════════════════════════
 * Staleness is per-source. One scanner losing visibility does not silence the
 * others, so an occurrence becomes absent only when EVERY source that ever
 * reported it has gone stale. A human's `remediated` outranks all of them.
 */

import type { PresenceStatus } from "./occurrenceLifecycle.js";

/** A scan run, as far as reconciliation cares. */
export interface ScanRun {
  id: string;
  sourceKey: string;
  status: "in_progress" | "completed" | "aborted";
  scopeDeclared: boolean;
  reconciledAt: string | null;
}

/** One source's view of one occurrence. */
export interface Observation {
  id: string;
  occurrenceId: string;
  sourceKey: string;
  stale: boolean;
}

export type AbsenceAuthority =
  | { authorised: true }
  | { authorised: false; reason: string };

/**
 * May this run cause anything to be marked absent?
 *
 * Deliberately returns a REASON rather than a bare boolean: "why didn't my scan
 * close anything" is the first question an operator asks, and a silent false
 * makes that unanswerable without reading this file.
 */
export function absenceAuthority(run: ScanRun): AbsenceAuthority {
  if (run.status === "aborted") {
    return {
      authorised: false,
      reason:
        "The scan did not finish. An aborted run proves nothing about the assets it never reached.",
    };
  }
  if (run.status !== "completed") {
    return { authorised: false, reason: "The scan has not finished yet." };
  }
  if (!run.scopeDeclared) {
    return {
      authorised: false,
      reason:
        "The source reported what it FOUND but not what it LOOKED AT, so its silence " +
        "about a vulnerability is not evidence that the vulnerability is gone.",
    };
  }
  if (run.reconciledAt !== null) {
    return {
      authorised: false,
      reason: "This run has already been reconciled — replaying it must not change anything again.",
    };
  }
  return { authorised: true };
}

/**
 * Which of this source's observations should go stale after a run.
 *
 * `observedNow` is the set of observation ids the run actually reported.
 * `assetsInScope` is what the run covered. An observation survives untouched
 * when its asset was NOT in scope — the run never looked at it, so it has
 * nothing to say — which is the difference between "scanned and clean" and "not
 * scanned".
 */
export function observationsToStale(
  candidates: ReadonlyArray<Observation & { assetId: string }>,
  observedNow: ReadonlySet<string>,
  assetsInScope: ReadonlySet<string>,
): string[] {
  return candidates
    .filter(
      (o) =>
        !o.stale &&
        assetsInScope.has(o.assetId) &&
        !observedNow.has(o.id),
    )
    .map((o) => o.id);
}

/**
 * The presence an occurrence should now hold, given every source's view.
 *
 * `remediated` is never overwritten. A person recorded that the work was done;
 * a scanner's silence is not a contradiction of that, and letting it downgrade
 * the record would quietly replace a human's claim with an inference. If the
 * vulnerability really is back, the scanner will REPORT it — and that is a
 * reappearance, handled by observe().
 *
 * An occurrence with NO observations is left exactly as it is: it was recorded
 * by hand, no source owns it, and reconciliation has no standing to touch it.
 */
export function presenceFromObservations(
  current: PresenceStatus,
  observations: ReadonlyArray<Observation>,
): { next: PresenceStatus; changed: boolean; reason: string } {
  if (current === "remediated") {
    return {
      next: "remediated",
      changed: false,
      reason: "A recorded remediation is not overturned by a scanner going quiet.",
    };
  }
  if (observations.length === 0) {
    return {
      next: current,
      changed: false,
      reason: "No source reports this occurrence — it was recorded by hand and is not reconciled.",
    };
  }
  const anyLive = observations.some((o) => !o.stale);
  if (anyLive) {
    return {
      next: "present",
      changed: current !== "present",
      reason: "At least one source still reports this exposure.",
    };
  }
  return {
    next: "absent",
    changed: current !== "absent",
    reason: "Every source that reported this exposure has since scanned the asset without finding it.",
  };
}

/** What one reconciliation pass did, for the run summary an operator reads. */
export interface ReconcileSummary {
  observed: number;
  went_stale: number;
  became_absent: number;
  reappeared: number;
  skipped_not_in_scope: number;
  /** Present when the run had no authority to assert absence. */
  absence_skipped_reason?: string;
}

export function emptySummary(): ReconcileSummary {
  return {
    observed: 0,
    went_stale: 0,
    became_absent: 0,
    reappeared: 0,
    skipped_not_in_scope: 0,
  };
}
