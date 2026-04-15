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

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      // Optional filters
      if (isNonEmptyString(req.query.event_type)) {
        params.push((req.query.event_type as string).trim().slice(0, 100));
        conditions.push(`event_type = $${params.length}`);
      }

      if (isNonEmptyString(req.query.resource_type)) {
        params.push((req.query.resource_type as string).trim().slice(0, 100));
        conditions.push(`resource_type = $${params.length}`);
      }

      if (isUuid(req.query.resource_id)) {
        params.push(req.query.resource_id);
        conditions.push(`resource_id = $${params.length}::uuid`);
      }

      if (useCursor) {
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT
          id,
          organization_id,
          actor_api_key_id,
          event_type,
          resource_type,
          resource_id,
          payload,
          ip_address,
          created_at
        FROM security_audit_log
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
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

export default router;
