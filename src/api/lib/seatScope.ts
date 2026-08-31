/**
 * seatScope.ts — the ONE authorization decision for the enterprise seat model.
 *
 * Everything the seat model needs to know about a request converges here:
 * `resolveScope(seatType, role, opts)` is a pure, total function that turns the
 * three independent axes — Organization Plan (entitlement, handled by its own
 * gate), Seat Type, and Role — into a single object-scope + capability answer.
 * No route reads `seat_type` or `role` directly; they read the resolved scope.
 *
 * THE RULE: seat type sets the CEILING, role sets the actual GRANT.
 *   - A Full seat may hold any role. Full + admin is the only path to Org
 *     Admin — buying a Full seat grants Governance Lead, never Admin.
 *   - A Contributor seat is scoped to assigned/owned objects and can never be
 *     Admin. An admin role on a Contributor seat clamps DOWN to analyst.
 *   - A Viewer seat is tenant-wide read-only; any non-viewer role clamps DOWN
 *     to viewer.
 * Clamping means an incompatible (seat, role) pair always resolves to the SAFE
 * floor, so a bad combination can only ever reduce access, never widen it.
 *
 * API-key auth has no user row; it is admin-level by long-standing convention,
 * so callers pass seatType='full', role='admin' (see scopeForApiKey).
 */

export type SeatType = "full" | "contributor" | "viewer";
export type UserRole = "admin" | "analyst" | "member" | "viewer";

/** Row-level reach for governance objects. */
export type ObjectScope =
  | "tenant" // every object in the organization
  | "assigned" // only objects owned by / assigned to this user
  | "none"; // nothing

/** Named grants layered on top of object scope. */
export type Capability =
  | "org:configure" // organization settings, risk model
  | "users:manage" // invite / remove / change roles and seats
  | "billing:manage"
  | "security:configure" // SSO, connectors, webhooks-as-integration
  | "audit:read"
  | "risk:accept" // participate in risk acceptance (SoD still applies)
  | "export:data" // bulk export of tenant data
  /**
   * AUTHORIZED ASSURANCE REVIEWER (VA-S4-4C-3). Accept, edit or reject a
   * GOVERNED assurance interpretation: a tested control's effectiveness, or an
   * exception's effect.
   *
   * WHAT THIS CAPABILITY DOES NOT ESTABLISH, and the reason it is safe to grant
   * it the same way `risk:accept` is granted: it answers "is this identity
   * PERMITTED to review assurance". It does not, and structurally cannot,
   * answer "is this a HUMAN". `scopeForApiKey()` resolves an API key to a
   * full/admin seat, so a machine caller holds every capability a tenant-write
   * identity holds — including this one.
   *
   * Human authority is a SEPARATE, ORTHOGONAL axis enforced in two places that
   * the capability system does not reach: the routes refuse an unattributed
   * caller with a 403 before any write, and 20261076/20261077 refuse an
   * unattributed governed decision at the database. Both are required. Adding a
   * second authorization system to express "human" was considered and rejected
   * — the repository already has this pattern, established by 20261071.
   *
   * It is also NOT the same authority as approving a document or reviewing a
   * tested control. Those are distinct actions with distinct audit events; one
   * human may hold all three, but holding this one performs none of the others.
   */
  | "assurance:review";

export interface SeatScope {
  seatType: SeatType;
  /** The role after clamping to the seat ceiling. */
  effectiveRole: UserRole;
  readScope: ObjectScope;
  writeScope: ObjectScope;
  /** True only for a Full seat holding the admin role. Full ≠ Admin. */
  isAdmin: boolean;
  capabilities: ReadonlySet<Capability>;
}

export interface ResolveOpts {
  /**
   * Per-organization grant: may Viewer-class identities export? Default false —
   * read access never implies bulk export (Phase 6 wires the column).
   */
  viewerExportEnabled?: boolean;
}

const SEAT_TYPES: ReadonlySet<string> = new Set(["full", "contributor", "viewer"]);

/** Normalize an unknown seat string to a valid SeatType. Unknown ⇒ safest. */
export function normalizeSeatType(raw: string | null | undefined): SeatType {
  // Absent seat (API-key auth, or a pre-seat-model row) is Full by convention;
  // an explicitly UNRECOGNISED value fails closed to viewer.
  if (raw === undefined || raw === null || raw === "") return "full";
  return SEAT_TYPES.has(raw) ? (raw as SeatType) : "viewer";
}

/** Legacy 'member' behaves as 'analyst'; unknown roles fail closed to viewer. */
export function normalizeRole(raw: string | null | undefined): UserRole {
  switch (raw) {
    case "admin":
    case "analyst":
    case "viewer":
      return raw;
    case "member":
      return "analyst";
    default:
      return "viewer";
  }
}

/**
 * The whole decision, as a pure function. Deterministic and side-effect free.
 */
export function resolveScope(
  seatTypeRaw: SeatType | string | null | undefined,
  roleRaw: UserRole | string | null | undefined,
  opts: ResolveOpts = {}
): SeatScope {
  const seatType = normalizeSeatType(seatTypeRaw);
  const role = normalizeRole(roleRaw);

  // Clamp role to the seat ceiling.
  const effectiveRole: UserRole =
    seatType === "viewer"
      ? "viewer"
      : seatType === "contributor"
        ? role === "admin"
          ? "analyst" // Contributor can never be admin
          : role
        : role; // full seat: role stands

  const isAdmin = seatType === "full" && effectiveRole === "admin";

  const readScope: ObjectScope = seatType === "contributor" ? "assigned" : "tenant";

  const writeScope: ObjectScope =
    effectiveRole === "viewer"
      ? "none"
      : seatType === "contributor"
        ? "assigned"
        : "tenant";

  const caps = new Set<Capability>();
  if (isAdmin) {
    caps.add("org:configure");
    caps.add("users:manage");
    caps.add("billing:manage");
    caps.add("security:configure");
    caps.add("audit:read");
  }
  // Full-governance identities (tenant write) may accept risk (SoD enforced
  // separately), bulk-export, and review assurance interpretations.
  //
  // `assurance:review` sits with `risk:accept` deliberately: both are governance
  // determinations that a Full/analyst identity makes routinely, neither is an
  // administrative act, and gating assurance review behind `isAdmin` would mean
  // only Org Admins could ever review a SOC 2 report. Viewer and Contributor
  // seats do NOT reach tenant write and therefore do not hold it.
  if (writeScope === "tenant") {
    caps.add("risk:accept");
    caps.add("export:data");
    caps.add("assurance:review");
  } else if (effectiveRole === "viewer" && opts.viewerExportEnabled === true) {
    // Read-only identities export only when the org explicitly grants it.
    caps.add("export:data");
  }

  return { seatType, effectiveRole, readScope, writeScope, isAdmin, capabilities: caps };
}

/** The scope for API-key auth: admin-level, full seat. */
export function scopeForApiKey(): SeatScope {
  return resolveScope("full", "admin");
}

/**
 * Read the resolved scope for a request. An absent seat/role means API-key auth
 * (admin-level). Attached by attachSeatScope so downstream reads one object.
 */
export interface SeatScopeRequestLike {
  userSeatType?: string;
  userRole?: string;
  organizationContext?: { viewerExportEnabled?: boolean | null } | undefined;
}

export function scopeFromRequest(req: SeatScopeRequestLike): SeatScope {
  // No role at all ⇒ API-key auth ⇒ admin-level full seat.
  if (req.userRole === undefined || req.userRole === null) {
    return scopeForApiKey();
  }
  return resolveScope(req.userSeatType, req.userRole, {
    viewerExportEnabled: req.organizationContext?.viewerExportEnabled === true,
  });
}
