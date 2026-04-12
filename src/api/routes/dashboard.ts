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

const router = Router();

// ---------------------------------------------------------------------------
// Pure helper — exported for unit testing
//
// Route files import pg at module load; tests cannot import route files
// directly without DATABASE_URL. Tests use vi.mock("../infra/postgres.js")
// to prevent module evaluation from throwing, then import this export.
// ---------------------------------------------------------------------------

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
      }> = [];

      if (snapshotRow !== null) {
        const domainResult = await pg.query<{
          domain: string;
          score: number | null;
          severity: string | null;
          finding_count: number;
          action_count: number;
        }>(
          `
          SELECT domain, score, severity, finding_count, action_count
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
      // 4. Action counts — open and overdue
      // -------------------------------------------------------
      const actionCountResult = await pg.query<{
        open_count: string;
        overdue_count: string;
      }>(
        `
        SELECT
          COUNT(*)::text AS open_count,
          COUNT(*) FILTER (
            WHERE due_date < CURRENT_DATE
              AND status NOT IN ('closed', 'accepted')
          )::text AS overdue_count
        FROM actions
        WHERE organization_id = $1
          AND status NOT IN ('closed', 'accepted')
        `,
        [organizationId]
      );

      const actionRow = actionCountResult.rows[0];
      const openActionCount = actionRow ? parseInt(actionRow.open_count, 10) : 0;
      const overdueActionCount = actionRow
        ? parseInt(actionRow.overdue_count, 10)
        : 0;

      // -------------------------------------------------------
      // 5. Object inventory counts — all live entity types
      // -------------------------------------------------------
      const inventoryResult = await pg.query<{
        vendors: string;
        ai_systems: string;
        controls: string;
        control_assessments: string;
        governance_reviews: string;
      }>(
        `
        SELECT
          (SELECT COUNT(*)::text FROM vendors            WHERE organization_id = $1) AS vendors,
          (SELECT COUNT(*)::text FROM ai_systems         WHERE organization_id = $1) AS ai_systems,
          (SELECT COUNT(*)::text FROM controls           WHERE organization_id = $1) AS controls,
          (SELECT COUNT(*)::text FROM control_assessments WHERE organization_id = $1) AS control_assessments,
          (SELECT COUNT(*)::text FROM governance_reviews  WHERE organization_id = $1) AS governance_reviews
        `,
        [organizationId]
      );

      const inv = inventoryResult.rows[0];

      res.status(200).json({
        posture: {
          overall_score: snapshotRow?.overall_score ?? null,
          overall_severity: snapshotRow?.overall_severity ?? null,
          snapshot_date: snapshotRow?.snapshot_date ?? null
        },
        domains: domainRows,
        findings: {
          open: totalOpenFindings,
          by_severity: bySeverity
        },
        actions: {
          open: openActionCount,
          overdue: overdueActionCount
        },
        inventory: {
          vendors: inv ? parseInt(inv.vendors, 10) : 0,
          ai_systems: inv ? parseInt(inv.ai_systems, 10) : 0,
          controls: inv ? parseInt(inv.controls, 10) : 0,
          control_assessments: inv ? parseInt(inv.control_assessments, 10) : 0,
          governance_reviews: inv ? parseInt(inv.governance_reviews, 10) : 0
        }
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
