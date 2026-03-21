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
  "/top-risks/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("starter"),
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

      const items = result.rows.map((row) => {
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

      const filtered = filterTopRisksBySector(items, sector)

      const severityCounts = {
        critical: filtered.filter((x) => x.severity === "critical").length,
        high: filtered.filter((x) => x.severity === "high").length,
        medium: filtered.filter((x) => x.severity === "medium").length,
        low: filtered.filter((x) => x.severity === "low").length
      }

      const confidenceCounts = {
        high: filtered.filter((x) => x.confidence === "high").length,
        medium: filtered.filter((x) => x.confidence === "medium").length,
        low: filtered.filter((x) => x.confidence === "low").length
      }

      const highestRisk = filtered.length > 0 ? filtered[0] : null

      const averageScore =
        filtered.length > 0
          ? Number(
              (
                filtered.reduce((sum, item) => sum + item.numeric_score, 0) /
                filtered.length
              ).toFixed(2)
            )
          : 0

      const newestHighRisk =
        filtered.find(
          (item) => item.severity === "critical" || item.severity === "high"
        ) ?? null

      res.json({
        sector: sector ?? null,
        organizationId: organizationContext?.organizationId ?? null,
        entitlementLevel: organizationContext?.entitlementLevel ?? null,
        total: filtered.length,
        severityCounts,
        confidenceCounts,
        averageScore,
        highestRisk,
        newestHighRisk
      })
    } catch (err) {
      console.error("top_risks_summary_api_error", err)

      res.status(500).json({
        error: "top_risks_summary_query_failed"
      })
    }
  }
)

export default router
