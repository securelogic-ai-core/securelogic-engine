/**
 * vendorRiskScoreRecompute.ts — the ONE way `vendors.current_risk_score` is
 * refreshed from finding state.
 *
 * Before this module the score recomputed only on (a) a new vendor assessment
 * and (b) the manual "Recalculate" endpoint — closing every finding from
 * /findings left the vendor looking exactly as risky as before until someone
 * remembered to click Recalculate (EG2 trust audit, Trap #2). Route hooks now
 * schedule a recompute whenever a vendor-linked finding's lifecycle changes.
 *
 * The finding population is the CANONICAL union the manual endpoint has always
 * used (GET /api/vendors/:id/risk-score): ACTIVE findings from both vendor
 * workflows — `vendor_review` (point-in-time assessments) and
 * `vendor_cycle_review` (review cycles). The assessment-create path previously
 * counted only the first; sharing this module converges both on the same query.
 *
 * Tenancy: `recomputeAndPersistVendorRiskScore` / `resolveVendorIdForFinding`
 * use the ambient `pg` proxy and MUST run inside a tenant scope (a route's
 * asTenant wrap or an explicit withTenant). The `schedule*` variants are for
 * fire-and-forget use from routes: they defer with setImmediate so the
 * request's tenant transaction has committed and released its client (A04-G1
 * γ.3 — never touch the ambient proxy from a macrotask of the request), then
 * open their OWN withTenant scope. Best-effort by contract: a score refresh
 * failure must never fail the mutation that triggered it.
 */
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { computeVendorRiskScore } from "./vendorRiskScore.js";
import { sqlFindingActive } from "./metricDefinitions.js";

export type VendorScoreRecomputeResult = {
  vendor_id: string;
  score: number;
  risk_level: string;
  finding_count: number;
  criticality: string | null;
};

/**
 * Resolve the vendor a finding belongs to via its workflow source record.
 * Returns null for findings that are not vendor-workflow-sourced. Must run
 * inside a tenant scope.
 */
export async function resolveVendorIdForFinding(
  organizationId: string,
  findingId: string
): Promise<string | null> {
  const result = await pg.query<{ vendor_id: string | null }>(
    `
    SELECT COALESCE(va.vendor_id, vr.vendor_id) AS vendor_id
    FROM findings f
    LEFT JOIN vendor_assessments va
      ON f.source_type = 'vendor_review' AND va.id::text = f.source_id::text
     AND va.organization_id = f.organization_id
    LEFT JOIN vendor_reviews vr
      ON f.source_type = 'vendor_cycle_review' AND vr.id::text = f.source_id::text
     AND vr.organization_id = f.organization_id
    WHERE f.id = $1 AND f.organization_id = $2
    `,
    [findingId, organizationId]
  );
  return result.rows[0]?.vendor_id ?? null;
}

/**
 * Recompute the vendor's risk score from the canonical ACTIVE-finding union and
 * persist it. Returns null when the vendor does not exist in the org. Must run
 * inside a tenant scope.
 */
export async function recomputeAndPersistVendorRiskScore(
  organizationId: string,
  vendorId: string
): Promise<VendorScoreRecomputeResult | null> {
  const vendorResult = await pg.query<{ criticality: string | null }>(
    `SELECT criticality FROM vendors WHERE id = $1 AND organization_id = $2`,
    [vendorId, organizationId]
  );
  if ((vendorResult.rowCount ?? 0) === 0) return null;
  const criticality = vendorResult.rows[0]!.criticality;

  const findingsResult = await pg.query<{ severity: string; status: string }>(
    `
    SELECT f.severity, f.status
    FROM findings f
    JOIN vendor_assessments va
      ON va.id::text = f.source_id::text
      AND f.source_type = 'vendor_review'
    WHERE va.vendor_id = $1
      AND f.organization_id = $2
      AND ${sqlFindingActive("f.operational_status")}

    UNION ALL

    SELECT f.severity, f.status
    FROM findings f
    JOIN vendor_reviews vr
      ON vr.id::text = f.source_id::text
      AND f.source_type = 'vendor_cycle_review'
    WHERE vr.vendor_id = $1
      AND f.organization_id = $2
      AND ${sqlFindingActive("f.operational_status")}
    `,
    [vendorId, organizationId]
  );

  const { score, risk_level } = computeVendorRiskScore(
    criticality,
    findingsResult.rows
  );

  await pg.query(
    `UPDATE vendors SET current_risk_score = $1, updated_at = NOW()
     WHERE id = $2 AND organization_id = $3`,
    [score, vendorId, organizationId]
  );

  return {
    vendor_id: vendorId,
    score,
    risk_level,
    finding_count: findingsResult.rowCount ?? 0,
    criticality,
  };
}

/** Fire-and-forget recompute for a KNOWN vendor (post-commit, own tenant scope). */
export function scheduleVendorScoreRecompute(
  organizationId: string,
  vendorId: string
): void {
  setImmediate(() => {
    void withTenant(organizationId, async () => {
      await recomputeAndPersistVendorRiskScore(organizationId, vendorId);
    }).catch((err) => {
      logger.warn(
        { event: "vendor_score_recompute_failed", organizationId, vendorId, err },
        "Vendor risk score recompute failed (non-fatal)"
      );
    });
  });
}

/**
 * Fire-and-forget recompute for whatever vendor a finding belongs to.
 * No-op for findings that are not vendor-workflow-sourced — callers may invoke
 * it unconditionally after any finding lifecycle change.
 */
export function scheduleVendorScoreRecomputeForFinding(
  organizationId: string,
  findingId: string
): void {
  setImmediate(() => {
    void withTenant(organizationId, async () => {
      const vendorId = await resolveVendorIdForFinding(organizationId, findingId);
      if (vendorId === null) return;
      await recomputeAndPersistVendorRiskScore(organizationId, vendorId);
    }).catch((err) => {
      logger.warn(
        { event: "vendor_score_recompute_failed", organizationId, findingId, err },
        "Vendor risk score recompute failed (non-fatal)"
      );
    });
  });
}
