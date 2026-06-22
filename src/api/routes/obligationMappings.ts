/**
 * obligationMappings.ts — Obligation-to-requirement mapping API
 *
 * An obligation mapping records that a regulatory obligation is addressed by
 * (or related to) a specific framework requirement. The mapping table has no
 * organization_id column — org isolation is enforced in every route handler by
 * verifying that:
 *   1. obligation.organization_id matches the requesting org
 *   2. requirement → framework.organization_id matches the requesting org
 *
 * Routes:
 *   POST  /api/obligation-mappings   — create a mapping
 *   GET   /api/obligation-mappings   — list mappings (?obligation_id or ?requirement_id required)
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
import { validateObligationMappingCreate } from "../lib/obligationValidation.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* =========================================================
   POST /api/obligation-mappings
   Link an obligation to a requirement.
   Both must belong to the requesting organization:
     - obligation.organization_id must match
     - requirement → framework.organization_id must match
   ========================================================= */

router.post(
  "/obligation-mappings",
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

    const validated = validateObligationMappingCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the obligation exists and belongs to this org.
      const obligationResult = await client.query(
        `
        SELECT id
        FROM obligations
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.obligation_id, organizationId]
      );

      if ((obligationResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "obligation_not_found" });
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
          INSERT INTO obligation_mappings (obligation_id, requirement_id)
          VALUES ($1::uuid, $2::uuid)
          RETURNING id, obligation_id, requirement_id, created_at
          `,
          [input.obligation_id, input.requirement_id]
        );
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") {
          res.status(409).json({
            error: "obligation_mapping_already_exists",
            detail: "This obligation is already mapped to this requirement."
          });
          return;
        }
        throw err;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "obligation_mapping_created",
          organizationId,
          mappingId: result.rows[0]?.id,
          obligationId: input.obligation_id,
          requirementId: input.requirement_id
        },
        "Obligation mapping created"
      );

      res.status(201).json({ obligation_mapping: result.rows[0] });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "obligation_mapping_create_failed", err },
        "POST /api/obligation-mappings failed"
      );
      res.status(500).json({ error: "obligation_mapping_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/obligation-mappings
   List obligation mappings.
   Requires ?obligation_id=<uuid> OR ?requirement_id=<uuid>.
   Org isolation enforced via join to obligations or frameworks table.
   ========================================================= */

router.get(
  "/obligation-mappings",
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

    const filterObligationId = isNonEmptyString(req.query.obligation_id)
      ? (req.query.obligation_id as string).trim()
      : null;
    const filterRequirementId = isNonEmptyString(req.query.requirement_id)
      ? (req.query.requirement_id as string).trim()
      : null;

    if (filterObligationId === null && filterRequirementId === null) {
      res.status(400).json({
        error: "filter_required",
        detail: "Provide ?obligation_id or ?requirement_id"
      });
      return;
    }

    if (filterObligationId !== null && !isUuid(filterObligationId)) {
      res.status(400).json({ error: "obligation_id_must_be_uuid" });
      return;
    }

    if (filterRequirementId !== null && !isUuid(filterRequirementId)) {
      res.status(400).json({ error: "requirement_id_must_be_uuid" });
      return;
    }

    try {
      if (filterObligationId !== null) {
        // Fetch by obligation_id.
        // Verify the obligation belongs to this org first.
        const orgCheck = await pg.query(
          `SELECT id FROM obligations WHERE id = $1 AND organization_id = $2`,
          [filterObligationId, organizationId]
        );
        if ((orgCheck.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "obligation_not_found" });
          return;
        }

        const result = await pg.query(
          `
          SELECT
            om.id,
            om.obligation_id,
            om.requirement_id,
            om.created_at,
            r.framework_id,
            r.reference_id,
            r.title   AS requirement_title,
            r.created_at AS requirement_created_at
          FROM obligation_mappings om
          JOIN requirements r ON r.id = om.requirement_id
          WHERE om.obligation_id = $1
          ORDER BY om.created_at DESC, om.id DESC
          `,
          [filterObligationId]
        );

        res.status(200).json({
          count: result.rows.length,
          obligationId: filterObligationId,
          obligation_mappings: result.rows.map((row) => ({
            id: row.id,
            obligation_id: row.obligation_id,
            requirement_id: row.requirement_id,
            created_at: row.created_at,
            requirement: {
              id: row.requirement_id,
              framework_id: row.framework_id,
              reference_id: row.reference_id,
              title: row.requirement_title,
              created_at: row.requirement_created_at
            }
          }))
        });
        return;
      }

      // filterRequirementId is non-null here.
      // Verify the requirement belongs to this org (via framework).
      const orgCheck = await pg.query(
        `
        SELECT r.id
        FROM requirements r
        JOIN frameworks f ON f.id = r.framework_id
        WHERE r.id = $1
          AND f.organization_id = $2
        `,
        [filterRequirementId, organizationId]
      );
      if ((orgCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "requirement_not_found" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          om.id,
          om.obligation_id,
          om.requirement_id,
          om.created_at,
          o.organization_id,
          o.title            AS obligation_title,
          o.description      AS obligation_description,
          o.source_regulation,
          o.jurisdiction,
          o.domain,
          o.status,
          o.priority,
          o.due_date,
          o.owner_user_id,
          o.notes,
          o.created_at       AS obligation_created_at,
          o.updated_at       AS obligation_updated_at
        FROM obligation_mappings om
        JOIN obligations o ON o.id = om.obligation_id
        WHERE om.requirement_id = $1
          AND o.organization_id = $2
        ORDER BY om.created_at DESC, om.id DESC
        `,
        [filterRequirementId, organizationId]
      );

      res.status(200).json({
        count: result.rows.length,
        requirementId: filterRequirementId,
        obligation_mappings: result.rows.map((row) => ({
          id: row.id,
          obligation_id: row.obligation_id,
          requirement_id: row.requirement_id,
          created_at: row.created_at,
          obligation: {
            id: row.obligation_id,
            organization_id: row.organization_id,
            title: row.obligation_title,
            description: row.obligation_description,
            source_regulation: row.source_regulation,
            jurisdiction: row.jurisdiction,
            domain: row.domain,
            status: row.status,
            priority: row.priority,
            due_date: row.due_date,
            owner_user_id: row.owner_user_id,
            notes: row.notes,
            created_at: row.obligation_created_at,
            updated_at: row.obligation_updated_at
          }
        }))
      });
    } catch (err) {
      logger.error(
        { event: "obligation_mappings_list_failed", err },
        "GET /api/obligation-mappings failed"
      );
      res.status(500).json({ error: "obligation_mappings_list_failed" });
    }
  }
);

export default router;
