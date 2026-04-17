import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { analyzeAiGovernanceContext } from "../lib/claudeAssessmentAnalyzer.js";

const router = Router();

router.get(
  "/ai-systems/:id/governance-context",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    try {
      const orgId: string = (req as unknown as { organizationContext: { organizationId: string } }).organizationContext?.organizationId;
      const systemId = req.params["id"];

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const systemResult = await pg.query<{
        id: string;
        name: string;
        use_case: string | null;
        model_type: string | null;
        risk_classification: string | null;
      }>(
        `SELECT id, name, use_case, model_type, risk_classification
         FROM ai_systems
         WHERE id = $1 AND organization_id = $2
         LIMIT 1`,
        [systemId, orgId]
      );

      if (!systemResult.rows[0]) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      const system = systemResult.rows[0];

      const findingsResult = await pg.query<{ title: string; severity: string; status: string }>(
        `SELECT f.title, f.severity, f.status
         FROM findings f
         WHERE f.organization_id = $1
           AND f.status = 'open'
           AND (
             (f.source_type = 'ai_review'
              AND f.source_id IN (
                SELECT id FROM governance_reviews WHERE ai_system_id = $2
              ))
             OR
             (f.source_type = 'ai_governance_review'
              AND f.source_id IN (
                SELECT id FROM ai_governance_assessments WHERE ai_system_id = $2
              ))
           )
         ORDER BY f.created_at DESC
         LIMIT 5`,
        [orgId, systemId]
      );

      const context = await analyzeAiGovernanceContext(
        system.name,
        system.use_case,
        system.model_type,
        system.risk_classification,
        findingsResult.rows
      );

      if (!context) {
        res.status(200).json({
          governance_context: {
            suggestedSeverity: null,
            suggestedSummary: "Review this AI system's governance posture against documented requirements.",
            riskIndicators: [],
            assessmentGuidance: "Evaluate model risks, data handling practices, and regulatory compliance."
          }
        });
        return;
      }

      res.status(200).json({ governance_context: context });
    } catch (err) {
      logger.error({ event: "ai_system_governance_context_failed", err }, "GET /ai-systems/:id/governance-context failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
