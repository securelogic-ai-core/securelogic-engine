/**
 * seatScope.ts (client) — typed consumption of GET /api/me's `seat` block.
 *
 * This is DEFENSE IN DEPTH only: it hides affordances a seat can't use so the
 * UI reads honestly. The server is authoritative — every hidden control is
 * already denied server-side, and showing one changes nothing about what the
 * API permits. Never gate a security decision on this alone.
 *
 * The shape mirrors the server's resolveScope output verbatim so there is one
 * source of truth: the client never re-derives the decision, it reads it.
 */

export type SeatType = "full" | "contributor" | "viewer";
export type ObjectScope = "tenant" | "assigned" | "none";
export type SeatCapability =
  | "org:configure"
  | "users:manage"
  | "billing:manage"
  | "security:configure"
  | "audit:read"
  | "risk:accept"
  | "export:data";

export interface MeSeat {
  seatType: SeatType;
  role: string;
  isAdmin: boolean;
  readScope: ObjectScope;
  writeScope: ObjectScope;
  capabilities: SeatCapability[];
  /** Whether the seat model is enforced in this environment. */
  enforced: boolean;
}

/** True when the seat holds the named capability. */
export function hasCapability(seat: MeSeat | null | undefined, cap: SeatCapability): boolean {
  return !!seat && seat.capabilities.includes(cap);
}

/** True when the seat may perform ANY write (tenant or assigned). */
export function canMutate(seat: MeSeat | null | undefined): boolean {
  return !!seat && seat.writeScope !== "none";
}

/** True for a Contributor seat — the UI should show only assigned work. */
export function isContributor(seat: MeSeat | null | undefined): boolean {
  return seat?.seatType === "contributor";
}

/** True only for a Full seat holding the admin role. Full ≠ Admin. */
export function isOrgAdmin(seat: MeSeat | null | undefined): boolean {
  return !!seat && seat.isAdmin;
}

/**
 * Should a navigation destination be shown for this seat? A conservative
 * default-hide: unknown areas are hidden for Contributors (who see only their
 * own work) and shown for Full/Viewer. Purely cosmetic — the route enforces.
 */
export function canSeeArea(
  seat: MeSeat | null | undefined,
  area: "governance" | "my-work" | "admin" | "dashboards"
): boolean {
  if (!seat || !seat.enforced) return true; // model off ⇒ legacy behaviour
  switch (area) {
    case "admin":
      return seat.isAdmin;
    case "my-work":
      return true; // everyone has their own work / read surface
    case "governance":
      return seat.seatType !== "contributor";
    case "dashboards":
      return seat.seatType !== "contributor"; // contributors see only own work
  }
}
