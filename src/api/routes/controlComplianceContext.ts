import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { analyzeComplianceContext } from "../lib/claudeAssessmentAnalyzer.js";

const router = Router();

router.get(
  "/controls/:id/compliance-context",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    try {
      const orgId: string = (req as unknown as { organizationContext: { organizationId: string } }).organizationContext?.organizationId;
      const controlId = req.params["id"];

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const controlResult = await pg.query<{ id: string; name: string; description: string | null }>(
        `SELECT id, name, description FROM controls WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [controlId, orgId]
      );

      if (!controlResult.rows[0]) {
        res.status(404).json({ error: "control_not_found" });
        return;
      }

      const control = controlResult.rows[0];

      // Fetch recent open findings linked to assessments of this control
      const findingsResult = await pg.query<{ title: string; severity: string }>(
        `SELECT f.title, f.severity
         FROM findings f
         JOIN control_assessments ca ON ca.id = f.source_id
         WHERE f.organization_id = $1
           AND f.source_type = 'control_test'
           AND ca.control_id = $2
           AND f.status = 'open'
         ORDER BY f.created_at DESC
         LIMIT 10`,
        [orgId, controlId]
      );

      const context = await analyzeComplianceContext(
        "control",
        control.name,
        control.description,
        findingsResult.rows
      );

      if (!context) {
        res.status(200).json({
          compliance_context: {
            suggestedSeverity: null,
            suggestedSummary: "Review this control against its documented requirements.",
            riskIndicators: [],
            assessmentGuidance: "Gather evidence of control operation and test effectiveness."
          }
        });
        return;
      }

      res.status(200).json({ compliance_context: context });
    } catch (err) {
      logger.error({ event: "control_compliance_context_failed", err }, "GET /controls/:id/compliance-context failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
