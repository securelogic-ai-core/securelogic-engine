/**
 * findingAcceptanceWorkflow.ts — the ONE rule that closes the governance side door.
 *
 * P0 (2026-07-15). Accepting the risk of a Finding is a GOVERNED decision: propose →
 * approve by a different authorized user, with rationale and a mandatory expiry, recorded
 * in the durable `finding_risk_acceptances` record. That workflow lives in
 * `src/api/routes/riskAcceptances.ts` and is the ONLY writer of `decision_state =
 * 'accepted_risk'` when it is live.
 *
 * Before this rule, three write paths could reach an "accepted" state WITHOUT that
 * workflow, fabricating a cosmetic label with no proposal, approver, rationale or expiry:
 *   1. `PATCH /api/findings/:id { decision_state: 'accepted_risk' }` (Decision Workspace)
 *   2. `POST /api/findings/bulk { op:'decide', decision_state:'accepted_risk' }`
 *   3. `PATCH /api/findings/:id { status: 'accepted' }` (legacy compat axis)
 *
 * When the signed workflow is live (`SECURELOGIC_RISK_ACCEPTANCE_ENABLED`), all three are
 * refused with `409 use_risk_acceptance_workflow`. The one and only path to acceptance is
 * the workflow.
 *
 * Flag OFF (production, initially): this predicate returns false, so every path behaves
 * byte-identically to before — the legacy `status='accepted'` accept is untouched, and the
 * Decision Workspace `decision_state` path is itself dark. Nothing here changes prod.
 */

import { riskAcceptanceEnabled } from "./riskAcceptanceFeatureFlag.js";

/**
 * True when a requested write would reach an "accepted-risk" state directly, AND the
 * governed workflow is live — i.e. the write must be refused in favour of the workflow.
 *
 * `decisionState` is the governance axis (`accepted_risk`); `legacyStatus` is the legacy
 * compat axis (`accepted`). Either one reaching "accepted" while the workflow is live is a
 * side door.
 */
export function directRiskAcceptanceBlocked(
  target: { decisionState?: string | null; legacyStatus?: string | null },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!riskAcceptanceEnabled(env)) return false;
  return target.decisionState === "accepted_risk" || target.legacyStatus === "accepted";
}

/** The 409 body shape returned when a direct acceptance write is refused. */
export interface RiskAcceptanceWorkflowRefusal {
  error: "use_risk_acceptance_workflow";
  message: string;
  finding_id?: string;
}

/**
 * The canonical refusal body. Callers spread it into the 409 response and add
 * `finding_id` where they have one. The message is customer-safe (no snake_case leaks) so
 * it can surface directly, matching the PR #657 mapping posture.
 */
export const USE_RISK_ACCEPTANCE_WORKFLOW_ERROR: RiskAcceptanceWorkflowRefusal = {
  error: "use_risk_acceptance_workflow",
  message:
    "Accepting a risk is a governed decision, not a status. Propose a risk acceptance and have a different authorized user approve it.",
};
