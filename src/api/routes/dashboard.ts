/**
 * dashboard.ts — Cross-domain summary dashboard API
 *
 * Delivers a single read-only endpoint that returns a cross-domain summary
 * of the organization's current posture state, domain breakdown, finding
 * counts, action counts, and object inventory counts for all live entity types.
 *
 * All data is read from existing tables. No computation is performed beyond
 * aggregation queries. No new DB migration is required.
 *
 * Routes:
 *   GET /api/dashboard/summary
 *
 * Null posture rule: if no posture_snapshot row exists for the org,
 * posture.overall_score, posture.overall_severity, and posture.snapshot_date
 * are all null, and domains is []. This is not an error condition — 200 is
 * returned so clients can render a "no data yet" state without error handling.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { buildEvidenceSummary } from "./evidence.js";

const router = Router();

// ---------------------------------------------------------------------------
// Pure helper — exported for unit testing
//
// Route files import pg at module load; tests cannot import route files
// directly without DATABASE_URL. Tests use vi.mock("../infra/postgres.js")
// to prevent module evaluation from throwing, then import this export.
// ---------------------------------------------------------------------------

/**
 * Build the inventory object from a DB row.
 * All counts default to 0 when the row is absent.
 * Exported for unit testing.
 */
export function buildInventory(row: {
  vendors: string;
  ai_systems: string;
  controls: string;
  control_assessments: string;
  governance_reviews: string;
  risks: string;
  dependencies: string;
  obligations: string;
  frameworks?: string;
} | null | undefined): {
  vendors: number;
  ai_systems: number;
  controls: number;
  control_assessments: number;
  governance_reviews: number;
  risks: number;
  dependencies: number;
  obligations: number;
  frameworks: number;
} {
  if (!row) {
    return {
      vendors: 0,
      ai_systems: 0,
      controls: 0,
      control_assessments: 0,
      governance_reviews: 0,
      risks: 0,
      dependencies: 0,
      obligations: 0,
      frameworks: 0
    };
  }
  return {
    vendors: parseInt(row.vendors, 10),
    ai_systems: parseInt(row.ai_systems, 10),
    controls: parseInt(row.controls, 10),
    control_assessments: parseInt(row.control_assessments, 10),
    governance_reviews: parseInt(row.governance_reviews, 10),
    risks: parseInt(row.risks, 10),
    dependencies: parseInt(row.dependencies, 10),
    obligations: parseInt(row.obligations, 10),
    frameworks: row.frameworks !== undefined ? parseInt(row.frameworks, 10) : 0
  };
}

/**
 * Build the by_severity map and total open finding count from DB aggregate rows.
 * Always returns all four canonical severity keys; missing severities default to 0.
 * Rows with unrecognised severity values are counted in open but not in any bucket.
 */
export function buildFindingsBySeverity(
  rows: ReadonlyArray<{ severity: string; count: string }>
): { by_severity: Record<string, number>; open: number } {
  const by_severity: Record<string, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0
  };
  let open = 0;
  for (const row of rows) {
    const n = parseInt(row.count, 10);
    if (row.severity in by_severity) {
      by_severity[row.severity] = n;
    }
    open += n;
  }
  return { by_severity, open };
}

/* =========================================================
   GET /api/dashboard/summary
   Returns a cross-domain posture summary for the calling org.
   ========================================================= */

router.get(
  "/dashboard/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      // -------------------------------------------------------
      // 1. Most recent posture snapshot
      // -------------------------------------------------------
      const snapshotResult = await pg.query<{
        id: string;
        overall_score: number | null;
        overall_severity: string | null;
        snapshot_date: string | null;
      }>(
        `
        SELECT id, overall_score, overall_severity, snapshot_date
        FROM posture_snapshots
        WHERE organization_id = $1
        ORDER BY snapshot_date DESC
        LIMIT 1
        `,
        [organizationId]
      );

      const snapshotRow =
        (snapshotResult.rowCount ?? 0) > 0 ? snapshotResult.rows[0]! : null;

      // -------------------------------------------------------
      // 2. Domain scores for that snapshot (empty if no snapshot)
      // -------------------------------------------------------
      let domainRows: Array<{
        domain: string;
        score: number | null;
        severity: string | null;
        finding_count: number;
        action_count: number;
        trend_direction: string | null;
      }> = [];

      if (snapshotRow !== null) {
        const domainResult = await pg.query<{
          domain: string;
          score: number | null;
          severity: string | null;
          finding_count: number;
          action_count: number;
          trend_direction: string | null;
        }>(
          `
          SELECT domain, score, severity, finding_count, action_count,
                 trend_direction
          FROM domain_scores
          WHERE posture_snapshot_id = $1
          ORDER BY
            CASE severity
              WHEN 'Critical' THEN 1
              WHEN 'High'     THEN 2
              WHEN 'Moderate' THEN 3
              WHEN 'Low'      THEN 4
              ELSE 5
            END,
            domain ASC
          `,
          [snapshotRow.id]
        );
        domainRows = domainResult.rows;
      }

      // -------------------------------------------------------
      // 3. Finding counts — open findings by severity
      // -------------------------------------------------------
      const findingCountResult = await pg.query<{
        severity: string;
        count: string;
      }>(
        `
        SELECT severity, COUNT(*)::text AS count
        FROM findings
        WHERE organization_id = $1
          AND status = 'open'
        GROUP BY severity
        `,
        [organizationId]
      );

      const { by_severity: bySeverity, open: totalOpenFindings } =
        buildFindingsBySeverity(findingCountResult.rows);

      // -------------------------------------------------------
      // 3b. Findings aging — avg/max age and bucket counts
      // -------------------------------------------------------
      const findingsAgingResult = await pg.query<{
        avg_age_days: string | null;
        max_age_days: string | null;
        older_than_30: string;
        older_than_7:  string;
      }>(
        `
        SELECT
          ROUND(AVG(
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400
          ) FILTER (
            WHERE status NOT IN ('resolved', 'closed', 'accepted')
          ))::text AS avg_age_days,
          MAX(
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400
          )::int FILTER (
            WHERE status NOT IN ('resolved', 'closed', 'accepted')
          )::text AS max_age_days,
          COUNT(*) FILTER (
            WHERE status NOT IN ('resolved', 'closed', 'accepted')
              AND created_at < NOW() - INTERVAL '30 days'
          )::text AS older_than_30,
          COUNT(*) FILTER (
            WHERE status NOT IN ('resolved', 'closed', 'accepted')
              AND created_at <  NOW() - INTERVAL '7 days'
              AND created_at >= NOW() - INTERVAL '30 days'
          )::text AS older_than_7
        FROM findings
        WHERE organization_id = $1
        `,
        [organizationId]
      );

      const findingsAgingRow = findingsAgingResult.rows[0];
      const findingsAvgAge     = findingsAgingRow?.avg_age_days != null ? parseFloat(findingsAgingRow.avg_age_days) : null;
      const findingsMaxAge     = findingsAgingRow?.max_age_days != null ? parseInt(findingsAgingRow.max_age_days, 10) : null;
      const findingsOlderThan30 = parseInt(findingsAgingRow?.older_than_30 ?? "0", 10);
      const findingsOlderThan7  = parseInt(findingsAgingRow?.older_than_7  ?? "0", 10);

      // -------------------------------------------------------
      // 4. Action counts — open, overdue, and aging
      // -------------------------------------------------------
      const actionCountResult = await pg.query<{
        open_count: string;
        in_progress_count: string;
        overdue_count: string;
        avg_age_days: string | null;
        max_age_days: string | null;
        older_than_30: string;
        older_than_7:  string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'open')::text        AS open_count,
          COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress_count,
          COUNT(*) FILTER (
            WHERE due_date < CURRENT_DATE
              AND status NOT IN ('closed', 'accepted')
          )::text AS overdue_count,
          ROUND(AVG(
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400
          ) FILTER (
            WHERE status NOT IN ('closed', 'accepted')
          ))::text AS avg_age_days,
          MAX(
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400
          )::int FILTER (
            WHERE status NOT IN ('closed', 'accepted')
          )::text AS max_age_days,
          COUNT(*) FILTER (
            WHERE status NOT IN ('closed', 'accepted')
              AND created_at < NOW() - INTERVAL '30 days'
          )::text AS older_than_30,
          COUNT(*) FILTER (
            WHERE status NOT IN ('closed', 'accepted')
              AND created_at <  NOW() - INTERVAL '7 days'
              AND created_at >= NOW() - INTERVAL '30 days'
          )::text AS older_than_7
        FROM actions
        WHERE organization_id = $1
          AND status NOT IN ('closed', 'accepted')
        `,
        [organizationId]
      );

      const actionRow = actionCountResult.rows[0];
      const openActionCount        = actionRow ? parseInt(actionRow.open_count, 10)        : 0;
      const inProgressActionCount  = actionRow ? parseInt(actionRow.in_progress_count, 10) : 0;
      const overdueActionCount     = actionRow ? parseInt(actionRow.overdue_count, 10)      : 0;
      const actionsAvgAge          = actionRow?.avg_age_days != null ? parseFloat(actionRow.avg_age_days) : null;
      const actionsMaxAge          = actionRow?.max_age_days != null ? parseInt(actionRow.max_age_days, 10) : null;
      const actionsOlderThan30     = parseInt(actionRow?.older_than_30 ?? "0", 10);
      const actionsOlderThan7      = parseInt(actionRow?.older_than_7  ?? "0", 10);

      // -------------------------------------------------------
      // 4b. Overdue controls count
      // -------------------------------------------------------
      const overdueControlsResult = await pg.query<{ overdue_count: string }>(
        `
        SELECT COUNT(*)::text AS overdue_count
        FROM controls
        WHERE organization_id = $1
          AND next_test_due IS NOT NULL
          AND next_test_due < CURRENT_DATE
          AND testing_frequency IS NOT NULL
          AND testing_frequency != 'ad_hoc'
        `,
        [organizationId]
      );
      const overdueControlsCount = parseInt(
        overdueControlsResult.rows[0]?.overdue_count ?? "0",
        10
      );

      // -------------------------------------------------------
      // 5a. Open risk counts by rating
      // -------------------------------------------------------
      const riskCountResult = await pg.query<{
        risk_rating: string;
        count: string;
      }>(
        `
        SELECT risk_rating, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND status NOT IN ('closed', 'transferred')
        GROUP BY risk_rating
        `,
        [organizationId]
      );

      const openRisksByRating: Record<string, number> = {
        Critical: 0,
        High: 0,
        Moderate: 0,
        Low: 0
      };
      let totalOpenRisks = 0;
      for (const row of riskCountResult.rows) {
        if (row.risk_rating in openRisksByRating) {
          const n = parseInt(row.count, 10);
          openRisksByRating[row.risk_rating] = n;
          totalOpenRisks += n;
        }
      }

      // -------------------------------------------------------
      // 5b. Open risk counts by domain
      // -------------------------------------------------------
      const riskByDomainResult = await pg.query<{
        domain: string | null;
        count: string;
      }>(
        `
        SELECT domain, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND status NOT IN ('closed', 'transferred')
          AND domain IS NOT NULL
        GROUP BY domain
        `,
        [organizationId]
      );

      const openRisksByDomain: Record<string, number> = {};
      for (const row of riskByDomainResult.rows) {
        if (row.domain) {
          openRisksByDomain[row.domain] = parseInt(row.count, 10);
        }
      }

      // -------------------------------------------------------
      // 5c. Open risk counts by likelihood × impact (heatmap)
      // -------------------------------------------------------
      const riskHeatmapResult = await pg.query<{
        likelihood: string;
        impact: string;
        count: string;
      }>(
        `
        SELECT likelihood, impact, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND status NOT IN ('closed', 'transferred')
          AND likelihood IS NOT NULL
          AND impact IS NOT NULL
        GROUP BY likelihood, impact
        `,
        [organizationId]
      );

      const byLikelihoodImpact = riskHeatmapResult.rows.map((row) => ({
        likelihood: row.likelihood,
        impact:     row.impact,
        count:      parseInt(row.count, 10),
      }));

      // -------------------------------------------------------
      // 5. Object inventory counts — all live entity types
      // -------------------------------------------------------
      const inventoryResult = await pg.query<{
        vendors: string;
        ai_systems: string;
        controls: string;
        control_assessments: string;
        governance_reviews: string;
        risks: string;
        dependencies: string;
        obligations: string;
        frameworks: string;
      }>(
        `
        SELECT
          (SELECT COUNT(*)::text FROM vendors             WHERE organization_id = $1) AS vendors,
          (SELECT COUNT(*)::text FROM ai_systems          WHERE organization_id = $1) AS ai_systems,
          (SELECT COUNT(*)::text FROM controls            WHERE organization_id = $1) AS controls,
          (SELECT COUNT(*)::text FROM control_assessments WHERE organization_id = $1) AS control_assessments,
          (SELECT COUNT(*)::text FROM governance_reviews  WHERE organization_id = $1) AS governance_reviews,
          (SELECT COUNT(*)::text FROM risks               WHERE organization_id = $1) AS risks,
          (SELECT COUNT(*)::text FROM dependencies        WHERE organization_id = $1) AS dependencies,
          (SELECT COUNT(*)::text FROM obligations         WHERE organization_id = $1) AS obligations,
          (SELECT COUNT(*)::text FROM frameworks          WHERE organization_id = $1) AS frameworks
        `,
        [organizationId]
      );

      const inventory = buildInventory(inventoryResult.rows[0]);

      // -------------------------------------------------------
      // 6. Evidence counts by source_type
      // -------------------------------------------------------
      const evidenceCountResult = await pg.query<{
        source_type: string;
        count: string;
      }>(
        `
        SELECT source_type, COUNT(*)::text AS count
        FROM evidence
        WHERE organization_id = $1
        GROUP BY source_type
        `,
        [organizationId]
      );

      const evidenceSummary = buildEvidenceSummary(evidenceCountResult.rows);

      // -------------------------------------------------------
      // 7. Open dependency counts by criticality
      // -------------------------------------------------------
      const depCountResult = await pg.query<{
        criticality: string;
        count: string;
      }>(
        `
        SELECT criticality, COUNT(*)::text AS count
        FROM dependencies
        WHERE organization_id = $1
          AND status IN ('active', 'under_review')
        GROUP BY criticality
        `,
        [organizationId]
      );

      const openDepsByCriticality: Record<string, number> = {
        Critical: 0,
        High: 0,
        Moderate: 0,
        Low: 0
      };
      let totalOpenDeps = 0;
      for (const row of depCountResult.rows) {
        if (row.criticality in openDepsByCriticality) {
          const n = parseInt(row.count, 10);
          openDepsByCriticality[row.criticality] = n;
          totalOpenDeps += n;
        }
      }

      // -------------------------------------------------------
      // 8. Active vendor counts by criticality
      // -------------------------------------------------------
      const vendorCriticalityResult = await pg.query<{
        criticality: string | null;
        count: string;
      }>(
        `
        SELECT criticality, COUNT(*)::text AS count
        FROM vendors
        WHERE organization_id = $1
          AND status = 'active'
        GROUP BY criticality
        `,
        [organizationId]
      );

      const vendorByCriticality = { critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0 };
      let vendorTotal = 0;
      for (const row of vendorCriticalityResult.rows) {
        const n = parseInt(row.count, 10);
        vendorTotal += n;
        const k = row.criticality;
        if (k === "critical")       vendorByCriticality.critical     += n;
        else if (k === "high")      vendorByCriticality.high         += n;
        else if (k === "medium")    vendorByCriticality.medium       += n;
        else if (k === "low")       vendorByCriticality.low          += n;
        else                        vendorByCriticality.uncategorized += n;
      }

      res.status(200).json({
        posture: {
          overall_score: snapshotRow?.overall_score ?? null,
          overall_severity: snapshotRow?.overall_severity ?? null,
          snapshot_date: snapshotRow?.snapshot_date ?? null
        },
        domains: domainRows,
        findings: {
          open:          totalOpenFindings,
          by_severity:   bySeverity,
          avg_age_days:  findingsAvgAge,
          max_age_days:  findingsMaxAge,
          older_than_30: findingsOlderThan30,
          older_than_7:  findingsOlderThan7,
        },
        actions: {
          open:          openActionCount,
          in_progress:   inProgressActionCount,
          overdue:       overdueActionCount,
          avg_age_days:  actionsAvgAge,
          max_age_days:  actionsMaxAge,
          older_than_30: actionsOlderThan30,
          older_than_7:  actionsOlderThan7,
        },
        controls_cadence: {
          overdue: overdueControlsCount
        },
        risks_summary: {
          open: totalOpenRisks,
          by_risk_rating: openRisksByRating,
          by_domain: openRisksByDomain,
          by_likelihood_impact: byLikelihoodImpact,
        },
        dependency_summary: {
          open: totalOpenDeps,
          by_criticality: openDepsByCriticality
        },
        evidence_summary: evidenceSummary,
        inventory,
        vendor_risk: {
          by_criticality: vendorByCriticality,
          total: vendorTotal,
          high_or_critical: vendorByCriticality.critical + vendorByCriticality.high,
        },
      });
    } catch (err) {
      logger.error(
        { event: "dashboard_summary_failed", err },
        "GET /api/dashboard/summary failed"
      );
      res.status(500).json({ error: "dashboard_summary_failed" });
    }
  }
);

export default router;
