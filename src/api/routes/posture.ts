/**
 * posture.ts — Posture snapshot API
 *
 * Posture snapshots are the org-level aggregation of risk state at a
 * point in time. They are computed from open findings and open actions,
 * and persisted as durable records so that dashboards and trend views
 * always read from structured data, never from ad hoc calculations.
 *
 * Computation reuses DomainRiskAggregationEngineV2 and
 * OverallRiskAggregationEngineV2 — the same engines used by the
 * assessment runner.
 *
 * All routes are org-scoped and use the standard middleware chain.
 */

import { Router } from "express";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { computeAndSavePostureSnapshot } from "../lib/postureSnapshot.js";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher.js";

const router = Router();

// ---------------------------------------------------------------------------
// buildComplianceSummary — pure helper exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Aggregate obligation and obligation assessment DB rows into a
 * compliance posture summary.
 *
 * All canonical status keys are always present; missing values default to 0.
 * open_compliance_concerns = assessments with non_compliant + partially_compliant.
 */
export function buildComplianceSummary(
  obligationStatusRows: ReadonlyArray<{ status: string; count: string }>,
  assessmentStatusRows: ReadonlyArray<{ status: string; count: string }>
): {
  obligations: {
    total: number;
    by_status: Record<string, number>;
  };
  assessments: {
    total: number;
    by_status: Record<string, number>;
  };
  open_compliance_concerns: number;
} {
  const obligationByStatus: Record<string, number> = {
    active: 0,
    waived: 0,
    not_applicable: 0
  };
  for (const row of obligationStatusRows) {
    if (row.status in obligationByStatus) {
      obligationByStatus[row.status] = parseInt(row.count, 10);
    }
  }
  const obligationTotal = Object.values(obligationByStatus).reduce((s, n) => s + n, 0);

  const assessmentByStatus: Record<string, number> = {
    not_started: 0,
    in_progress: 0,
    compliant: 0,
    non_compliant: 0,
    partially_compliant: 0
  };
  for (const row of assessmentStatusRows) {
    if (row.status in assessmentByStatus) {
      assessmentByStatus[row.status] = parseInt(row.count, 10);
    }
  }
  const assessmentTotal = Object.values(assessmentByStatus).reduce((s, n) => s + n, 0);
  const openComplianceConcerns =
    (assessmentByStatus["non_compliant"] ?? 0) + (assessmentByStatus["partially_compliant"] ?? 0);

  return {
    obligations: {
      total: obligationTotal,
      by_status: obligationByStatus
    },
    assessments: {
      total: assessmentTotal,
      by_status: assessmentByStatus
    },
    open_compliance_concerns: openComplianceConcerns
  };
}

/* =========================================================
   POST /api/posture/snapshot
   Compute and persist a posture snapshot for the calling org.
   One snapshot per org per calendar day (upsert on conflict).
   ========================================================= */

router.post(
  "/posture/snapshot",
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

      const result = await withTenant(organizationId, () =>
        computeAndSavePostureSnapshot(organizationId)
      );

      dispatchWebhookEvent({
        event_type: "posture.snapshot_created",
        organization_id: organizationId,
        data: {
          overall_score:    result.overallScore,
          overall_severity: result.overallSeverity,
          snapshot_date:    result.snapshotDate,
        },
      }).catch(() => {});

      res.status(201).json({
        snapshotId:          result.snapshotId,
        organizationId,
        snapshotDate:        result.snapshotDate,
        overallScore:        result.overallScore,
        overallSeverity:     result.overallSeverity,
        openFindingCount:    result.openFindingCount,
        openActionCount:     result.openActionCount,
        overdueActionCount:  result.overdueActionCount,
        domainScores:        result.domainScores,
        computationRationale: result.computationRationale,
      });
    } catch (err) {
      logger.error(
        { event: "posture_snapshot_failed", err },
        "POST /api/posture/snapshot failed"
      );
      res.status(500).json({ error: "posture_snapshot_failed" });
    }
  }
);

/* =========================================================
   GET /api/posture/latest
   Return the most recent posture snapshot with domain scores.
   Returns 404 with a clear message if no snapshot exists yet.
   ========================================================= */

router.get(
  "/posture/latest",
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

      const snapshotResult = await pg.query(
        `
        SELECT
          id, organization_id, snapshot_date,
          overall_score, overall_severity,
          open_finding_count, open_action_count, overdue_action_count,
          computation_rationale, created_at
        FROM posture_snapshots
        WHERE organization_id = $1
        ORDER BY snapshot_date DESC
        LIMIT 1
        `,
        [organizationId]
      );

      if ((snapshotResult.rowCount ?? 0) === 0) {
        res.status(404).json({
          error: "no_posture_snapshot",
          message:
            "No posture snapshot exists yet for this organization. " +
            "Run POST /api/posture/snapshot after completing assessments."
        });
        return;
      }

      const snapshot = snapshotResult.rows[0];

      const domainResult = await pg.query(
        `
        SELECT
          id, domain, score, severity,
          trend_direction, finding_count, action_count, rationale
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
        [snapshot.id]
      );

      res.status(200).json({
        snapshot: {
          id: snapshot.id,
          organizationId: snapshot.organization_id,
          snapshotDate: snapshot.snapshot_date,
          overallScore: snapshot.overall_score,
          overallSeverity: snapshot.overall_severity,
          openFindingCount: snapshot.open_finding_count,
          openActionCount: snapshot.open_action_count,
          overdueActionCount: snapshot.overdue_action_count,
          computationRationale: snapshot.computation_rationale,
          createdAt: snapshot.created_at
        },
        domainScores: domainResult.rows
      });
    } catch (err) {
      logger.error(
        { event: "posture_latest_failed", err },
        "GET /api/posture/latest failed"
      );
      res.status(500).json({ error: "posture_latest_failed" });
    }
  }
);

/* =========================================================
   GET /api/posture/history
   Return posture snapshots over time for trend rendering.
   Defaults to last 90 days. Max 180 days.
   ========================================================= */

router.get(
  "/posture/history",
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

      const rawDays = parseInt(String(req.query.days ?? "90"), 10);
      const days = Number.isFinite(rawDays) && rawDays > 0
        ? Math.min(rawDays, 180)
        : 90;

      const result = await pg.query(
        `
        SELECT
          id, snapshot_date,
          overall_score, overall_severity,
          open_finding_count, open_action_count, overdue_action_count,
          created_at
        FROM posture_snapshots
        WHERE organization_id = $1
          AND snapshot_date >= CURRENT_DATE - ($2 || ' days')::interval
        ORDER BY snapshot_date ASC
        `,
        [organizationId, days]
      );

      res.status(200).json({
        organizationId,
        days,
        count: result.rows.length,
        snapshots: result.rows
      });
    } catch (err) {
      logger.error(
        { event: "posture_history_failed", err },
        "GET /api/posture/history failed"
      );
      res.status(500).json({ error: "posture_history_failed" });
    }
  }
);

/* =========================================================
   GET /api/posture/compliance-summary
   Aggregates obligation and obligation assessment outcomes
   into a deterministic compliance posture summary.
   Returns obligation counts by status, assessment counts by
   status, and open compliance concern count.
   ========================================================= */

router.get(
  "/posture/compliance-summary",
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

      const [obligationResult, assessmentResult] = await Promise.all([
        pg.query<{ status: string; count: string }>(
          `
          SELECT status, COUNT(*)::text AS count
          FROM obligations
          WHERE organization_id = $1
          GROUP BY status
          `,
          [organizationId]
        ),
        pg.query<{ status: string; count: string }>(
          `
          SELECT status, COUNT(*)::text AS count
          FROM obligation_assessments
          WHERE organization_id = $1
          GROUP BY status
          `,
          [organizationId]
        )
      ]);

      const summary = buildComplianceSummary(
        obligationResult.rows,
        assessmentResult.rows
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "compliance_summary_failed", err },
        "GET /api/posture/compliance-summary failed"
      );
      res.status(500).json({ error: "compliance_summary_failed" });
    }
  }
);

export default router;
