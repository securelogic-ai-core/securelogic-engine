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
 * The finding population is the CANONICAL set of ACTIVE findings linked to the
 * vendor by ANY of the three vendor->finding relationships — point-in-time
 * assessments, review cycles, and Vendor Assurance CUEC promotions — as defined
 * once in `vendorFindingLinkage.ts`. The assessment-create path once counted
 * only the first of those, and the CUEC arm was missing entirely; sharing one
 * definition is what stops the set from drifting per reader again.
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
import {
  VENDOR_FINDING_LINKAGE_SQL,
  VENDOR_FINDING_EDGES_SQL,
  vendorFindingLinkagePriority,
} from "./vendorFindingLinkage.js";

export type VendorScoreRecomputeResult = {
  vendor_id: string;
  score: number;
  risk_level: string;
  finding_count: number;
  criticality: string | null;
};

/**
 * Resolve the vendor a finding belongs to via `vendorFindingLinkage`.
 * Returns null for findings that are not vendor-workflow-sourced. Must run
 * inside a tenant scope.
 *
 * This used to join `vendor_assessments` / `vendor_reviews` on `source_id`
 * directly, which returned NULL for every CUEC-promoted Vendor Assurance
 * finding — so no recompute was ever scheduled for one. Null is an ordinary
 * outcome here (most findings are not vendor findings), which is exactly why
 * the omission was silent: nothing distinguished "not a vendor finding" from
 * "vendor finding we failed to resolve".
 */
export async function resolveVendorIdForFinding(
  organizationId: string,
  findingId: string
): Promise<string | null> {
  const result = await pg.query<{ vendor_id: string | null }>(
    `
    SELECT l.vendor_id
      FROM (${VENDOR_FINDING_LINKAGE_SQL}) l
     WHERE l.finding_id      = $1
       AND l.organization_id = $2
     ORDER BY ${vendorFindingLinkagePriority("l.linkage")}
     LIMIT 1
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

  // The canonical ACTIVE-finding population for this vendor, over ALL THREE
  // vendor->finding relationships. This is the SECOND, INDEPENDENT exclusion the
  // CUEC defect had: even once a recompute is triggered by some other finding on
  // the same vendor, a scoring query that joins vendor_assessments on source_id
  // drops every CUEC-promoted gap from the input. Fixing the resolver alone left
  // the score exactly where it was.
  //
  // EDGES, not the full linkage: one row per (finding, vendor), so a finding can
  // never contribute its severity to the same vendor twice.
  const findingsResult = await pg.query<{ severity: string; status: string }>(
    `
    SELECT f.severity, f.status
      FROM findings f
      JOIN (${VENDOR_FINDING_EDGES_SQL}) l
        ON l.finding_id      = f.id
       AND l.organization_id = f.organization_id
     WHERE l.vendor_id       = $1
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
