import { pg } from "../infra/postgres.js";

/**
 * Seat metering — companion to entityLimit.ts.
 *
 * A "seat" is an active member: a row in `users` with status='active' for the
 * org. The combined count is enforced against ONE per-org cap
 * (`organizations.max_members`, default 10). Enforced at EVERY user-creation
 * path — team-invite acceptance (teamInvites.ts) AND SSO JIT provisioning
 * (sso.ts). A cap that is bypassable on one creation path is not a cap.
 *
 * The cap above the default 10 is admin-set per contract (sales-led). The
 * locked pricing is: Free / Pro / Team are all "up to 10 seats" (= the default,
 * no raise needed), and Platform / Enterprise — "Unlimited seats", Custom /
 * invoice billing — are provisioned by an operator via
 * PATCH /admin/organizations/:id. Because NO self-serve Stripe tier exceeds 10
 * seats, the Stripe webhook deliberately does NOT auto-raise max_members
 * (unlike the entity cap, which a paid subscription raises to >= 50). Seat
 * allocation above the default is therefore an explicit operator action; an
 * admin-set cap is never lowered by a Stripe event.
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
export const DEFAULT_MAX_SEATS = 10;

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
