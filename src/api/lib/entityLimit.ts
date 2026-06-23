import { pg } from "../infra/postgres.js";

/**
 * Monitored-entity metering (PR 2).
 *
 * A "monitored entity" is a row that exists in `vendors` OR `ai_systems` for
 * the org. The combined count is enforced against ONE per-org cap
 * (`organizations.max_monitored_entities`, default 50) — NOT a per-table cap.
 * The rule is intentionally simple and symmetric: a monitored entity is a row
 * that exists; to stop paying for one, delete it. `vendors.status` is NOT part
 * of this count (it keeps its existing archive purpose).
 *
 * Enforced at creation time only (POST /api/vendors, POST /api/ai-systems).
 * Existing over-cap rows are grandfathered — a downgrade lowers the cap but
 * never deletes rows; the next create is simply blocked until the org is back
 * under the cap.
 *
 * The cap above the default is admin-set per contract (sales-led "Platform
 * Scale") via PATCH /admin/organizations/:id — there is no Stripe price for it,
 * and the Stripe webhook only resets the cap on a genuine entitlement-level
 * transition, so an admin-raised cap survives routine renewals.
 */
export interface EntityLimitResult {
  exceeded: boolean;
  used: number;
  cap: number;
}

/**
 * Returns the org's combined monitored-entity count, its cap, and whether a
 * new entity would exceed the cap. Single round-trip: the COUNT of both tables
 * and the cap are read together. Caller (the POST handler) maps
 * `exceeded === true` to a 409 `entity_limit_reached`.
 */
export async function enforceEntityLimit(
  organizationId: string
): Promise<EntityLimitResult> {
  const result = await pg.query<{ used: string; cap: number | null }>(
    `
    SELECT
      (
        (SELECT COUNT(*) FROM vendors    WHERE organization_id = o.id) +
        (SELECT COUNT(*) FROM ai_systems WHERE organization_id = o.id)
      )::text                    AS used,
      o.max_monitored_entities   AS cap
    FROM organizations o
    WHERE o.id = $1
    LIMIT 1
    `,
    [organizationId]
  );

  const row = result.rows[0];
  const used = parseInt(row?.used ?? "0", 10);
  const cap = row?.cap ?? 50;

  return { exceeded: used >= cap, used, cap };
}
