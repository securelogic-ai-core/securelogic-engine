/**
 * obligationsExport.ts — Obligations register CSV export
 *
 * Routes:
 *   GET /api/obligations/export.csv
 *
 * Compliance teams hand the obligations register to auditors and counsel;
 * findings, vendors, risks, and the audit log export — obligations did not.
 *
 * Query params (all optional):
 *   status   — active | waived | not_applicable (DB CHECK vocabulary)
 *   priority — immediate | near_term | planned | watch (DB CHECK vocabulary)
 *   domain   — parameterized pass-through (non-exhaustive vocabulary)
 *
 * Gate: requirePremiumOrCorePlatform — the same dual-gate the obligations
 * family mounts, so an org that can read the register can export it.
 *
 * MOUNT ORDER: before obligationsRouter (GET /obligations/:id captures the
 * literal export.csv path otherwise — the findingsExport trap).
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { csvRow, csvDate } from "../lib/csvExport.js";

const router = Router();

const CSV_MAX = 10000;

const VALID_STATUSES = new Set(["active", "waived", "not_applicable"]);
const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

router.get(
  "/obligations/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const conditions: string[] = ["o.organization_id = $1"];
    const params: unknown[] = [organizationId];

    const qStatus = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
    if (qStatus !== null) {
      if (!VALID_STATUSES.has(qStatus)) {
        res.status(400).json({ error: "invalid_status_filter" });
        return;
      }
      params.push(qStatus);
      conditions.push(`o.status = $${params.length}`);
    }

    const qPriority = isNonEmptyString(req.query.priority) ? req.query.priority.trim() : null;
    if (qPriority !== null) {
      if (!VALID_PRIORITIES.has(qPriority)) {
        res.status(400).json({ error: "invalid_priority_filter" });
        return;
      }
      params.push(qPriority);
      conditions.push(`o.priority = $${params.length}`);
    }

    const qDomain = isNonEmptyString(req.query.domain) ? req.query.domain.trim() : null;
    if (qDomain !== null) {
      params.push(qDomain);
      conditions.push(`o.domain = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        title: string;
        source_regulation: string | null;
        jurisdiction: string | null;
        domain: string | null;
        status: string;
        priority: string | null;
        due_date: string | null;
        owner_email: string | null;
        description: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           o.id, o.title, o.source_regulation, o.jurisdiction, o.domain,
           o.status, o.priority, o.due_date,
           u.email AS owner_email,
           o.description, o.notes, o.created_at, o.updated_at
         FROM obligations o
         LEFT JOIN users u
           ON u.id = o.owner_user_id AND u.organization_id = o.organization_id
         WHERE ${where}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ${CSV_MAX}`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "obligation",
        payload:        { format: "csv", record_count: result.rows.length, entity: "obligations" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="obligations-${fileDate}.csv"`);

      res.write(csvRow(["ID", "Title", "Source Regulation", "Jurisdiction", "Domain",
                        "Status", "Priority", "Due Date", "Owner",
                        "Description", "Notes", "Created At", "Updated At"]) + "\r\n");

      for (const row of result.rows) {
        res.write(csvRow([
          row.id, row.title, row.source_regulation, row.jurisdiction, row.domain,
          row.status, row.priority, csvDate(row.due_date), row.owner_email,
          row.description, row.notes, csvDate(row.created_at), csvDate(row.updated_at),
        ]) + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "obligations_export_failed", err }, "GET /api/obligations/export.csv failed");
      res.status(500).json({ error: "obligations_export_failed" });
    }
  }
);

export default router;
