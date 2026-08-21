/**
 * occurrenceLifecycle.ts — the PRESENCE axis, and the one place it is defined.
 *
 * PURE. Same pure/IO split as findingLifecycleMachine and findingSlaPolicyRules:
 * the transitions are decided here and applied by the caller, so they can be
 * tested without a database and cannot drift between the route that a human
 * drives and the reconciler that a scan drives (SL-OCC-2). That drift is exactly
 * what riskAcceptanceContract.ts exists to prevent for "binding", and presence
 * has the same shape — two callers, one meaning.
 *
 * ── PRESENCE IS NOT DECISION AND NOT REMEDIATION ───────────────────────────
 * findings.decision_state says what the organisation DECIDED.
 * findings.operational_status says where the REMEDIATION got to.
 * presence_status says what was OBSERVED, on one asset. Nothing here reads or
 * writes either finding axis, and no transition below closes, reopens or re-rates
 * a finding. An occurrence is one host's story; the finding is the organisation's.
 *
 * ── absent ≠ remediated ────────────────────────────────────────────────────
 * The single most important distinction in this file. `absent` means an
 * authoritative later look did not find it. `remediated` means a human says it
 * was fixed. A scanner cannot produce the second — it has no access to the fact
 * of the work — and treating silence as success is how a vulnerability
 * management product starts lying. SL-VULN-1 drew the same line for severity
 * ("Informational" is not "Low"); this is that discipline applied to presence.
 */

export const PRESENCE_STATUSES = ["present", "absent", "remediated"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** The mutable presence state of one occurrence. */
export interface OccurrenceState {
  presence_status: PresenceStatus;
  first_seen_at: string;
  last_seen_at: string;
  absent_since: string | null;
  remediated_at: string | null;
  reappeared_count: number;
  last_reappeared_at: string | null;
}

/** A patch to apply. Absent keys are left untouched by the caller. */
export type OccurrencePatch = Partial<OccurrenceState>;

/**
 * The source observed this exposure at `at`.
 *
 * From `absent` or `remediated` this is a REAPPEARANCE: the exposure is back on a
 * host where it had stopped being reported, or where someone believed it fixed.
 * That is a materially different fact from "still there", which is why it is
 * counted rather than silently folded into a last_seen_at bump — a recurring
 * vulnerability is a control-effectiveness signal, and a product that overwrites
 * it cannot report on it.
 *
 * first_seen_at is NEVER moved. The exposure began when it began; a gap in the
 * middle does not restart its history, and resetting it would erase the age that
 * SLA and executive reporting are computed against.
 */
export function observe(state: OccurrenceState, at: string): OccurrencePatch {
  const wasGone = state.presence_status === "absent" || state.presence_status === "remediated";
  const patch: OccurrencePatch = {
    presence_status: "present",
    // Monotonic: an out-of-order or replayed observation must never rewind the
    // window. Reconciliation replay (SL-OCC-2) depends on this being idempotent.
    last_seen_at: at > state.last_seen_at ? at : state.last_seen_at,
    absent_since: null,
    remediated_at: null,
  };
  if (wasGone) {
    patch.reappeared_count = state.reappeared_count + 1;
    patch.last_reappeared_at = at;
  }
  return patch;
}

/**
 * An authoritative later look did NOT find this exposure on this asset.
 *
 * ONLY legal from `present`. A `remediated` occurrence is not re-marked absent —
 * a human's claim about the work outranks a scanner's silence, and downgrading it
 * would let an absence quietly overwrite a remediation record. Callers that hold
 * no authority to assert absence must not call this at all; establishing that
 * authority is SL-OCC-2's problem, not this function's.
 */
export function markAbsent(state: OccurrenceState, at: string): OccurrencePatch | null {
  if (state.presence_status !== "present") return null;
  return { presence_status: "absent", absent_since: at };
}

/** A human recorded that this exposure was fixed on this asset. Legal from any state. */
export function markRemediated(state: OccurrenceState, at: string): OccurrencePatch {
  return { presence_status: "remediated", remediated_at: at, absent_since: null };
}

/** Derived, never stored: this occurrence has never stopped being reported. */
export function isNew(state: OccurrenceState): boolean {
  return state.first_seen_at === state.last_seen_at && state.reappeared_count === 0;
}

/** Derived, never stored: this exposure has come back at least once. */
export function hasRecurred(state: OccurrenceState): boolean {
  return state.reappeared_count > 0;
}

/** The counts a finding shows: affected / active / no longer observed. */
export interface OccurrenceRollup {
  affected: number;
  active: number;
  absent: number;
  remediated: number;
  recurring: number;
}

/**
 * Whether a finding could be closed on the evidence of its occurrences.
 *
 * REPORT-ONLY, and the name says so. This inherits ERIP-AD-11 ("drift is
 * reported, never destructive") from the connector observation ledger: the engine
 * never closes a finding because a scan went quiet. A finding whose every
 * occurrence is absent or remediated is SURFACED to a human as eligible, and a
 * human closes it through the existing closure gate — which is where the
 * separation-of-duties and evidence requirements already live.
 *
 * A finding with NO occurrences is not eligible: absence of evidence about
 * exposure is not evidence of remediation, and a vulnerability recorded without
 * any asset is a legitimate standing record, not a finished one.
 */
export function isClosureEligible(rollup: OccurrenceRollup): boolean {
  return rollup.affected > 0 && rollup.active === 0;
}
