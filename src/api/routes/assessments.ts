import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/* =========================================================
   LIST ASSESSMENTS
   GET /assessments?limit=&before_created_at=&before_id=
   Scoped to the calling organization.
   ========================================================= */

router.get(
  "/assessments",
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

      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = String(req.query.before_created_at ?? "").trim() || null;
      const beforeId = String(req.query.before_id ?? "").trim() || null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const params: unknown[] = [organizationId, limit];
      const conditions: string[] = ["a.organization_id = $1"];

      if (useCursor) {
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(`(a.created_at, a.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`);
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await pg.query(
        `
        SELECT
          a.id,
          a.type,
          a.framework,
          a.status,
          a.subject_name,
          a.completed_at,
          a.created_at,
          r.risk_score,
          r.summary,
          (
            SELECT COUNT(*)::int
            FROM findings f
            WHERE f.assessment_id = a.id
          ) AS finding_count
        FROM assessments a
        LEFT JOIN reports r ON r.assessment_id = a.id
        ${whereClause}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2
        `,
        params
      );

      const assessments = result.rows;
      const last = assessments.length > 0 ? assessments[assessments.length - 1] : null;

      res.status(200).json({
        count: assessments.length,
        limit,
        organizationId,
        nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
        assessments
      });
    } catch (err) {
      logger.error({ event: "assessments_list_failed", err }, "GET /api/assessments failed");
      res.status(500).json({ error: "assessments_list_failed" });
    }
  }
);

/* =========================================================
   GET SINGLE ASSESSMENT
   GET /assessments/:id
   Returns the assessment, its findings, and report summary.
   Tenant-isolated: 404 if assessment belongs to a different org.
   ========================================================= */

router.get(
  "/assessments/:id",
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

      const assessmentId = String(req.params.id ?? "").trim();

      if (!assessmentId) {
        res.status(400).json({ error: "assessment_id_required" });
        return;
      }

      // Fetch assessment — org check enforces tenant isolation (returns 404 not 403 to avoid enumeration)
      const assessmentResult = await pg.query(
        `
        SELECT
          a.id,
          a.organization_id,
          a.type,
          a.framework,
          a.status,
          a.subject_name,
          a.scope,
          a.risk_context,
          a.submitted_at,
          a.completed_at,
          a.created_at,
          r.risk_score,
          r.summary AS report_summary,
          r.report_json
        FROM assessments a
        LEFT JOIN reports r ON r.assessment_id = a.id
        WHERE a.id = $1 AND a.organization_id = $2
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "assessment_not_found" });
        return;
      }

      const assessment = assessmentResult.rows[0];

      // Fetch findings for this assessment
      const findingsResult = await pg.query(
        `
        SELECT
          id,
          title,
          severity,
          description,
          recommendation,
          framework_control_id,
          status,
          created_at
        FROM findings
        WHERE assessment_id = $1
        ORDER BY
          CASE severity
            WHEN 'Critical' THEN 1
            WHEN 'High'     THEN 2
            WHEN 'Moderate' THEN 3
            WHEN 'Low'      THEN 4
            ELSE 5
          END,
          created_at ASC
        `,
        [assessmentId]
      );

      res.status(200).json({
        assessment: {
          id: assessment.id,
          organizationId: assessment.organization_id,
          type: assessment.type,
          framework: assessment.framework,
          status: assessment.status,
          subjectName: assessment.subject_name,
          scope: assessment.scope,
          riskContext: assessment.risk_context,
          submittedAt: assessment.submitted_at,
          completedAt: assessment.completed_at,
          createdAt: assessment.created_at,
          report: {
            riskScore: assessment.risk_score,
            summary: assessment.report_summary,
            domainScores: assessment.report_json?.domainScores ?? [],
            executiveSummary: assessment.report_json?.executiveSummary ?? null
          }
        },
        findings: findingsResult.rows,
        findingCount: findingsResult.rows.length
      });
    } catch (err) {
      logger.error({ event: "assessment_get_failed", err }, "GET /api/assessments/:id failed");
      res.status(500).json({ error: "assessment_get_failed" });
    }
  }
);

export default router;
