/**
 * auditLog.ts — GET /api/audit-log
 *
 * Returns paginated security audit events for the requesting organization.
 * Requires premium entitlement.
 *
 * Query params:
 *   limit          — rows per page (1–100, default 25)
 *   before_id      — cursor: UUID of the oldest row from the previous page
 *   before_created_at — cursor: ISO timestamp of the oldest row from the previous page
 *   event_type     — filter by exact event_type
 *   resource_type  — filter by resource_type
 *   resource_id    — filter by resource_id (UUID)
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseLimit(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

router.get(
  "/audit-log",
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

    try {
      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = isNonEmptyString(req.query.before_created_at)
        ? req.query.before_created_at
        : null;
      const beforeId = isUuid(req.query.before_id) ? req.query.before_id : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["sal.organization_id = $1"];
      const params: unknown[] = [organizationId];

      // Optional filters
      if (isNonEmptyString(req.query.event_type)) {
        params.push((req.query.event_type as string).trim().slice(0, 100));
        conditions.push(`sal.event_type = $${params.length}`);
      }

      if (isNonEmptyString(req.query.resource_type)) {
        params.push((req.query.resource_type as string).trim().slice(0, 100));
        conditions.push(`sal.resource_type = $${params.length}`);
      }

      if (isUuid(req.query.resource_id)) {
        params.push(req.query.resource_id);
        conditions.push(`sal.resource_id = $${params.length}::uuid`);
      }

      if (useCursor) {
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(sal.created_at, sal.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT
          sal.id,
          sal.organization_id,
          sal.actor_api_key_id,
          sal.actor_user_id,
          u.name  AS actor_name,
          u.email AS actor_email,
          sal.event_type,
          sal.resource_type,
          sal.resource_id,
          sal.payload,
          sal.ip_address,
          sal.created_at
        FROM security_audit_log sal
        LEFT JOIN users u ON u.id = sal.actor_user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY sal.created_at DESC, sal.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const events = result.rows;
      const last = events.length > 0 ? events[events.length - 1] : null;

      res.status(200).json({
        count: events.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        events
      });
    } catch (err) {
      logger.error(
        { event: "audit_log_list_failed", err },
        "GET /api/audit-log failed"
      );
      res.status(500).json({ error: "audit_log_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/audit-log/export.csv
   ========================================================= */

const CSV_MAX = 10000;

function escapeCsvValue(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: Record<string, unknown>): string {
  return [
    row["created_at"],
    row["event_type"],
    row["resource_type"],
    row["resource_id"],
    row["actor_name"],
    row["actor_email"],
    row["payload"]
  ]
    .map(escapeCsvValue)
    .join(",");
}

router.get(
  "/audit-log/export.csv",
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

    try {
      const result = await pg.query(
        `
        SELECT
          sal.created_at,
          sal.event_type,
          sal.resource_type,
          sal.resource_id,
          u.name  AS actor_name,
          u.email AS actor_email,
          sal.payload
        FROM security_audit_log sal
        LEFT JOIN users u ON u.id = sal.actor_user_id
        WHERE sal.organization_id = $1
        ORDER BY sal.created_at DESC
        LIMIT $2
        `,
        [organizationId, CSV_MAX]
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "audit_log",
        payload:        { format: "csv", record_count: result.rows.length, entity: "audit_log" },
        ipAddress:      req.ip ?? null
      });

      const header = "timestamp,event_type,resource_type,resource_id,actor_name,actor_email,payload";
      const lines = result.rows.map((r) => rowToCsv(r as Record<string, unknown>));
      const csv = [header, ...lines].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-log.csv"`
      );
      res.status(200).send(csv);
    } catch (err) {
      logger.error(
        { event: "audit_log_export_failed", err },
        "GET /api/audit-log/export.csv failed"
      );
      res.status(500).json({ error: "audit_log_export_failed" });
    }
  }
);

export default router;
