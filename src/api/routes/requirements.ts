/**
 * requirements.ts — Framework requirement primitives API
 *
 * Requirements are individual entries within a compliance framework
 * (e.g. "ID.AM-1" in NIST CSF 2.0). They belong to a framework and inherit
 * org scope through it — requirements have no direct organization_id column.
 *
 * Org isolation is enforced by joining requirements → frameworks and
 * verifying frameworks.organization_id matches the requesting org on
 * every route that creates or reads requirements.
 *
 * Routes:
 *   POST  /api/requirements       — create requirement under a framework
 *   GET   /api/requirements       — list requirements (?framework_id required)
 *   GET   /api/requirements/:id   — get single requirement
 *
 * No PATCH. No DELETE. Requirements are reference data in this package.
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateRequirementCreate } from "../lib/requirementValidation.js";

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

const REQUIREMENT_SELECT = `
  r.id,
  r.framework_id,
  r.reference_id,
  r.title,
  r.created_at
`;

/* =========================================================
   POST /api/requirements
   Create a requirement under a framework.
   The framework must belong to the requesting organization.
   ========================================================= */

router.post(
  "/requirements",
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

    const validated = validateRequirementCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the framework exists and belongs to this org.
      // Requirements inherit org scope through their framework.
      const frameworkResult = await client.query(
        `
        SELECT id
        FROM frameworks
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.framework_id, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      let result;
      try {
        result = await client.query(
          `
          INSERT INTO requirements (framework_id, reference_id, title)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            framework_id,
            reference_id,
            title,
            created_at
          `,
          [input.framework_id, input.reference_id, input.title]
        );
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") {
          res.status(409).json({
            error: "requirement_already_exists",
            detail: `A requirement with reference_id "${input.reference_id}" already exists in this framework.`
          });
          return;
        }
        throw err;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "requirement_created",
          organizationId,
          frameworkId: input.framework_id,
          requirementId: result.rows[0]?.id,
          reference_id: input.reference_id
        },
        "Requirement created"
      );

      res.status(201).json({ requirement: result.rows[0] });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "requirement_create_failed", err },
        "POST /api/requirements failed"
      );
      res.status(500).json({ error: "requirement_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/requirements
   List requirements for a framework.
   ?framework_id=<uuid> is required.
   The framework must belong to the requesting organization.
   Supports cursor pagination.
   ========================================================= */

router.get(
  "/requirements",
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

    // framework_id filter is required — requirements are always scoped to a framework
    const filterFrameworkId = isNonEmptyString(req.query.framework_id)
      ? req.query.framework_id.trim()
      : null;

    if (filterFrameworkId === null) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(filterFrameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
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

      // Verify the framework belongs to this org before returning its requirements.
      const frameworkResult = await pg.query(
        `
        SELECT id
        FROM frameworks
        WHERE id = $1
          AND organization_id = $2
        `,
        [filterFrameworkId, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      const conditions: string[] = ["r.framework_id = $1"];
      const params: unknown[] = [filterFrameworkId];

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(r.created_at, r.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${REQUIREMENT_SELECT}
        FROM requirements r
        WHERE ${conditions.join(" AND ")}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const requirements = result.rows;
      const last =
        requirements.length > 0 ? requirements[requirements.length - 1] : null;

      res.status(200).json({
        count: requirements.length,
        limit,
        frameworkId: filterFrameworkId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        requirements
      });
    } catch (err) {
      logger.error(
        { event: "requirements_list_failed", err },
        "GET /api/requirements failed"
      );
      res.status(500).json({ error: "requirements_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/requirements/:id
   Get a single requirement.
   Org isolation enforced via join through framework.
   Returns 404 if not found or if the requirement's framework
   belongs to a different organization.
   ========================================================= */

router.get(
  "/requirements/:id",
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

    const requirementId = String(req.params["id"] ?? "").trim();
    if (!requirementId) {
      res.status(400).json({ error: "requirement_id_required" });
      return;
    }
    if (!isUuid(requirementId)) {
      res.status(400).json({ error: "requirement_id_must_be_uuid" });
      return;
    }

    try {
      // Join through frameworks to enforce org scope.
      // requirements has no organization_id — isolation is via framework ownership.
      const result = await pg.query(
        `
        SELECT ${REQUIREMENT_SELECT}
        FROM requirements r
        JOIN frameworks f ON f.id = r.framework_id
        WHERE r.id = $1
          AND f.organization_id = $2
        `,
        [requirementId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "requirement_not_found" });
        return;
      }

      res.status(200).json({ requirement: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "requirement_get_failed", err },
        "GET /api/requirements/:id failed"
      );
      res.status(500).json({ error: "requirement_get_failed" });
    }
  }
);

export default router;
