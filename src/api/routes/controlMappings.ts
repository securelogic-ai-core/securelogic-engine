/**
 * controlMappings.ts — Control-to-requirement mapping API
 *
 * A control mapping records that an org's control satisfies a specific
 * framework requirement. The mapping table has no organization_id column —
 * org isolation is enforced in every route handler by verifying that:
 *   1. control.organization_id matches the requesting org
 *   2. requirement → framework.organization_id matches the requesting org
 *
 * Routes:
 *   POST  /api/control-mappings   — create a mapping
 *   GET   /api/control-mappings   — list mappings (?control_id or ?requirement_id required)
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
import { validateControlMappingCreate } from "../lib/controlMappingValidation.js";

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

const MAPPING_SELECT = `
  cm.id,
  cm.control_id,
  cm.requirement_id,
  cm.created_at
`;

/* =========================================================
   POST /api/control-mappings
   Link a control to a requirement.
   Both must belong to the requesting organization:
     - control.organization_id must match
     - requirement → framework.organization_id must match
   ========================================================= */

router.post(
  "/control-mappings",
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

    const validated = validateControlMappingCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the control exists and belongs to this org.
      const controlResult = await client.query(
        `
        SELECT id
        FROM controls
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.control_id, organizationId]
      );

      if ((controlResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "control_not_found" });
        return;
      }

      // Verify the requirement exists and its framework belongs to this org.
      const requirementResult = await client.query(
        `
        SELECT r.id
        FROM requirements r
        JOIN frameworks f ON f.id = r.framework_id
        WHERE r.id = $1
          AND f.organization_id = $2
        FOR UPDATE
        `,
        [input.requirement_id, organizationId]
      );

      if ((requirementResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "requirement_not_found" });
        return;
      }

      let result;
      try {
        result = await client.query(
          `
          INSERT INTO control_mappings (control_id, requirement_id)
          VALUES ($1::uuid, $2::uuid)
          RETURNING
            id,
            control_id,
            requirement_id,
            created_at
          `,
          [input.control_id, input.requirement_id]
        );
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") {
          res.status(409).json({
            error: "control_mapping_already_exists",
            detail: "This control is already mapped to this requirement."
          });
          return;
        }
        throw err;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "control_mapping_created",
          organizationId,
          mappingId: result.rows[0]?.id,
          controlId: input.control_id,
          requirementId: input.requirement_id
        },
        "Control mapping created"
      );

      res.status(201).json({ control_mapping: result.rows[0] });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "control_mapping_create_failed", err },
        "POST /api/control-mappings failed"
      );
      res.status(500).json({ error: "control_mapping_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/control-mappings
   List control mappings.
   Requires ?control_id=<uuid> OR ?requirement_id=<uuid>.
   Org isolation enforced via join to controls table.
   Supports cursor pagination.
   ========================================================= */

router.get(
  "/control-mappings",
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

    const filterControlId = isNonEmptyString(req.query.control_id)
      ? req.query.control_id.trim()
      : null;
    const filterRequirementId = isNonEmptyString(req.query.requirement_id)
      ? req.query.requirement_id.trim()
      : null;

    // At least one filter is required — unfiltered listing is not supported
    if (filterControlId === null && filterRequirementId === null) {
      res.status(400).json({
        error: "filter_required",
        detail: "Provide ?control_id or ?requirement_id"
      });
      return;
    }

    if (filterControlId !== null && !isUuid(filterControlId)) {
      res.status(400).json({ error: "control_id_must_be_uuid" });
      return;
    }

    if (filterRequirementId !== null && !isUuid(filterRequirementId)) {
      res.status(400).json({ error: "requirement_id_must_be_uuid" });
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

      // Always join to controls to enforce org isolation.
      // control_mappings has no organization_id — org scope is via controls.
      const conditions: string[] = ["c.organization_id = $1"];
      const params: unknown[] = [organizationId];

      if (filterControlId !== null) {
        params.push(filterControlId);
        conditions.push(`cm.control_id = $${params.length}::uuid`);
      }

      if (filterRequirementId !== null) {
        params.push(filterRequirementId);
        conditions.push(`cm.requirement_id = $${params.length}::uuid`);
      }

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(cm.created_at, cm.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${MAPPING_SELECT}
        FROM control_mappings cm
        JOIN controls c ON c.id = cm.control_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY cm.created_at DESC, cm.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const mappings = result.rows;
      const last = mappings.length > 0 ? mappings[mappings.length - 1] : null;

      res.status(200).json({
        count: mappings.length,
        limit,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        control_mappings: mappings
      });
    } catch (err) {
      logger.error(
        { event: "control_mappings_list_failed", err },
        "GET /api/control-mappings failed"
      );
      res.status(500).json({ error: "control_mappings_list_failed" });
    }
  }
);

export default router;
