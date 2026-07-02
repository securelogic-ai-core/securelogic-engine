/**
 * riskApprovalAuthority.ts — Epic R2, the approval-authority seam.
 *
 * Pure, I/O-free decision for "may this actor decide (approve/reject) a risk
 * approval?" — the designated-approver model (spec §8.4, Decisions Q1a).
 *
 * Authority today = the `admin` role (the only privileged role in the platform;
 * no dedicated `approver` role exists — see the R2 report). This function is the
 * single seam through which authority flows, so a future dedicated approver role
 * OR a severity-scoped rule (e.g. only senior approvers for Critical risks) can
 * be layered in WITHOUT changing this signature — the residualScore /
 * approvalThresholdScore inputs are accepted now and intentionally inert.
 *
 * Separation of duties (approver ≠ proposer) is enforced SEPARATELY at the route
 * (409 sod_violation) and by the risk_approvals DB CHECK — it is not part of
 * authority, which is purely "who may act".
 *
 * JWT-actor requirement (Decisions Q2): an approval decision needs a resolvable
 * user identity; an API-key-only caller (actorUserId === null) is refused.
 */

export const APPROVER_ROLES = new Set<string>(["admin"]);

export function isApproverRole(role: string | null | undefined): boolean {
  return typeof role === "string" && APPROVER_ROLES.has(role);
}

export type ApprovalAuthorityReason = "approval_requires_user" | "approver_role_required";

export interface ApprovalAuthorityInput {
  /** Acting user id — null on the API-key-only path. */
  actorUserId: string | null;
  /** Acting user's role (users.role via the JWT bridge). */
  actorRole: string | null;
  /** Seam for Q1(b): severity-scoped authority later. Inert now. */
  residualScore?: number | null;
  /** Seam for Q1(b): the org's approval threshold. Inert now. */
  approvalThresholdScore?: number | null;
}

export interface ApprovalAuthorityDecision {
  allowed: boolean;
  reason?: ApprovalAuthorityReason;
}

/**
 * May this actor decide an approval? Pure; no I/O. Never throws.
 */
export function canApprove(input: ApprovalAuthorityInput): ApprovalAuthorityDecision {
  // Q2: a decision must be attributable to a human — API keys carry no identity.
  if (!input.actorUserId) {
    return { allowed: false, reason: "approval_requires_user" };
  }
  // Q1(a): designated approver = admin role.
  if (!isApproverRole(input.actorRole)) {
    return { allowed: false, reason: "approver_role_required" };
  }
  // Q1(b) seam: when a threshold model is introduced, authority may additionally
  // depend on (residualScore, approvalThresholdScore) here — inert today.
  return { allowed: true };
}
