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
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  computePosture,
  FALLBACK_CONTEXT,
  type DbFindingForPosture,
  type OrgContext
} from "../lib/postureComputation.js";

const router = Router();

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

      // Fetch org profile for context-weighted posture computation.
      // These columns are added by migration 20260411_org_profile_context_weighting.sql.
      const orgProfileResult = await pg.query<{
        regulated: boolean;
        handles_pii: boolean;
        safety_critical: boolean;
        scale: string;
      }>(
        `
        SELECT regulated, handles_pii, safety_critical, scale
        FROM organizations
        WHERE id = $1
        `,
        [organizationId]
      );

      let orgContext: OrgContext;

      if ((orgProfileResult.rowCount ?? 0) === 0) {
        // Should not occur: organizationId is resolved from a valid API key.
        // Log a warning and fall back to the safe neutral context.
        logger.warn(
          { event: "posture_snapshot_org_not_found", organizationId },
          "org profile not found for posture computation — falling back to FALLBACK_CONTEXT"
        );
        orgContext = FALLBACK_CONTEXT;
      } else {
        const row = orgProfileResult.rows[0]!;
        const validScales = new Set(["Small", "Medium", "Enterprise"]);
        orgContext = {
          regulated: row.regulated,
          handlesPII: row.handles_pii,
          safetyCritical: row.safety_critical,
          scale: validScales.has(row.scale)
            ? (row.scale as OrgContext["scale"])
            : "Small"
        };
      }

      // Fetch open findings for this org
      const findingsResult = await pg.query<DbFindingForPosture>(
        `
        SELECT id, title, domain, severity
        FROM findings
        WHERE organization_id = $1
          AND status = 'open'
        `,
        [organizationId]
      );

      const openFindings = findingsResult.rows;

      // Count open and overdue actions
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
      const openActionCount = actionRow != null
        ? parseInt(actionRow.open_count, 10)
        : 0;
      const overdueActionCount = actionRow != null
        ? parseInt(actionRow.overdue_count, 10)
        : 0;

      // Compute posture using real org context — no longer neutral by default
      const computed = computePosture(openFindings, openActionCount, overdueActionCount, orgContext);

      const client = await pg.connect();

      try {
        await client.query("BEGIN");

        // Upsert the snapshot — one per org per day
        const snapshotResult = await client.query(
          `
          INSERT INTO posture_snapshots (
            organization_id,
            snapshot_date,
            overall_score,
            overall_severity,
            open_finding_count,
            open_action_count,
            overdue_action_count,
            computation_rationale
          )
          VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (organization_id, snapshot_date) DO UPDATE SET
            overall_score        = EXCLUDED.overall_score,
            overall_severity     = EXCLUDED.overall_severity,
            open_finding_count   = EXCLUDED.open_finding_count,
            open_action_count    = EXCLUDED.open_action_count,
            overdue_action_count = EXCLUDED.overdue_action_count,
            computation_rationale = EXCLUDED.computation_rationale,
            created_at           = NOW()
          RETURNING id, snapshot_date
          `,
          [
            organizationId,
            computed.overall_score,
            computed.overall_severity,
            computed.open_finding_count,
            computed.open_action_count,
            computed.overdue_action_count,
            JSON.stringify(computed.computation_rationale)
          ]
        );

        const snapshot = snapshotResult.rows[0];
        if (!snapshot) {
          throw new Error("posture_snapshot_insert_returned_no_row");
        }
        const snapshotId: string = snapshot.id;

        // Delete existing domain scores for this snapshot (on upsert, re-derive)
        await client.query(
          `DELETE FROM domain_scores WHERE posture_snapshot_id = $1`,
          [snapshotId]
        );

        // Insert domain scores
        if (computed.domain_scores.length > 0) {
          const domainValues: unknown[] = [];
          const domainPlaceholders: string[] = [];

          computed.domain_scores.forEach((ds, i) => {
            const base = i * 6;
            domainPlaceholders.push(
              `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
            );
            domainValues.push(
              snapshotId,
              ds.domain,
              ds.score,
              ds.severity,
              ds.finding_count,
              ds.rationale
            );
          });

          await client.query(
            `
            INSERT INTO domain_scores (
              posture_snapshot_id, domain, score, severity, finding_count, rationale
            )
            VALUES ${domainPlaceholders.join(", ")}
            `,
            domainValues
          );
        }

        await client.query("COMMIT");

        logger.info(
          {
            event: "posture_snapshot_created",
            organizationId,
            snapshotId,
            overallScore: computed.overall_score,
            domainCount: computed.domain_scores.length,
            openFindingCount: computed.open_finding_count
          },
          "Posture snapshot created"
        );

        res.status(201).json({
          snapshotId,
          organizationId,
          snapshotDate: snapshot.snapshot_date,
          overallScore: computed.overall_score,
          overallSeverity: computed.overall_severity,
          openFindingCount: computed.open_finding_count,
          openActionCount: computed.open_action_count,
          overdueActionCount: computed.overdue_action_count,
          domainScores: computed.domain_scores,
          computationRationale: computed.computation_rationale
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
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

export default router;
