/**
 * risksExport.ts — Risk register CSV export
 *
 * Routes:
 *   GET /api/risks/export.csv
 *
 * The risk register is the canonical artifact leadership and auditors take
 * OUT of the platform (board packs, audit evidence, offline review).
 * Findings, vendors, and the audit log already export; the register did not.
 *
 * Query params (all optional, mirroring GET /api/risks):
 *   status       — open | accepted | mitigated | closed | transferred
 *   risk_rating  — Critical | High | Moderate | Low (legacy = residual)
 *   domain       — free-form pass-through (domains are non-exhaustive by
 *                  design; parameterized, never interpolated)
 *   active=true  — Metric Contract: only risks still ON the register
 *
 * MOUNT ORDER: this router must mount BEFORE risksRouter — GET /risks/:id
 * would otherwise capture the literal path /risks/export.csv (the same trap
 * findingsExport documents against findingsRouter).
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { requireCapability } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { VALID_STATUSES, VALID_RISK_RATINGS } from "../lib/riskValidation.js";
import { sqlRiskActive } from "../lib/metricDefinitions.js";
import { csvRow } from "../lib/csvExport.js";

const router = Router();

// Same ceiling as the audit-log export — enough for any real register, small
// enough that one request cannot hold a connection open indefinitely.
const CSV_MAX = 10000;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

router.get(
  "/risks/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  requireCapability("export:data"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const conditions: string[] = ["r.organization_id = $1"];
    const params: unknown[] = [organizationId];

    const qStatus = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
    if (qStatus !== null) {
      if (!VALID_STATUSES.has(qStatus)) {
        res.status(400).json({ error: "invalid_status_filter" });
        return;
      }
      params.push(qStatus);
      conditions.push(`r.status = $${params.length}`);
    }

    const qRating = isNonEmptyString(req.query.risk_rating) ? req.query.risk_rating.trim() : null;
    if (qRating !== null) {
      if (!VALID_RISK_RATINGS.has(qRating)) {
        res.status(400).json({ error: "invalid_risk_rating_filter" });
        return;
      }
      params.push(qRating);
      conditions.push(`r.risk_rating = $${params.length}`);
    }

    // Domains are a non-exhaustive vocabulary (riskValidation.ts) — filter is a
    // parameterized pass-through, exactly like the list route.
    const qDomain = isNonEmptyString(req.query.domain) ? req.query.domain.trim() : null;
    if (qDomain !== null) {
      params.push(qDomain);
      conditions.push(`r.domain = $${params.length}`);
    }

    if (req.query.active === "true") {
      conditions.push(sqlRiskActive("r.status"));
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        title: string;
        domain: string;
        likelihood: string;
        impact: string;
        inherent_rating: string | null;
        residual_rating: string | null;
        risk_rating: string;
        status: string;
        treatment: string | null;
        owner: string | null;
        due_date: string | null;
        source_type: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           r.id,
           r.title,
           r.domain,
           r.likelihood,
           r.impact,
           r.inherent_rating,
           r.residual_rating,
           r.risk_rating,
           r.status,
           r.treatment,
           r.owner,
           r.due_date,
           r.source_type,
           r.created_at,
           r.updated_at
         FROM risks r
         WHERE ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${CSV_MAX}`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "risk",
        payload:        { format: "csv", record_count: result.rows.length, entity: "risks" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="risk-register-${fileDate}.csv"`);

      const header = csvRow(["ID", "Title", "Domain", "Likelihood", "Impact",
                             "Inherent Rating", "Residual Rating", "Risk Rating",
                             "Status", "Treatment", "Owner", "Due Date",
                             "Source Type", "Created At", "Updated At"]);
      res.write(header + "\r\n");

      for (const row of result.rows) {
        const line = csvRow([
          row.id,
          row.title,
          row.domain,
          row.likelihood,
          row.impact,
          row.inherent_rating,
          row.residual_rating,
          row.risk_rating,
          row.status,
          row.treatment,
          row.owner,
          row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
          row.source_type,
          new Date(row.created_at).toISOString().slice(0, 10),
          new Date(row.updated_at).toISOString().slice(0, 10),
        ]);
        res.write(line + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "risks_export_failed", err }, "GET /api/risks/export.csv failed");
      res.status(500).json({ error: "risks_export_failed" });
    }
  }
);

export default router;
