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
