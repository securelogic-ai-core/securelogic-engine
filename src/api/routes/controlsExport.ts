/**
 * controlsExport.ts — Controls register CSV export
 *
 * Routes:
 *   GET /api/controls/export.csv
 *
 * The control matrix (controls + type/family/maturity/implementation) is a
 * standard audit request; findings, vendors, risks, and the audit log
 * export — controls did not.
 *
 * Query params (all optional):
 *   status — parameterized pass-through (no DB CHECK on controls.status)
 *   domain — parameterized pass-through (non-exhaustive vocabulary)
 *
 * Gate: requirePremiumOrCorePlatform — the same dual-gate the controls
 * family mounts.
 *
 * MOUNT ORDER: before controlsRouter (GET /controls/:id captures the
 * literal export.csv path otherwise — the findingsExport trap).
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireCapability } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { csvRow, csvDate } from "../lib/csvExport.js";

const router = Router();

const CSV_MAX = 10000;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

router.get(
  "/controls/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  requireCapability("export:data"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const conditions: string[] = ["c.organization_id = $1"];
    const params: unknown[] = [organizationId];

    // controls.status carries no DB CHECK (free vocabulary, default
    // 'active') — pass-through param, same treatment as domain.
    const qStatus = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
    if (qStatus !== null) {
      params.push(qStatus);
      conditions.push(`c.status = $${params.length}`);
    }

    const qDomain = isNonEmptyString(req.query.domain) ? req.query.domain.trim() : null;
    if (qDomain !== null) {
      params.push(qDomain);
      conditions.push(`c.domain = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        name: string;
        control_type: string | null;
        status: string | null;
        domain: string | null;
        control_family: string | null;
        maturity_level: string | null;
        implementation_status: string | null;
        owner_email: string | null;
        description: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           c.id, c.name, c.control_type, c.status, c.domain,
           c.control_family, c.maturity_level, c.implementation_status,
           u.email AS owner_email,
           c.description, c.created_at, c.updated_at
         FROM controls c
         LEFT JOIN users u
           ON u.id = c.owner_user_id AND u.organization_id = c.organization_id
         WHERE ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ${CSV_MAX}`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "control",
        payload:        { format: "csv", record_count: result.rows.length, entity: "controls" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="controls-${fileDate}.csv"`);

      res.write(csvRow(["ID", "Name", "Type", "Status", "Domain", "Family",
                        "Maturity", "Implementation", "Owner", "Description",
                        "Created At", "Updated At"]) + "\r\n");

      for (const row of result.rows) {
        res.write(csvRow([
          row.id, row.name, row.control_type, row.status, row.domain,
          row.control_family, row.maturity_level, row.implementation_status,
          row.owner_email, row.description,
          csvDate(row.created_at), csvDate(row.updated_at),
        ]) + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "controls_export_failed", err }, "GET /api/controls/export.csv failed");
      res.status(500).json({ error: "controls_export_failed" });
    }
  }
);

export default router;
