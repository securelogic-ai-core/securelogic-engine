import { pg } from "../infra/postgres.js";

/**
 * Enterprise Context Layer (ECL) capacity metering — Priority-5 Slice 1.
 *
 * A per-org cap on rows in `enterprise_entities`, enforced at the ECL write path
 * (POST /api/enterprise-entities) → 409 `enterprise_entity_limit_reached`.
 *
 * This is a SEPARATE counter from the monitored-entity cap (enforceEntityLimit /
 * organizations.max_monitored_entities). Per the S0 decision (2026-07-03) ECL
 * entities do NOT count toward max_monitored_entities and this code MUST NOT read
 * or modify vendors / ai_systems / enforceEntityLimit. The cap lives in
 * `organizations.max_enterprise_entities` (default 1000, operator-tunable per org
 * via UPDATE with no DDL).
 *
 * Enforced at creation time only. Existing over-cap rows are grandfathered — if the
 * cap is later lowered below the current count (an operator action), no rows are
 * deleted; the next create is simply blocked until the org is back under the cap.
 * Mirrors the SHAPE of entityLimit.ts without importing or extending it.
 */
export interface EnterpriseEntityLimitResult {
  exceeded: boolean;
  used: number;
  cap: number;
}

/**
 * Returns the org's enterprise_entities count, its cap, and whether a new entity
 * would exceed the cap. Single round-trip. Caller (the POST handler) maps
 * `exceeded === true` to a 409 `enterprise_entity_limit_reached`.
 */
export async function enforceEnterpriseEntityLimit(
  organizationId: string
): Promise<EnterpriseEntityLimitResult> {
  const result = await pg.query<{ used: string; cap: number | null }>(
    `
    SELECT
      (SELECT COUNT(*) FROM enterprise_entities WHERE organization_id = o.id)::text
                                   AS used,
      o.max_enterprise_entities    AS cap
    FROM organizations o
    WHERE o.id = $1
    LIMIT 1
    `,
    [organizationId]
  );

  const row = result.rows[0];
  const used = parseInt(row?.used ?? "0", 10);
  const cap = row?.cap ?? 1000;

  return { exceeded: used >= cap, used, cap };
}
