/**
 * aiSystemsExport.ts — AI systems register CSV export
 *
 * Routes:
 *   GET /api/ai-systems/export.csv
 *
 * The AI system inventory is the register AI-governance reviews (EU AI Act
 * readiness, NIST AI RMF mapping) start from. It was the last canonical
 * register without an export.
 *
 * Query params (all optional):
 *   criticality       — critical | high | medium | low (DB CHECK vocabulary)
 *   deployment_status — parameterized pass-through (no DB CHECK)
 *   risk_classification — parameterized pass-through (no DB CHECK)
 *
 * Gate: requirePremiumOrCorePlatform — the ai-systems family dual-gate.
 *
 * MOUNT ORDER: before aiSystemsRouter (GET /ai-systems/:id captures the
 * literal export.csv path otherwise — the findingsExport trap).
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { requireCapability } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { csvRow, csvDate } from "../lib/csvExport.js";

const router = Router();

const CSV_MAX = 10000;

const VALID_CRITICALITIES = new Set(["critical", "high", "medium", "low"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

router.get(
  "/ai-systems/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  requireCapability("export:data"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const conditions: string[] = ["a.organization_id = $1"];
    const params: unknown[] = [organizationId];

    const qCriticality = isNonEmptyString(req.query.criticality)
      ? req.query.criticality.trim()
      : null;
    if (qCriticality !== null) {
      if (!VALID_CRITICALITIES.has(qCriticality)) {
        res.status(400).json({ error: "invalid_criticality_filter" });
        return;
      }
      params.push(qCriticality);
      conditions.push(`a.criticality = $${params.length}`);
    }

    // deployment_status / risk_classification carry no DB CHECK — free
    // vocabularies, so both are parameterized pass-throughs (never 400).
    const qDeployment = isNonEmptyString(req.query.deployment_status)
      ? req.query.deployment_status.trim()
      : null;
    if (qDeployment !== null) {
      params.push(qDeployment);
      conditions.push(`a.deployment_status = $${params.length}`);
    }

    const qRiskClass = isNonEmptyString(req.query.risk_classification)
      ? req.query.risk_classification.trim()
      : null;
    if (qRiskClass !== null) {
      params.push(qRiskClass);
      conditions.push(`a.risk_classification = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        name: string;
        use_case: string | null;
        model_type: string | null;
        data_classification: string | null;
        deployment_status: string | null;
        criticality: string | null;
        risk_classification: string | null;
        owner_email: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           a.id, a.name, a.use_case, a.model_type, a.data_classification,
           a.deployment_status, a.criticality, a.risk_classification,
           u.email AS owner_email,
           a.created_at, a.updated_at
         FROM ai_systems a
         LEFT JOIN users u
           ON u.id = a.owner_user_id AND u.organization_id = a.organization_id
         WHERE ${where}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ${CSV_MAX}`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "ai_system",
        payload:        { format: "csv", record_count: result.rows.length, entity: "ai_systems" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ai-systems-${fileDate}.csv"`);

      res.write(csvRow(["ID", "Name", "Use Case", "Model Type", "Data Classification",
                        "Deployment Status", "Criticality", "Risk Classification",
                        "Owner", "Created At", "Updated At"]) + "\r\n");

      for (const row of result.rows) {
        res.write(csvRow([
          row.id, row.name, row.use_case, row.model_type, row.data_classification,
          row.deployment_status, row.criticality, row.risk_classification,
          row.owner_email, csvDate(row.created_at), csvDate(row.updated_at),
        ]) + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "ai_systems_export_failed", err }, "GET /api/ai-systems/export.csv failed");
      res.status(500).json({ error: "ai_systems_export_failed" });
    }
  }
);

export default router;
