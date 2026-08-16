/**
 * legalHoldAuthority.ts — pure authority + separation-of-duties for legal holds.
 *
 * Deliberately shaped like riskApprovalAuthority.ts, because the platform
 * already settled this question once and a second, differently-shaped answer to
 * "who may take a privileged governance action" is how authority models drift:
 *
 *   • authority is a pure, I/O-free seam (this file),
 *   • separation of duties is enforced at the route (409 sod_violation),
 *   • and the database carries the same rule as a CHECK (20261013).
 *
 * All three, because a hold is the control that outranks every deletion path in
 * the platform: if it can be placed or lifted casually, nothing else here holds.
 */

/** Authority today = the `admin` role, the platform's only privileged role. */
export const HOLD_AUTHORITY_ROLES: ReadonlySet<string> = new Set(["admin"]);

export function isHoldAuthorityRole(role: string | null | undefined): boolean {
  return typeof role === "string" && HOLD_AUTHORITY_ROLES.has(role);
}

export type HoldAuthorityReason =
  | "hold_requires_user"
  | "admin_role_required"
  | "reason_required"
  | "sod_violation";

export interface HoldAuthorityDecision {
  allowed: boolean;
  reason?: HoldAuthorityReason;
}

export interface PlaceHoldInput {
  /** Acting user id — null on the API-key-only path. */
  actorUserId: string | null;
  /** Acting user's role. */
  actorRole: string | null;
  /** Free text; mandatory. A hold with no stated reason cannot be reviewed. */
  reason: string | null | undefined;
}

export interface ReleaseHoldInput extends PlaceHoldInput {
  /** Who placed the hold being released. Null when the actor FK was scrubbed. */
  placedByUserId: string | null;
}

const ALLOWED: HoldAuthorityDecision = { allowed: true };

function baseChecks(input: PlaceHoldInput): HoldAuthorityDecision | null {
  // A hold is an attributable legal act. An API key carries no human identity,
  // so it cannot place or lift one — same rule as an approval decision.
  if (!input.actorUserId) return { allowed: false, reason: "hold_requires_user" };
  if (!isHoldAuthorityRole(input.actorRole)) {
    return { allowed: false, reason: "admin_role_required" };
  }
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    return { allowed: false, reason: "reason_required" };
  }
  return null;
}

export function canPlaceHold(input: PlaceHoldInput): HoldAuthorityDecision {
  return baseChecks(input) ?? ALLOWED;
}

/**
 * TDG-7. Release additionally requires a DIFFERENT admin than the one who
 * placed the hold.
 *
 * A single-admin organization therefore cannot lift its own hold. That is the
 * intended reading of separation of duties, not an oversight: the break-glass
 * is an operator-executed release under the same audit trail, and it is
 * documented in the runbook rather than coded as an exception here — an
 * exception in this function would be indistinguishable from the bug it
 * imitates.
 *
 * A null `placedByUserId` (the placer's FK was scrubbed by a later erasure)
 * does NOT dissolve the rule into "anyone may release": there is no longer a
 * user to compare against, so the DB CHECK cannot bite, and the decision falls
 * back to plain admin authority — which is why the placement identity is also
 * recorded immutably in the audit event.
 */
export function canReleaseHold(input: ReleaseHoldInput): HoldAuthorityDecision {
  const base = baseChecks(input);
  if (base) return base;
  if (input.placedByUserId != null && input.placedByUserId === input.actorUserId) {
    return { allowed: false, reason: "sod_violation" };
  }
  return ALLOWED;
}

/** HTTP status for each refusal, so routes report them consistently. */
export function statusForHoldReason(reason: HoldAuthorityReason): number {
  switch (reason) {
    case "sod_violation":
      return 409;
    case "reason_required":
      return 400;
    default:
      return 403;
  }
}
