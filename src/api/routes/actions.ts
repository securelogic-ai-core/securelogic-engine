/**
 * actions.ts — Platform-level actions API
 *
 * Actions are a first-class platform primitive: they represent specific
 * remediation tasks tied to findings, assessments, signals, or created
 * manually. They are org-scoped, owned, status-tracked, and due-dated.
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateActionCreate } from "../lib/actionValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);
const VALID_STATUSES = new Set(["open", "in_progress", "blocked", "closed", "accepted"]);

// ----------------------------------------------------------------
// Route-level helpers (not exported — use actionValidation for create validation)
// ----------------------------------------------------------------

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isIsoDate(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/* =========================================================
   POST /api/actions
   Create a new action. org-scoped to the calling organization.
   ========================================================= */

router.post(
  "/actions",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const validated = validateActionCreate(req.body);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }

      const { input } = validated;

      const result = await pg.query(
        `
        INSERT INTO actions (
          organization_id,
          title,
          description,
          action_type,
          source_type,
          source_id,
          priority,
          due_date,
          owner_user_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
        RETURNING
          id, organization_id, title, description, action_type,
          source_type, source_id, priority, due_date, owner_user_id,
          status, created_at, updated_at
        `,
        [
          organizationId,
          input.title,
          input.description ?? null,
          input.action_type ?? null,
          input.source_type,
          input.source_id ?? null,
          input.priority,
          input.due_date ?? null,
          input.owner_user_id ?? null
        ]
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: (req as any).userId ?? null,
        eventType: "action.created",
        resourceType: "action",
        resourceId: result.rows[0].id as string,
        payload: { priority: input.priority, source_type: input.source_type },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({ action: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "action_create_failed", err },
        "POST /api/actions failed"
      );
      res.status(500).json({ error: "action_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/actions
   List actions for the requesting organization.
   Supports cursor pagination and status/priority filtering.
   ========================================================= */

router.get(
  "/actions",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = isNonEmptyString(req.query.before_created_at)
        ? req.query.before_created_at
        : null;
      const beforeId = isNonEmptyString(req.query.before_id)
        ? req.query.before_id
        : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      const filterStatus = isNonEmptyString(req.query.status)
        ? req.query.status
        : null;
      if (filterStatus !== null) {
        if (!VALID_STATUSES.has(filterStatus)) {
          res.status(400).json({
            error: "invalid_status_filter",
            allowed: [...VALID_STATUSES]
          });
          return;
        }
        params.push(filterStatus);
        conditions.push(`status = $${params.length}`);
      }

      const filterPriority = isNonEmptyString(req.query.priority)
        ? req.query.priority
        : null;
      if (filterPriority !== null) {
        if (!VALID_PRIORITIES.has(filterPriority)) {
          res.status(400).json({
            error: "invalid_priority_filter",
            allowed: [...VALID_PRIORITIES]
          });
          return;
        }
        params.push(filterPriority);
        conditions.push(`priority = $${params.length}`);
      }

      // Filter overdue: due_date < today and status not closed/accepted
      const overdue = req.query.overdue === "true";
      if (overdue) {
        conditions.push("due_date < CURRENT_DATE");
        conditions.push("status NOT IN ('closed', 'accepted')");
      }

      // source_type + source_id: filter by linked source record (e.g. all actions for a finding)
      const filterSourceType = isNonEmptyString(req.query.source_type)
        ? (req.query.source_type as string).trim()
        : null;
      const filterSourceId = isNonEmptyString(req.query.source_id)
        ? (req.query.source_id as string).trim()
        : null;
      if (filterSourceType !== null) {
        params.push(filterSourceType);
        conditions.push(`source_type = $${params.length}`);
      }
      if (filterSourceId !== null) {
        if (!isUuid(filterSourceId)) {
          res.status(400).json({ error: "source_id_must_be_uuid" });
          return;
        }
        params.push(filterSourceId);
        conditions.push(`source_id = $${params.length}::uuid`);
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

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await pg.query(
        `
        SELECT
          id, organization_id, title, description, action_type,
          source_type, source_id, priority, due_date, owner_user_id,
          status, created_at, updated_at, completed_at
        FROM actions
        ${whereClause}
        ORDER BY
          CASE priority
            WHEN 'immediate' THEN 1
            WHEN 'near_term' THEN 2
            WHEN 'planned'   THEN 3
            WHEN 'watch'     THEN 4
            ELSE 5
          END,
          due_date ASC NULLS LAST,
          created_at DESC,
          id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const actions = result.rows;
      const last = actions.length > 0 ? actions[actions.length - 1] : null;

      res.status(200).json({
        count: actions.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        actions
      });
    } catch (err) {
      logger.error(
        { event: "actions_list_failed", err },
        "GET /api/actions failed"
      );
      res.status(500).json({ error: "actions_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/actions/:id
   Get a single action by ID, scoped to the org.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/actions/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const actionId = String(req.params["id"] ?? "").trim();
      if (!actionId) {
        res.status(400).json({ error: "action_id_required" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          id, organization_id, title, description, action_type,
          source_type, source_id, priority, due_date, owner_user_id,
          status, created_at, updated_at, completed_at
        FROM actions
        WHERE id = $1
          AND organization_id = $2
        `,
        [actionId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "action_not_found" });
        return;
      }

      res.status(200).json({ action: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "action_get_failed", err },
        "GET /api/actions/:id failed"
      );
      res.status(500).json({ error: "action_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/actions/:id
   Update status, priority, owner, or due date.
   Automatically sets completed_at when status → closed.
   Returns 404 if the action does not belong to the org.
   ========================================================= */

router.patch(
  "/actions/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const actionId = String(req.params.id ?? "").trim();
      if (!actionId) {
        res.status(400).json({ error: "action_id_required" });
        return;
      }

      const body =
        req.body != null &&
        typeof req.body === "object" &&
        !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const updates: string[] = [];
      const values: unknown[] = [];

      if ("status" in body) {
        const status = body["status"];
        if (!isNonEmptyString(status) || !VALID_STATUSES.has(status)) {
          res.status(400).json({
            error: "invalid_status",
            allowed: [...VALID_STATUSES]
          });
          return;
        }
        values.push(status);
        updates.push(`status = $${values.length}`);

        // Automatically record completion timestamp
        if (status === "closed") {
          updates.push("completed_at = NOW()");
        }
      }

      if ("priority" in body) {
        const priority = body["priority"];
        if (!isNonEmptyString(priority) || !VALID_PRIORITIES.has(priority)) {
          res.status(400).json({
            error: "invalid_priority",
            allowed: [...VALID_PRIORITIES]
          });
          return;
        }
        values.push(priority);
        updates.push(`priority = $${values.length}`);
      }

      if ("owner_user_id" in body) {
        const ownerId = body["owner_user_id"];
        if (ownerId !== null && !isUuid(ownerId)) {
          res.status(400).json({ error: "owner_user_id_must_be_uuid_or_null" });
          return;
        }
        values.push(ownerId ?? null);
        updates.push(`owner_user_id = $${values.length}`);
      }

      if ("due_date" in body) {
        const dueDate = body["due_date"];
        if (dueDate !== null && !isIsoDate(dueDate)) {
          res.status(400).json({ error: "due_date_must_be_yyyy_mm_dd_or_null" });
          return;
        }
        values.push(dueDate ?? null);
        updates.push(`due_date = $${values.length}`);
      }

      if (updates.length === 0) {
        res.status(400).json({
          error: "no_updateable_fields",
          updatable: ["status", "priority", "owner_user_id", "due_date"]
        });
        return;
      }

      values.push(actionId, organizationId);
      const idParam = values.length - 1;
      const orgParam = values.length;

      const result = await pg.query(
        `
        UPDATE actions
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING
          id, organization_id, title, source_type, priority,
          status, owner_user_id, due_date, updated_at, completed_at
        `,
        values
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "action_not_found" });
        return;
      }

      const updatedStatus = result.rows[0].status as string | undefined;
      const eventType =
        "status" in body ? "action.status_changed" : "action.updated";

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: (req as any).userId ?? null,
        eventType,
        resourceType: "action",
        resourceId: actionId,
        payload: { status: updatedStatus ?? null },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ action: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "action_patch_failed", err },
        "PATCH /api/actions/:id failed"
      );
      res.status(500).json({ error: "action_patch_failed" });
    }
  }
);

export default router;
