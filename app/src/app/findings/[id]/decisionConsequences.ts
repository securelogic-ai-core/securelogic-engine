/**
 * decisionConsequences.ts — the Governance Decision panel's option model.
 *
 * For each decision target legally reachable from the finding's current state
 * (legalDecisionTargets — the client mirror of the server state machine), this
 * module states what CHOOSING it does: the resulting governance state, the effect
 * on the system-derived operational status, closure eligibility, and whether a
 * written rationale is required. Pure + dependency-free (mirrors workQueues.ts /
 * decisionTransitions.ts) so the copy a customer decides on is unit-testable.
 *
 * The server remains the authority — a disabled/absent option here is a courtesy,
 * and every refusal path still surfaces the engine's error.
 */

import { legalDecisionTargets, type DecisionState } from "./decisionTransitions";
import { DECISION_STATE_LABELS, DECISION_STATE_MEANINGS } from "@/lib/findingLifecycleVocab";

export interface DecisionOption {
  value: DecisionState;
  label: string;
  /** What the state means (shared vocab). */
  meaning: string;
  /** What recording it DOES: resulting governance state, operational effect, closure eligibility. */
  consequence: string;
  /** A written rationale is required before this decision can be recorded. */
  requiresNote: boolean;
  /** Offered but not currently recordable (e.g. open remediation blocks closure). */
  disabled: boolean;
  disabledReason: string | null;
}

/** Per-target consequence copy. Closure eligibility is stated explicitly on each. */
function consequenceCopy(target: DecisionState): string {
  switch (target) {
    case "mitigating":
      return "Accepts the remediation plan. Governance becomes Mitigating; operational status keeps deriving from the linked remediation work. The finding stays active until remediation completes and a closing decision is recorded.";
    case "accepted_risk":
      return "Records a formal, audited risk acceptance. Governance becomes Accepted Risk; the finding becomes eligible for closure without full remediation and joins the periodic review record.";
    case "resolved":
      return "Closes the finding. Governance becomes Resolved (the only terminal state); operational status derives to Closed and the finding leaves every active queue.";
    case "needs_review":
      return "Reopens the finding. Governance returns to Needs Review; operational status re-derives from the remediation work, and the finding rejoins the active queues.";
  }
}

/**
 * The recordable decision options for the panel. Excludes the CURRENT state
 * (recording a no-move is not a decision) and — when the signed risk-acceptance
 * workflow is active — accepted_risk, which that workflow owns (propose →
 * approve), never a direct write.
 */
export function decisionOptions(args: {
  decisionState: string | null | undefined;
  operationalStatus: string | null | undefined;
  /** Non-terminal remediation Actions on the finding (blocks closure). */
  openActionCount: number;
  /** The signed risk-acceptance workflow owns accepted_risk when true. */
  riskAcceptanceActive: boolean;
}): DecisionOption[] {
  const { decisionState, operationalStatus, openActionCount, riskAcceptanceActive } = args;
  return legalDecisionTargets(decisionState, operationalStatus)
    .filter((t) => t !== decisionState)
    .filter((t) => !(riskAcceptanceActive && t === "accepted_risk"))
    .map((t) => {
      // Closure with open remediation: the engine refuses it — say so up front
      // instead of inviting a click that 409s (courtesy; server still enforces).
      const closureBlocked = t === "resolved" && openActionCount > 0;
      return {
        value: t,
        label: DECISION_STATE_LABELS[t] ?? t,
        meaning: DECISION_STATE_MEANINGS[t] ?? "",
        consequence: consequenceCopy(t),
        // Closing decisions (resolve / accept risk) are the audited governance
        // record — they require a written rationale. Plan acceptance and reopen
        // may carry one, but do not demand it.
        requiresNote: t === "resolved" || t === "accepted_risk",
        disabled: closureBlocked,
        disabledReason: closureBlocked
          ? `${openActionCount} remediation action${openActionCount === 1 ? "" : "s"} still open — complete the work before closing.`
          : null,
      };
    });
}

/** Max rationale length — mirrors the engine's decision_note validation. */
export const DECISION_NOTE_MAX = 2000;
