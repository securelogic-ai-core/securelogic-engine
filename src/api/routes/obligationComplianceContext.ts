import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { analyzeComplianceContext } from "../lib/claudeAssessmentAnalyzer.js";

const router = Router();

router.get(
  "/obligations/:id/compliance-context",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    try {
      const orgId: string = (req as unknown as { organizationContext: { organizationId: string } }).organizationContext?.organizationId;
      const obligationId = req.params["id"];

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const obligationResult = await pg.query<{ id: string; title: string; description: string | null }>(
        `SELECT id, title, description FROM obligations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [obligationId, orgId]
      );

      if (!obligationResult.rows[0]) {
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      const obligation = obligationResult.rows[0];

      // Fetch recent open findings linked to assessments of this obligation
      const findingsResult = await pg.query<{ title: string; severity: string }>(
        `SELECT f.title, f.severity
         FROM findings f
         JOIN obligation_assessments oa ON oa.id = f.source_id
         WHERE f.organization_id = $1
           AND f.source_type = 'obligation_review'
           AND oa.obligation_id = $2
           AND f.status = 'open'
         ORDER BY f.created_at DESC
         LIMIT 10`,
        [orgId, obligationId]
      );

      const context = await analyzeComplianceContext(
        "obligation",
        obligation.title,
        obligation.description,
        findingsResult.rows
      );

      if (!context) {
        res.status(200).json({
          compliance_context: {
            suggestedSeverity: null,
            suggestedSummary: "Review this obligation against its regulatory requirements.",
            riskIndicators: [],
            assessmentGuidance: "Gather evidence of compliance and document any gaps."
          }
        });
        return;
      }

      res.status(200).json({ compliance_context: context });
    } catch (err) {
      logger.error({ event: "obligation_compliance_context_failed", err }, "GET /obligations/:id/compliance-context failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
