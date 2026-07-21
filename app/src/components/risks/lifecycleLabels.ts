/**
 * lifecycleLabels — shared display vocabulary for the risk-lifecycle UI (R3).
 *
 * The customer sees a 12-stage journey (spec §2.2); underneath there are 9
 * persisted states (spec §3.1). This module maps the two, turns transition
 * names into button labels, and turns the engine's machine-readable 409/403
 * `reason` codes into human requirements. Kept as plain data (no component,
 * no new library) so the panel, event stream, and approvals queue stay
 * consistent.
 */

import type { LifecycleGates } from "@/lib/api";

/** Persisted-state ordering (spec §3). Drives progress comparisons. */
export const STATE_ORDER: Record<string, number> = {
  draft: 0,
  scoping: 1,
  treatment_selection: 2,
  pending_approval: 3,
  mitigation: 4,
  validation: 5,
  residual_review: 6,
  closed: 7,
  archived: 8,
};

export const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  scoping: "Assessment",
  treatment_selection: "Treatment Selection",
  pending_approval: "Pending Approval",
  mitigation: "Mitigation",
  validation: "Validation",
  residual_review: "Residual Review",
  closed: "Closed",
  archived: "Archived",
};

export function stateLabel(state: string | null | undefined): string {
  if (!state) return "Draft";
  return STATE_LABEL[state] ?? state;
}

/** A gate flag on the GET /lifecycle response, for the scoping sub-stages. */
type GateKey = "owner" | "evidence" | "score";

/** The 12 customer-facing milestones (spec §3.2), each mapped to a persisted
 *  state and, for the scoping sub-milestones, a gate flag. */
export const STAGES: ReadonlyArray<{
  label: string;
  state: string;
  gate?: GateKey;
}> = [
  { label: "Identified", state: "draft" },
  { label: "Created", state: "draft" },
  { label: "Owner Assigned", state: "scoping", gate: "owner" },
  { label: "Evidence Collected", state: "scoping", gate: "evidence" },
  { label: "Scored", state: "scoping", gate: "score" },
  { label: "Treatment Selected", state: "treatment_selection" },
  { label: "Executive Approval", state: "pending_approval" },
  { label: "Mitigation Started", state: "mitigation" },
  { label: "Validation", state: "validation" },
  { label: "Residual Review", state: "residual_review" },
  { label: "Closed", state: "closed" },
  { label: "Archived", state: "archived" },
];

export type StageStatus = "complete" | "current" | "upcoming";

function gateSatisfied(gates: LifecycleGates, key: GateKey): boolean {
  if (key === "owner") return gates.owner;
  if (key === "score") return gates.score;
  return gates.evidence;
}

/**
 * Compute per-stage status for the progress rail. A stage is complete once the
 * risk has moved past its state, or is in that state with its gate satisfied;
 * the "current" marker is the first unmet gate in the active state, or that
 * state's final milestone when all its gates are met.
 */
export function stageStatuses(
  current: string,
  gates: LifecycleGates
): StageStatus[] {
  const curIdx = STATE_ORDER[current] ?? 0;
  const raw = STAGES.map((st) => {
    const sIdx = STATE_ORDER[st.state] ?? 0;
    if (sIdx < curIdx) return "reached";
    if (sIdx > curIdx) return "upcoming";
    if (!st.gate) return "reached";
    return gateSatisfied(gates, st.gate) ? "reached" : "unmet";
  });

  let currentIdx = raw.findIndex((s) => s === "unmet");
  if (currentIdx === -1) {
    for (let i = STAGES.length - 1; i >= 0; i--) {
      if ((STATE_ORDER[STAGES[i].state] ?? 0) === curIdx) {
        currentIdx = i;
        break;
      }
    }
  }

  return raw.map((s, i) => {
    if (i === currentIdx) return "current";
    return s === "reached" ? "complete" : "upcoming";
  });
}

/** Transition name → action-button label. The approval-managed transitions
 *  (submit_for_approval/approve/reject) never reach here — the engine omits
 *  them from allowed_transitions; approvals are their own affordances. */
export const TRANSITION_LABELS: Record<string, string> = {
  begin_assessment: "Begin assessment",
  advance_to_treatment: "Advance to treatment",
  start_mitigation_direct: "Start mitigation",
  complete_mitigation: "Mark remediation complete",
  pass_validation: "Validation passed",
  fail_validation: "Validation failed",
  close: "Close risk",
  reopen: "Reopen",
  archive: "Archive",
  unarchive: "Un-archive",
  rescore: "Re-score (new evidence)",
};

export function transitionLabel(name: string): string {
  return TRANSITION_LABELS[name] ?? name.replace(/_/g, " ");
}

/** Engine machine reason (409/403 `error`) → human-readable requirement. */
export const REASON_LABELS: Record<string, string> = {
  owner_required: "A risk owner must be assigned first.",
  evidence_required: "Evidence must be attached before advancing.",
  score_required: "The residual risk must be scored first.",
  treatment_required: "Add at least one treatment before requesting approval.",
  approval_required: "Executive approval is required to proceed.",
  separation_of_duties: "You proposed this plan, so you can't approve it (separation of duties).",
  sod_violation: "You proposed this plan, so you can't approve it (separation of duties).",
  actor_identity_required: "A signed-in user is required for approval actions.",
  approval_requires_user: "A signed-in user is required for approval actions.",
  approver_role_required: "Only an approver (admin) can decide approvals.",
  read_only_access: "Your account is read-only and can't make changes.",
  approval_already_open: "An approval request is already open for this risk.",
  approval_already_decided: "This approval has already been decided.",
  state_conflict: "This risk changed since you loaded it — refresh and try again.",
  terminal_state: "This risk is in a terminal state.",
  invalid_transition: "That action isn't available from the current stage.",
  invalid_lifecycle_state: "This risk's lifecycle state is invalid.",
  use_approvals_endpoint: "Use the approval actions for this step.",
  gate_not_satisfied: "A required condition for this step hasn't been met.",
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "The action could not be completed.";
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}
