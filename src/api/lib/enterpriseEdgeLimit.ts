import { pg } from "../infra/postgres.js";

/**
 * Enterprise Context Layer (ECL) edge-capacity metering — Priority-5 Item 9 (H1).
 *
 * A per-org cap on live rows in `enterprise_relationships`, enforced at the edge-create
 * path (POST /api/enterprise-relationships) → 409 `enterprise_edge_limit_reached`.
 * Closes the H1 prod-enable gate (edge writes were previously unmetered).
 *
 * SEPARATE counter from both max_monitored_entities (enforceEntityLimit — untouched) and
 * max_enterprise_entities (enforceEnterpriseEntityLimit). Cap lives in
 * `organizations.max_enterprise_edges` (default 50000 per the GATE A ruling,
 * operator-tunable per org via UPDATE, no DDL). Counts only non-soft-deleted edges.
 *
 * Enforced at creation only; existing over-cap rows are grandfathered (lowering the cap
 * never deletes edges — the next create is simply blocked until back under the cap).
 * Mirrors the SHAPE of enterpriseEntityLimit.ts without importing or extending it.
 */
export interface EnterpriseEdgeLimitResult {
  exceeded: boolean;
  used: number;
  cap: number;
}

export async function enforceEnterpriseEdgeLimit(
  organizationId: string
): Promise<EnterpriseEdgeLimitResult> {
  const result = await pg.query<{ used: string; cap: number | null }>(
    `
    SELECT
      (SELECT COUNT(*) FROM enterprise_relationships
        WHERE organization_id = o.id AND deleted_at IS NULL)::text AS used,
      o.max_enterprise_edges                                        AS cap
    FROM organizations o
    WHERE o.id = $1
    LIMIT 1
    `,
    [organizationId]
  );

  const row = result.rows[0];
  const used = parseInt(row?.used ?? "0", 10);
  const cap = row?.cap ?? 50000;

  return { exceeded: used >= cap, used, cap };
}
