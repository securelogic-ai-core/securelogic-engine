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
  | "export:data"; // bulk export of tenant data

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
  // separately) and bulk-export.
  if (writeScope === "tenant") {
    caps.add("risk:accept");
    caps.add("export:data");
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
