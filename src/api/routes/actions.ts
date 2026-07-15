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
import { asTenant } from "../middleware/asTenant.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { validateActionCreate } from "../lib/actionValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { recomputeFindingOperationalStatus } from "../lib/findingLifecycle.js";
import { sqlActionActive, sqlActionOverdue } from "../lib/metricDefinitions.js";
import { resolveOwnerMeFilter } from "../lib/findingListFilters.js";

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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      // Child→parent cascade (finding-lifecycle-spec §5): a new remediation
      // Action recomputes the parent Finding's derived operational_status in
      // THIS same tenant transaction (e.g. a remediated finding regresses to
      // open when new work is added). Org-scoped inside the recompute.
      if (input.source_type === "finding" && input.source_id) {
        const recompute = await recomputeFindingOperationalStatus(
          organizationId,
          input.source_id,
          {
            actorUserId: ((req as any).userId as string | undefined) ?? null,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          }
        );
        if (recompute.changed && recompute.auditEvent) {
          writeAuditEvent({
            organizationId,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
            actorUserId: (req as any).userId ?? null,
            eventType: recompute.auditEvent,
            resourceType: "finding",
            resourceId: input.source_id,
            payload: { from: recompute.fromState ?? null, to: recompute.toState ?? null, trigger: "action.created" },
            ipAddress: req.ip ?? null,
          });
        }
      }

      res.status(201).json({ action: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "action_create_failed", err },
        "POST /api/actions failed"
      );
      res.status(500).json({ error: "action_create_failed" });
    }
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      // owner=me — the caller's own remediation ("My Actions").
      //
      // This filter has to exist SERVER-SIDE. Before it did, /actions?view=mine fetched
      // the org's actions and filtered them in the app — over a page the engine silently
      // capped at MAX_LIMIT (100). In any org with more than 100 actions a user's own
      // assigned work could fall outside that page and simply not be shown, with no
      // truncation disclosed. Silent loss of a person's work queue.
      //
      // Same security contract as the Findings list (resolveOwnerMeFilter, shared): the
      // ONLY accepted value is the literal "me", and the user id resolves from the SESSION
      // — a client can never pass a user id, so assignments cannot be enumerated. An
      // API-key caller has no user identity and is rejected, never defaulted to unfiltered.
      const ownerFilter = resolveOwnerMeFilter(req.query.owner, (req.userId as string | undefined) ?? null);
      if (ownerFilter.kind === "error") {
        res.status(400).json({ error: ownerFilter.error });
        return;
      }
      if (ownerFilter.kind === "me") {
        params.push(ownerFilter.userId);
        conditions.push(`owner_user_id = $${params.length}`);
      }

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

      // `active=true` — the destination for every ACTIVE actions count.
      //
      // Without it, the dashboard's "N active actions" tile had no URL that could
      // reproduce it: the only status filter was a single exact `status=`, so the
      // tile's link fell back to the org-wide list and showed closed and accepted
      // actions alongside the N it promised. The count and its destination could
      // not agree BY CONSTRUCTION. Built from the contract, so they now do.
      if (req.query.active === "true") {
        conditions.push(sqlActionActive());
      }

      // Overdue comes from the contract too. The hand-rolled predicate this
      // replaces (`status NOT IN ('closed','accepted')`) matched the contract only
      // because a CHECK constraint happens to permit exactly five statuses — add a
      // sixth (`deferred`, `cancelled`) and the list would have silently diverged
      // from the count with no test failing.
      const overdue = req.query.overdue === "true";
      if (overdue) {
        conditions.push(sqlActionOverdue());
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

      // Snapshot the filter set BEFORE the cursor + limit params so the total
      // COUNT reflects the SAME filters (cursor excluded) — pagination truth,
      // mirroring GET /api/findings so a capped page can honestly disclose
      // "showing N of <total>" instead of silently truncating at MAX_LIMIT.
      const preCursorConditions = [...conditions];
      const preCursorParams = [...params];

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
          status, created_at, updated_at, completed_at,
          blocked_reason, blocked_dependency, blocked_owner_user_id,
          blocked_expected_unblock_date,
          -- Overdue is decided HERE, by the contract, and shipped as a field.
          -- The client used to re-derive it against NOW() rather than CURRENT_DATE,
          -- so an action due TODAY wore a red "overdue" badge in this very list
          -- while being excluded from the dashboard's overdue count and from
          -- ?overdue=true. One definition, one wire field.
          (${sqlActionOverdue()}) AS is_overdue
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

      // Exact total for the SAME filter set (cursor excluded) — pagination truth.
      const totalRow = await pg.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM actions WHERE ${preCursorConditions.join(" AND ")}`,
        preCursorParams
      );
      const total = parseInt(totalRow.rows[0]?.total ?? "0", 10);

      const actions = result.rows;
      const last = actions.length > 0 ? actions[actions.length - 1] : null;

      res.status(200).json({
        count: actions.length,
        limit,
        total,
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
  })
);

/* =========================================================
   GET /api/actions/summary
   Aggregate counts for actions scoped to the org.
   ========================================================= */

router.get(
  "/actions/summary",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      // Metric Contract: every predicate comes from metricDefinitions — the
      // SAME definitions the dashboard uses, so tiles and this destination
      // page reconcile exactly. open_count = ACTIVE (open|in_progress|blocked);
      // overdue compares DATE against CURRENT_DATE (a due-today action is not
      // overdue anywhere).
      // The caller's own identity, for the "mine" counters below. An API-key caller has no
      // user, so its my_* counts are 0 — not the org's totals. A queue that says "yours"
      // must never quietly widen to everyone's.
      const viewerUserId = (req as { userId?: string }).userId ?? null;

      const result = await pg.query<{
        open_count: string;
        open_only_count: string;
        in_progress_count: string;
        blocked_count: string;
        overdue_count: string;
        immediate_count: string;
        closed_count: string;
        my_open_count: string;
        my_overdue_count: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE ${sqlActionActive()})                          AS open_count,
          COUNT(*) FILTER (WHERE status = 'open')                               AS open_only_count,
          COUNT(*) FILTER (WHERE status = 'in_progress')                        AS in_progress_count,
          COUNT(*) FILTER (WHERE status = 'blocked')                            AS blocked_count,
          COUNT(*) FILTER (WHERE ${sqlActionOverdue()})                         AS overdue_count,
          COUNT(*) FILTER (WHERE priority = 'immediate' AND ${sqlActionActive()}) AS immediate_count,
          COUNT(*) FILTER (WHERE status = 'closed')                             AS closed_count,
          -- The SAME predicates, narrowed to the caller. These are what the "My Actions"
          -- tiles must read: computing them by filtering a fetched page is how a user's
          -- work went missing in the first place.
          COUNT(*) FILTER (WHERE ${sqlActionActive()}
                             AND $2::uuid IS NOT NULL
                             AND owner_user_id = $2::uuid)                      AS my_open_count,
          COUNT(*) FILTER (WHERE ${sqlActionOverdue()}
                             AND $2::uuid IS NOT NULL
                             AND owner_user_id = $2::uuid)                      AS my_overdue_count
        FROM actions
        WHERE organization_id = $1
        `,
        [organizationId, viewerUserId]
      );

      const row = result.rows[0];
      res.status(200).json({
        summary: {
          open_count:        parseInt(row?.open_count ?? "0", 10),
          open_only_count:   parseInt(row?.open_only_count ?? "0", 10),
          in_progress_count: parseInt(row?.in_progress_count ?? "0", 10),
          blocked_count:     parseInt(row?.blocked_count ?? "0", 10),
          overdue_count:     parseInt(row?.overdue_count ?? "0", 10),
          immediate_count:   parseInt(row?.immediate_count ?? "0", 10),
          closed_count:      parseInt(row?.closed_count ?? "0", 10),
          my_open_count:     parseInt(row?.my_open_count ?? "0", 10),
          my_overdue_count:  parseInt(row?.my_overdue_count ?? "0", 10),
        },
      });
    } catch (err) {
      logger.error({ event: "actions_summary_failed", err }, "GET /api/actions/summary failed");
      res.status(500).json({ error: "actions_summary_failed" });
    }
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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
          status, created_at, updated_at, completed_at,
          blocked_reason, blocked_dependency, blocked_owner_user_id,
          blocked_expected_unblock_date
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
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      // R-10: structured blocker metadata. All optional (a block can carry just a
      // reason). Free-text fields are trimmed and treated as null when empty so a
      // cleared field is a real null, not "". The owner FK and the date reuse the
      // same validation shape as owner_user_id / due_date above.
      if ("blocked_reason" in body) {
        const v = body["blocked_reason"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "blocked_reason_must_be_string_or_null" });
          return;
        }
        const trimmed = typeof v === "string" ? v.trim() : "";
        values.push(trimmed.length > 0 ? trimmed : null);
        updates.push(`blocked_reason = $${values.length}`);
      }

      if ("blocked_dependency" in body) {
        const v = body["blocked_dependency"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "blocked_dependency_must_be_string_or_null" });
          return;
        }
        const trimmed = typeof v === "string" ? v.trim() : "";
        values.push(trimmed.length > 0 ? trimmed : null);
        updates.push(`blocked_dependency = $${values.length}`);
      }

      if ("blocked_owner_user_id" in body) {
        const v = body["blocked_owner_user_id"];
        if (v !== null && !isUuid(v)) {
          res.status(400).json({ error: "blocked_owner_user_id_must_be_uuid_or_null" });
          return;
        }
        values.push(v ?? null);
        updates.push(`blocked_owner_user_id = $${values.length}`);
      }

      if ("blocked_expected_unblock_date" in body) {
        const v = body["blocked_expected_unblock_date"];
        if (v !== null && !isIsoDate(v)) {
          res.status(400).json({ error: "blocked_expected_unblock_date_must_be_yyyy_mm_dd_or_null" });
          return;
        }
        values.push(v ?? null);
        updates.push(`blocked_expected_unblock_date = $${values.length}`);
      }

      if (updates.length === 0) {
        res.status(400).json({
          error: "no_updateable_fields",
          updatable: [
            "status", "priority", "owner_user_id", "due_date",
            "blocked_reason", "blocked_dependency", "blocked_owner_user_id",
            "blocked_expected_unblock_date"
          ]
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
          id, organization_id, title, source_type, source_id, priority,
          status, owner_user_id, due_date, updated_at, completed_at,
          blocked_reason, blocked_dependency, blocked_owner_user_id,
          blocked_expected_unblock_date
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
        payload: {
          status: updatedStatus ?? null,
          owner_user_id: result.rows[0].owner_user_id ?? null,
          due_date: result.rows[0].due_date ?? null,
        },
        ipAddress: req.ip ?? null,
      });

      // Child→parent cascade (finding-lifecycle-spec §5): ANY status write on a
      // finding-sourced Action recomputes the parent Finding's derived
      // operational_status in THIS same tenant transaction — the direct fix for
      // "closed remediation on an open finding". The parent surfaces in the
      // ready-for-decision queue when all work is terminal; the system never
      // writes decision_state (R3).
      if (
        "status" in body &&
        result.rows[0].source_type === "finding" &&
        result.rows[0].source_id
      ) {
        const parentFindingId = String(result.rows[0].source_id);
        const recompute = await recomputeFindingOperationalStatus(
          organizationId,
          parentFindingId,
          {
            actorUserId: ((req as any).userId as string | undefined) ?? null,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          }
        );
        if (recompute.changed && recompute.auditEvent) {
          writeAuditEvent({
            organizationId,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
            actorUserId: (req as any).userId ?? null,
            eventType: recompute.auditEvent,
            resourceType: "finding",
            resourceId: parentFindingId,
            payload: { from: recompute.fromState ?? null, to: recompute.toState ?? null, trigger: "action.status_changed" },
            ipAddress: req.ip ?? null,
          });
        }
      }

      res.status(200).json({ action: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "action_patch_failed", err },
        "PATCH /api/actions/:id failed"
      );
      res.status(500).json({ error: "action_patch_failed" });
    }
  })
);

export default router;
