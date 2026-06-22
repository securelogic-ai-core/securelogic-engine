/**
 * findingsExport.ts — Findings CSV export
 *
 * Routes:
 *   GET /api/findings/export.csv
 *
 * Query params (all optional): status, severity, domain, source_type, priority
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const VALID_STATUSES   = new Set(["open", "in_progress", "closed"]);
const VALID_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);
const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);
const VALID_SOURCE_TYPES = new Set([
  "vendor_review", "control_test", "obligation_review", "ai_review",
  "ai_governance_review", "manual", "assessment", "signal", "risk",
]);
const VALID_DOMAINS = new Set([
  "Cyber", "Compliance", "Vendor", "AI", "Operational", "Strategic",
  "Legal", "Financial", "General",
]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// RFC 4180 CSV cell serializer: wrap in double quotes, escape inner quotes by doubling.
function csvCell(val: string | null | undefined): string {
  const s = val == null ? "" : String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

router.get(
  "/findings/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Build WHERE conditions
    const conditions: string[] = ["f.organization_id = $1"];
    const params: unknown[] = [organizationId];

    const qStatus = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
    if (qStatus !== null) {
      if (!VALID_STATUSES.has(qStatus)) {
        res.status(400).json({ error: "invalid_status_filter" });
        return;
      }
      params.push(qStatus);
      conditions.push(`f.status = $${params.length}`);
    }

    const qSeverity = isNonEmptyString(req.query.severity) ? req.query.severity.trim() : null;
    if (qSeverity !== null) {
      if (!VALID_SEVERITIES.has(qSeverity)) {
        res.status(400).json({ error: "invalid_severity_filter" });
        return;
      }
      params.push(qSeverity);
      conditions.push(`f.severity = $${params.length}`);
    }

    const qDomain = isNonEmptyString(req.query.domain) ? req.query.domain.trim() : null;
    if (qDomain !== null) {
      if (!VALID_DOMAINS.has(qDomain)) {
        res.status(400).json({ error: "invalid_domain_filter" });
        return;
      }
      params.push(qDomain);
      conditions.push(`f.domain = $${params.length}`);
    }

    const qSourceType = isNonEmptyString(req.query.source_type) ? req.query.source_type.trim() : null;
    if (qSourceType !== null) {
      if (!VALID_SOURCE_TYPES.has(qSourceType)) {
        res.status(400).json({ error: "invalid_source_type_filter" });
        return;
      }
      params.push(qSourceType);
      conditions.push(`f.source_type = $${params.length}`);
    }

    const qPriority = isNonEmptyString(req.query.priority) ? req.query.priority.trim() : null;
    if (qPriority !== null) {
      if (!VALID_PRIORITIES.has(qPriority)) {
        res.status(400).json({ error: "invalid_priority_filter" });
        return;
      }
      params.push(qPriority);
      conditions.push(`f.priority = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        title: string;
        severity: string | null;
        priority: string | null;
        status: string;
        domain: string | null;
        source_type: string | null;
        description: string | null;
        recommendation: string | null;
        due_date: string | null;
        created_at: string;
      }>(
        `SELECT
           f.id,
           f.title,
           f.severity,
           f.priority,
           f.status,
           f.domain,
           f.source_type,
           f.description,
           f.recommendation,
           f.due_date,
           f.created_at
         FROM findings f
         WHERE ${where}
         ORDER BY f.created_at DESC, f.id DESC`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "finding",
        payload:        { format: "csv", record_count: result.rows.length, entity: "findings" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="findings-${fileDate}.csv"`);

      const header = csvRow(["ID", "Title", "Severity", "Priority", "Status", "Domain",
                              "Source Type", "Description", "Recommendation", "Due Date", "Created At"]);
      res.write(header + "\r\n");

      for (const row of result.rows) {
        const line = csvRow([
          row.id,
          row.title,
          row.severity,
          row.priority,
          row.status,
          row.domain,
          row.source_type,
          row.description,
          row.recommendation,
          row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
          new Date(row.created_at).toISOString().slice(0, 10),
        ]);
        res.write(line + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "findings_export_failed", err }, "GET /api/findings/export.csv failed");
      res.status(500).json({ error: "findings_export_failed" });
    }
  }
);

export default router;
