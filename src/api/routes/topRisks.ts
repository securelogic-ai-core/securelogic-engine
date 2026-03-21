import { Router } from "express";
import { pg } from "../infra/postgres.js";
import {
  classifyConfidence,
  classifySeverity,
  toNumericScore
} from "../lib/riskClassification.js";
import { filterTopRisksBySector } from "../lib/filterTopRisks.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/top-risks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null
      const organizationId = organizationContext?.organizationId

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" })
        return
      }

      const result = await pg.query(
        `
        SELECT
          id,
          name,
          category,
          description,
          score,
          metadata,
          created_at
        FROM trends
        WHERE organization_id = $1
        ORDER BY score DESC, created_at DESC
        LIMIT 50
        `,
        [organizationId]
      )

      const enriched = result.rows.map((row) => {
        const numericScore = toNumericScore(row.score)
        const metadata =
          row.metadata && typeof row.metadata === "object" ? row.metadata : null

        return {
          ...row,
          numeric_score: numericScore,
          severity: classifySeverity(numericScore),
          confidence: classifyConfidence(metadata)
        }
      })

      const sector =
        typeof req.query.sector === "string" ? req.query.sector : undefined

      const filtered = filterTopRisksBySector(enriched, sector)

      res.json({
        count: filtered.length,
        sector: sector ?? null,
        organizationId: organizationContext?.organizationId ?? null,
        entitlementLevel: organizationContext?.entitlementLevel ?? null,
        topRisks: filtered.slice(0, 10)
      })
    } catch (err) {
      console.error("top_risks_api_error", err)

      res.status(500).json({
        error: "top_risks_query_failed"
      })
    }
  }
)

export default router
