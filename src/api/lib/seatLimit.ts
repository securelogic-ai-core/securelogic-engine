import { pg } from "../infra/postgres.js";

/**
 * Seat metering — companion to entityLimit.ts.
 *
 * A "seat" is an active member: a row in `users` with status='active' for the
 * org. The combined count is enforced against ONE per-org cap
 * (`organizations.max_members`, default 6). Enforced at EVERY user-creation
 * path — team-invite acceptance (teamInvites.ts) AND SSO JIT provisioning
 * (sso.ts). A cap that is bypassable on one creation path is not a cap.
 *
 * Cap sources (#692 A8 — matches the advertised model on both pricing
 * surfaces): Free / Pro / Brief Team are "up to 6 seats" (= the default, no
 * raise needed). Platform Professional is sold self-serve as "Up to 10 seats
 * / 50 monitored entities", so a platform-tier Stripe grant raises
 * max_members to >= 10 in the webhook (GREATEST — mirror of the entity-cap
 * raise, same never-lower semantics across renewals and past_due dips).
 * Anything above that is admin-set per contract (Enterprise, sales-led) via
 * PATCH /admin/organizations/:id; an admin-set cap is never lowered by a
 * Stripe event. (An earlier model had NO self-serve tier above 6 and the
 * webhook deliberately never raised seats — that comment predated the
 * 10-seat Platform copy and was the D-2-class drift behind sold-10/capped-6.)
 *
 * Existing over-cap members are grandfathered if a cap is later lowered — no
 * member is removed; the next create is simply blocked until the org is back
 * under the cap.
 */
export interface SeatLimitResult {
  exceeded: boolean;
  used: number;
  cap: number;
}

/** Per-org seat cap when `organizations.max_members` is unset. */
export const DEFAULT_MAX_SEATS = 6;

/**
 * Returns the org's active-member count, its seat cap, and whether adding one
 * more member would exceed the cap. Single round-trip. The caller maps
 * `exceeded === true` to a seat rejection — a 409 `seat_limit_reached` on the
 * invite path, an error redirect on the SSO callback path.
 */
export async function enforceSeatLimit(
  organizationId: string
): Promise<SeatLimitResult> {
  const result = await pg.query<{ used: string; cap: number | null }>(
    `
    SELECT
      (SELECT COUNT(*) FROM users
        WHERE organization_id = o.id AND status = 'active')::text AS used,
      o.max_members AS cap
    FROM organizations o
    WHERE o.id = $1
    LIMIT 1
    `,
    [organizationId]
  );

  const row = result.rows[0];
  const used = parseInt(row?.used ?? "0", 10);
  const cap = row?.cap ?? DEFAULT_MAX_SEATS;

  return { exceeded: used >= cap, used, cap };
}

// ---------------------------------------------------------------------------
// Per-class seat metering (enterprise seat program — Phase 1)
//
// Seats now have a CLASS: 'full' (paid governance), 'contributor' (included,
// scoped) and 'viewer' (included, read-only). Each class has its own cap.
//
// This block is ADDITIVE. The whole-org enforceSeatLimit above is unchanged and
// still counts every active member against organizations.max_members — which is
// correct today because every existing user is 'full'. Per-class ENFORCEMENT at
// the creation paths lands in Phase 4; these helpers are the machinery it uses.
// ---------------------------------------------------------------------------

export type SeatClass = "full" | "contributor" | "viewer";

/**
 * Default cap multipliers over purchased Full seats, with floors (approved
 * commercial defaults). Consulted only when an org has no explicit per-class
 * cap set — the value is computed, never hard-coded per call site.
 */
export const CONTRIBUTOR_SEAT_MULTIPLIER = 10;
export const CONTRIBUTOR_SEAT_FLOOR = 50;
export const VIEWER_SEAT_MULTIPLIER = 5;
export const VIEWER_SEAT_FLOOR = 25;

/**
 * The default cap for a seat class, derived from the org's Full-seat cap.
 * Pure and total — unit-testable with no I/O.
 *   full        → the Full cap itself (the purchased number)
 *   contributor → max(floor, multiplier × full)
 *   viewer      → max(floor, multiplier × full)
 */
export function computeDefaultSeatCap(seatClass: SeatClass, fullSeatCap: number): number {
  switch (seatClass) {
    case "full":
      return fullSeatCap;
    case "contributor":
      return Math.max(CONTRIBUTOR_SEAT_FLOOR, CONTRIBUTOR_SEAT_MULTIPLIER * fullSeatCap);
    case "viewer":
      return Math.max(VIEWER_SEAT_FLOOR, VIEWER_SEAT_MULTIPLIER * fullSeatCap);
  }
}

/**
 * Resolve the effective cap for a class from the org's stored values.
 * An explicit per-class column wins; NULL falls back to the computed default.
 * Pure — the caller supplies the three stored numbers.
 */
export function resolveSeatCap(
  seatClass: SeatClass,
  org: {
    maxMembers: number | null;
    maxContributorSeats: number | null;
    maxViewerSeats: number | null;
  }
): number {
  const fullCap = org.maxMembers ?? DEFAULT_MAX_SEATS;
  if (seatClass === "full") return fullCap;
  const explicit =
    seatClass === "contributor" ? org.maxContributorSeats : org.maxViewerSeats;
  return explicit ?? computeDefaultSeatCap(seatClass, fullCap);
}

export interface SeatClassLimitResult extends SeatLimitResult {
  seatClass: SeatClass;
}

/**
 * Count active members of ONE seat class against that class's effective cap.
 * Single round-trip. Mirrors enforceSeatLimit's contract per class; callers map
 * exceeded===true to a class-specific rejection (Phase 4).
 */
export async function enforceSeatLimitForClass(
  organizationId: string,
  seatClass: SeatClass
): Promise<SeatClassLimitResult> {
  const result = await pg.query<{
    used: string;
    max_members: number | null;
    max_contributor_seats: number | null;
    max_viewer_seats: number | null;
  }>(
    `
    SELECT
      (SELECT COUNT(*) FROM users
        WHERE organization_id = o.id AND status = 'active' AND seat_type = $2)::text AS used,
      o.max_members,
      o.max_contributor_seats,
      o.max_viewer_seats
    FROM organizations o
    WHERE o.id = $1
    LIMIT 1
    `,
    [organizationId, seatClass]
  );

  const row = result.rows[0];
  const used = parseInt(row?.used ?? "0", 10);
  const cap = resolveSeatCap(seatClass, {
    maxMembers: row?.max_members ?? null,
    maxContributorSeats: row?.max_contributor_seats ?? null,
    maxViewerSeats: row?.max_viewer_seats ?? null,
  });

  return { exceeded: used >= cap, used, cap, seatClass };
}
