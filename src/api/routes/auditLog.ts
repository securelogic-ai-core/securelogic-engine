/**
 * auditLog.ts — Audit log API routes (admin-only)
 *
 * GET /api/audit-log              — Paginated security audit events
 * GET /api/audit-log/event-types  — Distinct event types for this org
 * GET /api/audit-log/export.csv   — CSV export (up to 10,000 rows)
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireAdminRole } from "../middleware/requireRole.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 100;
const CSV_MAX       = 10000;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/.test(v.trim());
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

function parseLimit(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parsePage(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/* =========================================================
   GET /api/audit-log
   ========================================================= */

router.get(
  "/audit-log",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  requireAdminRole,
  async (req, res) => {
    const organizationId = (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const page  = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);
      const offset = (page - 1) * limit;

      const conditions: string[] = ["sal.organization_id = $1"];
      const params: unknown[]    = [organizationId];

      if (isNonEmptyString(req.query.event_type)) {
        params.push(req.query.event_type.trim().slice(0, 100));
        conditions.push(`sal.event_type = $${params.length}`);
      }

      if (isUuid(req.query.user_id)) {
        params.push(req.query.user_id.trim());
        conditions.push(`sal.actor_user_id = $${params.length}::uuid`);
      }

      if (isIsoDate(req.query.date_from)) {
        params.push(req.query.date_from.trim());
        conditions.push(`sal.created_at >= $${params.length}::timestamptz`);
      }

      if (isIsoDate(req.query.date_to)) {
        params.push(req.query.date_to.trim());
        conditions.push(`sal.created_at < ($${params.length}::date + interval '1 day')`);
      }

      const where = conditions.join(" AND ");

      const [rowsResult, countResult] = await Promise.all([
        pg.query(
          `SELECT
             sal.id,
             sal.event_type,
             sal.actor_user_id,
             u.email        AS actor_email,
             u.name         AS actor_name,
             sal.resource_type,
             sal.resource_id,
             sal.ip_address,
             sal.payload    AS metadata,
             sal.created_at
           FROM security_audit_log sal
           LEFT JOIN users u ON u.id = sal.actor_user_id
           WHERE ${where}
           ORDER BY sal.created_at DESC, sal.id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
        pg.query(
          `SELECT COUNT(*) AS total FROM security_audit_log sal WHERE ${where}`,
          params
        ),
      ]);

      const total       = parseInt(countResult.rows[0].total as string, 10);
      const total_pages = Math.max(1, Math.ceil(total / limit));

      res.status(200).json({
        events:      rowsResult.rows,
        total,
        page,
        limit,
        total_pages,
      });
    } catch (err) {
      logger.error({ event: "audit_log_list_failed", err }, "GET /api/audit-log failed");
      res.status(500).json({ error: "audit_log_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/audit-log/event-types
   ========================================================= */

router.get(
  "/audit-log/event-types",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  requireAdminRole,
  async (req, res) => {
    const organizationId = (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query(
        `SELECT DISTINCT event_type
         FROM security_audit_log
         WHERE organization_id = $1
         ORDER BY event_type ASC`,
        [organizationId]
      );

      res.status(200).json({
        event_types: result.rows.map((r) => r.event_type as string),
      });
    } catch (err) {
      logger.error({ event: "audit_log_event_types_failed", err }, "GET /api/audit-log/event-types failed");
      res.status(500).json({ error: "audit_log_event_types_failed" });
    }
  }
);

/* =========================================================
   GET /api/audit-log/export.csv
   ========================================================= */

function escapeCsvValue(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get(
  "/audit-log/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  requireAdminRole,
  async (req, res) => {
    const organizationId = (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const conditions: string[] = ["sal.organization_id = $1"];
      const params: unknown[]    = [organizationId];

      if (isNonEmptyString(req.query.event_type)) {
        params.push(req.query.event_type.trim().slice(0, 100));
        conditions.push(`sal.event_type = $${params.length}`);
      }
      if (isUuid(req.query.user_id)) {
        params.push(req.query.user_id.trim());
        conditions.push(`sal.actor_user_id = $${params.length}::uuid`);
      }
      if (isIsoDate(req.query.date_from)) {
        params.push(req.query.date_from.trim());
        conditions.push(`sal.created_at >= $${params.length}::timestamptz`);
      }
      if (isIsoDate(req.query.date_to)) {
        params.push(req.query.date_to.trim());
        conditions.push(`sal.created_at < ($${params.length}::date + interval '1 day')`);
      }

      const where = conditions.join(" AND ");

      const result = await pg.query(
        `SELECT
           sal.created_at,
           sal.event_type,
           u.email         AS actor_email,
           u.name          AS actor_name,
           sal.resource_type,
           sal.resource_id,
           sal.ip_address,
           sal.payload     AS metadata
         FROM security_audit_log sal
         LEFT JOIN users u ON u.id = sal.actor_user_id
         WHERE ${where}
         ORDER BY sal.created_at DESC
         LIMIT $${params.length + 1}`,
        [...params, CSV_MAX]
      );

      writeAuditEvent({
        organizationId,
        actorUserId:   req.userId ?? null,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        eventType:     "data.exported",
        resourceType:  "audit_log",
        payload:       { format: "csv", record_count: result.rows.length, entity: "audit_log" },
        ipAddress:     req.ip ?? null,
      });

      const header = "timestamp,event_type,actor_email,actor_name,resource_type,resource_id,ip_address,metadata";
      const lines  = result.rows.map((r) =>
        [
          r.created_at,
          r.event_type,
          r.actor_email,
          r.actor_name,
          r.resource_type,
          r.resource_id,
          r.ip_address,
          r.metadata,
        ]
          .map(escapeCsvValue)
          .join(",")
      );

      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-${date}.csv"`);
      res.status(200).send([header, ...lines].join("\n"));
    } catch (err) {
      logger.error({ event: "audit_log_export_failed", err }, "GET /api/audit-log/export.csv failed");
      res.status(500).json({ error: "audit_log_export_failed" });
    }
  }
);

export default router;
