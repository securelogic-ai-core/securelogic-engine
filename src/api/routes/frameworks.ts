/**
 * frameworks.ts — Compliance framework primitives API
 *
 * Frameworks are org-scoped records that represent a compliance or regulatory
 * standard an organization tracks (e.g. NIST CSF 2.0, ISO 27001:2022).
 * Each framework belongs to exactly one organization.
 *
 * Routes:
 *   POST  /api/frameworks       — create framework
 *   GET   /api/frameworks       — list frameworks for org (cursor paginated)
 *   GET   /api/frameworks/:id   — get single framework
 *
 * No PATCH. No DELETE. Frameworks are immutable once created in this package.
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateFrameworkCreate } from "../lib/frameworkValidation.js";

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

const FRAMEWORK_SELECT = `
  id,
  organization_id,
  name,
  version,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/frameworks
   Create a compliance framework for the requesting organization.
   ========================================================= */

router.post(
  "/frameworks",
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

    const validated = validateFrameworkCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const result = await pg.query(
        `
        INSERT INTO frameworks (organization_id, name, version)
        VALUES ($1, $2, $3)
        RETURNING ${FRAMEWORK_SELECT}
        `,
        [organizationId, input.name, input.version]
      );

      logger.info(
        {
          event: "framework_created",
          organizationId,
          frameworkId: result.rows[0]?.id,
          name: input.name,
          version: input.version
        },
        "Framework created"
      );

      res.status(201).json({ framework: result.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({
          error: "framework_already_exists",
          detail: `A framework named "${input.name}" version "${input.version}" already exists for this organization.`
        });
        return;
      }

      logger.error(
        { event: "framework_create_failed", err },
        "POST /api/frameworks failed"
      );
      res.status(500).json({ error: "framework_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/frameworks
   List frameworks for the requesting organization.
   Supports cursor pagination.
   ========================================================= */

router.get(
  "/frameworks",
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
        SELECT ${FRAMEWORK_SELECT}
        FROM frameworks
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const frameworks = result.rows;
      const last = frameworks.length > 0 ? frameworks[frameworks.length - 1] : null;

      res.status(200).json({
        count: frameworks.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        frameworks
      });
    } catch (err) {
      logger.error(
        { event: "frameworks_list_failed", err },
        "GET /api/frameworks failed"
      );
      res.status(500).json({ error: "frameworks_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/frameworks/:id
   Get a single framework. Returns 404 if not found or
   if the framework belongs to a different organization.
   ========================================================= */

router.get(
  "/frameworks/:id",
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

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!frameworkId) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${FRAMEWORK_SELECT}
        FROM frameworks
        WHERE id = $1
          AND organization_id = $2
        `,
        [frameworkId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      res.status(200).json({ framework: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "framework_get_failed", err },
        "GET /api/frameworks/:id failed"
      );
      res.status(500).json({ error: "framework_get_failed" });
    }
  }
);

export default router;
