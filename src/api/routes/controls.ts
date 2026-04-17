/**
 * controls.ts — Control primitives API
 *
 * Controls are org-specific implementations of security or compliance measures.
 * Every control record is org-scoped. Controls are structural objects in this
 * package — they hold no assessment status, no scoring, and produce no findings.
 * Those behaviors belong to the control-assessment-workflow package.
 *
 * Routes:
 *   POST  /api/controls       — create control
 *   GET   /api/controls       — list controls (cursor paginated)
 *   GET   /api/controls/:id   — get single control
 *
 * No PATCH. No DELETE. Not in scope for this package.
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateControlCreate } from "../lib/controlValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

const CONTROL_SELECT = `
  id,
  organization_id,
  name,
  description,
  owner_user_id,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/controls
   Create a control for the requesting organization.
   ========================================================= */

router.post(
  "/controls",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateControlCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const result = await pg.query(
        `
        INSERT INTO controls (organization_id, name, description, owner_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING ${CONTROL_SELECT}
        `,
        [
          organizationId,
          input.name,
          input.description ?? null,
          input.owner_user_id ?? (req as any).autoUserId ?? null
        ]
      );

      logger.info(
        {
          event: "control_created",
          organizationId,
          controlId: result.rows[0]?.id,
          name: input.name
        },
        "Control created"
      );

      res.status(201).json({ control: result.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({
          error: "control_name_already_exists",
          name: input.name
        });
        return;
      }

      logger.error(
        { event: "control_create_failed", err },
        "POST /api/controls failed"
      );
      res.status(500).json({ error: "control_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/controls
   List controls for the requesting organization.
   Supports cursor pagination.
   ========================================================= */

router.get(
  "/controls",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
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
      const beforeId = isNonEmptyString(req.query.before_id)
        ? req.query.before_id
        : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }
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
        SELECT ${CONTROL_SELECT}
        FROM controls
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const controls = result.rows;
      const last = controls.length > 0 ? controls[controls.length - 1] : null;

      res.status(200).json({
        count: controls.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        controls
      });
    } catch (err) {
      logger.error(
        { event: "controls_list_failed", err },
        "GET /api/controls failed"
      );
      res.status(500).json({ error: "controls_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/controls/:id
   Get a single control. Returns 404 if not found or if
   the control belongs to a different organization.
   ========================================================= */

router.get(
  "/controls/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const controlId = String(req.params["id"] ?? "").trim();
    if (!controlId) {
      res.status(400).json({ error: "control_id_required" });
      return;
    }
    if (!isUuid(controlId)) {
      res.status(400).json({ error: "control_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${CONTROL_SELECT}
        FROM controls
        WHERE id = $1
          AND organization_id = $2
        `,
        [controlId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "control_not_found" });
        return;
      }

      res.status(200).json({ control: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "control_get_failed", err },
        "GET /api/controls/:id failed"
      );
      res.status(500).json({ error: "control_get_failed" });
    }
  }
);

export default router;
