/**
 * vendorRiskHistoryStore.ts — VA-7: persist a per-vendor daily risk capture
 * into vendor_risk_snapshots (20261045), and read it back as a trend series.
 *
 * The vendor twin of riskHistoryStore.ts: derived + recomputable for TODAY
 * only — `vendors.current_risk_score` is overwritten in place on every
 * recompute, so the snapshot rows are the ONLY record of past state and the
 * series can only accumulate forward. Upserted per (org, vendor, day) so a
 * same-day re-run refreshes rather than duplicates (the riskHistoryStore
 * convention).
 *
 * Polarity (docs/scoring-vocabulary; 20260919_vendor_engagements.sql header):
 *   legacy_risk_score              — HIGHER = BETTER (frozen legacy formula)
 *   residual_score/residual_rating — HIGHER = WORSE (risk-register polarity)
 * Both are captured, neither is ever blended into the other.
 *
 * Tenancy: every export here uses the ambient `pg` proxy and MUST run inside a
 * tenant scope (a route's asTenant wrap or the worker's per-org withTenant) —
 * the same discipline as riskHistoryStore.ts. Cross-org enumeration lives in
 * the worker, on the elevated channel, never here.
 */

import { pg } from "../infra/postgres.js";
import { sqlFindingActive } from "./metricDefinitions.js";

/**
 * The three vendor→finding edges, as one UNION ALL over the canonical Active
 * population. This is the SAME union vendorRiskScoreRecompute.ts scores from,
 * extended with the engagement edge (findings.source_type =
 * 'vendor_engagement', source_id = vendor_engagements.id — the promotion
 * writer in routes/vendorEngagements.ts): a promoted engagement finding is a
 * vendor finding and must not vanish from the count.
 *
 * NOTE (convergence follow-up): a shared VENDOR_FINDING_EDGES_SQL module is in
 * flight on fix/vendor-cuec-finding-linkage. When that branch lands, this
 * builder and vendorRiskScoreRecompute.ts should both import it so the edge
 * set can never diverge again.
 *
 * `vendorIdRef` / `orgIdRef` are SQL expressions (e.g. "v.id", "$1") — never
 * user input. `findingCols` selects from alias `f`.
 */
export function sqlVendorActiveFindingEdges(
  vendorIdRef: string,
  orgIdRef: string,
  findingCols = "f.id"
): string {
  const active = sqlFindingActive("f.operational_status");
  const leg = (sourceType: string, table: string, alias: string) => `
      SELECT ${findingCols}
        FROM findings f
        JOIN ${table} ${alias}
          ON ${alias}.id::text = f.source_id::text
         AND ${alias}.organization_id = f.organization_id
       WHERE f.source_type = '${sourceType}'
         AND ${alias}.vendor_id = ${vendorIdRef}
         AND f.organization_id = ${orgIdRef}
         AND ${active}`;
  return [
    leg("vendor_review", "vendor_assessments", "va"),
    leg("vendor_cycle_review", "vendor_reviews", "vr"),
    leg("vendor_engagement", "vendor_engagements", "ve"),
  ].join("\n      UNION ALL\n");
}

/** One point of a vendor's risk trend series (a vendor_risk_snapshots row). */
export interface VendorRiskTrendPoint {
  captured_on: string; // YYYY-MM-DD
  /** HIGHER = BETTER (legacy polarity). null = unscored that day, never 0. */
  score: number | null;
  criticality: string | null;
  active_findings_count: number;
  /** HIGHER = WORSE (risk-register polarity). */
  residual_rating: string | null;
  residual_score: number | null;
}

/**
 * Capture every non-archived vendor in the org for `capturedOn` (YYYY-MM-DD).
 * One set-based upsert: per vendor, the legacy score + criticality as they
 * stand, the canonical Active linked-finding count over all three edges, and
 * the latest engagement residual (latest = most recent residual_computed_at,
 * falling back to created_at, over non-cancelled engagements that actually
 * have a residual — a cancelled engagement's residual does not describe the
 * vendor). Archived vendors stop accruing points; their history stays.
 *
 * Idempotent per day (ON CONFLICT DO UPDATE — same-day re-runs refresh).
 * Returns the number of vendor rows captured. Must run inside a tenant scope.
 */
export async function snapshotVendorRiskForOrg(
  organizationId: string,
  capturedOn: string
): Promise<number> {
  const result = await pg.query(
    `INSERT INTO vendor_risk_snapshots
       (organization_id, vendor_id, captured_on, legacy_risk_score, criticality,
        active_findings_count, residual_rating, residual_score)
     SELECT
       v.organization_id,
       v.id,
       $2::date,
       v.current_risk_score,
       v.criticality,
       (SELECT count(*)::int FROM (${sqlVendorActiveFindingEdges("v.id", "v.organization_id")}) linked),
       le.residual_rating,
       le.residual_score
     FROM vendors v
     LEFT JOIN LATERAL (
       SELECT ve.residual_rating, ve.residual_score
         FROM vendor_engagements ve
        WHERE ve.vendor_id = v.id
          AND ve.organization_id = v.organization_id
          AND ve.residual_rating IS NOT NULL
          AND ve.status <> 'cancelled'
        ORDER BY COALESCE(ve.residual_computed_at, ve.created_at) DESC
        LIMIT 1
     ) le ON true
     WHERE v.organization_id = $1
       AND v.status <> 'archived'
     ON CONFLICT (organization_id, vendor_id, captured_on)
     DO UPDATE SET
       legacy_risk_score     = EXCLUDED.legacy_risk_score,
       criticality           = EXCLUDED.criticality,
       active_findings_count = EXCLUDED.active_findings_count,
       residual_rating       = EXCLUDED.residual_rating,
       residual_score        = EXCLUDED.residual_score,
       updated_at            = NOW()`,
    [organizationId, capturedOn]
  );
  return result.rowCount ?? 0;
}

/**
 * Read a vendor's trend for the trailing `days` window (inclusive of today),
 * date-ascending. An empty array means NO snapshots exist for the window —
 * the honest empty state; it is never padded with zeros. Tenant-scoped;
 * `days` is bounded by the caller (the route).
 */
export async function readVendorRiskTrend(
  organizationId: string,
  vendorId: string,
  days: number
): Promise<VendorRiskTrendPoint[]> {
  const result = await pg.query<VendorRiskTrendPoint>(
    `SELECT captured_on::text          AS captured_on,
            legacy_risk_score::float8  AS score,
            criticality,
            active_findings_count,
            residual_rating,
            residual_score
       FROM vendor_risk_snapshots
      WHERE organization_id = $1
        AND vendor_id = $2
        AND captured_on >= (CURRENT_DATE - ($3::int - 1))
      ORDER BY captured_on ASC`,
    [organizationId, vendorId, days]
  );
  return result.rows;
}
