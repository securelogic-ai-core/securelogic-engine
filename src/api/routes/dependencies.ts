/**
 * dependencies.ts — Dependency primitives API
 *
 * Dependency records are org-scoped primitives tracking external dependencies
 * (software libraries, cloud services, infrastructure, APIs). They are mutable.
 *
 * LINKAGE:
 *   vendor_id (optional) -> vendors table (org-ownership verified on POST and PATCH)
 *
 * NO ASSESSMENT WORKFLOW IN THIS PACKAGE:
 *   No finding creation. No workflow routes. Primitives only.
 *
 * Routes:
 *   POST  /api/dependencies        — create dependency record
 *   GET   /api/dependencies        — list (org-scoped, filterable, cursor paginated)
 *   GET   /api/dependencies/:id    — get single dependency record
 *   PATCH /api/dependencies/:id    — partial update
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import {
  validateDependencyCreate,
  validateDependencyUpdate,
  validateDependencyListQuery
} from "../lib/dependencyValidation.js";

const router = Router();

// ---------------------------------------------------------------------------
// Pure helper — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Aggregate dependency DB rows into a summary object.
 * All canonical criticality, status, and dependency_type keys are always present.
 * Exported for unit testing without a live database.
 */
export function buildDependencySummary(
  byCriticalityRows: ReadonlyArray<{ criticality: string; count: string }>,
  byStatusRows: ReadonlyArray<{ status: string; count: string }>,
  byTypeRows: ReadonlyArray<{ dependency_type: string; count: string }>
): {
  total: number;
  by_criticality: Record<string, number>;
  by_status: Record<string, number>;
  by_dependency_type: Record<string, number>;
} {
  const by_criticality: Record<string, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0
  };
  for (const row of byCriticalityRows) {
    if (row.criticality in by_criticality) {
      by_criticality[row.criticality] = parseInt(row.count, 10);
    }
  }

  const by_status: Record<string, number> = {
    active: 0,
    deprecated: 0,
    under_review: 0
  };
  for (const row of byStatusRows) {
    if (row.status in by_status) {
      by_status[row.status] = parseInt(row.count, 10);
    }
  }

  const by_dependency_type: Record<string, number> = {
    software_library: 0,
    cloud_service: 0,
    infrastructure: 0,
    api: 0,
    other: 0
  };
  for (const row of byTypeRows) {
    if (row.dependency_type in by_dependency_type) {
      by_dependency_type[row.dependency_type] = parseInt(row.count, 10);
    }
  }

  const total = Object.values(by_status).reduce((s, n) => s + n, 0);

  return { total, by_criticality, by_status, by_dependency_type };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

const DEPENDENCY_SELECT = `
  id,
  organization_id,
  name,
  dependency_type,
  criticality,
  status,
  vendor_id,
  version,
  description,
  license,
  external_ref,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/dependencies
   Create a dependency record.
   If vendor_id is provided, verifies it belongs to this org.
   ========================================================= */

router.post(
  "/dependencies",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateDependencyCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // If vendor_id provided, verify it exists and belongs to this org.
      if (input.vendor_id !== null) {
        const vendorResult = await client.query(
          `SELECT id FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [input.vendor_id, organizationId]
        );
        if ((vendorResult.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "vendor_not_found" });
          return;
        }
      }

      const result = await client.query(
        `
        INSERT INTO dependencies (
          organization_id,
          name,
          dependency_type,
          criticality,
          status,
          vendor_id,
          version,
          description,
          license,
          external_ref
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING ${DEPENDENCY_SELECT}
        `,
        [
          organizationId,
          input.name,
          input.dependency_type,
          input.criticality,
          input.status,
          input.vendor_id ?? null,
          input.version ?? null,
          input.description ?? null,
          input.license ?? null,
          input.external_ref ?? null
        ]
      );

      const dependency = result.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "dependency_created",
          organizationId,
          dependencyId: dependency.id,
          dependencyType: input.dependency_type,
          criticality: input.criticality
        },
        "Dependency record created"
      );

      res.status(201).json({ dependency });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "dependency_create_failed", err },
        "POST /api/dependencies failed"
      );
      res.status(500).json({ error: "dependency_create_failed" });
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   GET /api/dependencies
   List all dependencies for the org.
   Supports status, dependency_type, vendor_id filters.
   Cursor paginated (before_created_at + before_id).
   ========================================================= */

router.get(
  "/dependencies",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateDependencyListQuery(req.query);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      if (input.status !== null) {
        params.push(input.status);
        conditions.push(`status = $${params.length}`);
      }

      if (input.dependency_type !== null) {
        params.push(input.dependency_type);
        conditions.push(`dependency_type = $${params.length}`);
      }

      if (input.vendor_id !== null) {
        params.push(input.vendor_id);
        conditions.push(`vendor_id = $${params.length}::uuid`);
      }

      if (input.before_created_at !== null && input.before_id !== null) {
        params.push(input.before_created_at, input.before_id);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(input.limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${DEPENDENCY_SELECT}
        FROM dependencies
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const dependencies = result.rows;
      const last = dependencies.length > 0 ? dependencies[dependencies.length - 1] : null;

      res.status(200).json({
        count: dependencies.length,
        limit: input.limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        dependencies
      });
    } catch (err) {
      logger.error(
        { event: "dependency_list_failed", err },
        "GET /api/dependencies failed"
      );
      res.status(500).json({ error: "dependency_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/dependencies/summary
   Aggregate counts for the org's dependency inventory:
   - by_criticality: count per criticality level
   - by_status: count per lifecycle status
   - by_dependency_type: count per dependency type
   ========================================================= */

router.get(
  "/dependencies/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      // Serialized reads (single tenant client under asTenant; concurrent
      // pg.query on one client is unsafe — pg@8 serializes+warns, pg@9 throws).
      const byCriticalityResult = await pg.query<{ criticality: string; count: string }>(
        `
        SELECT criticality, COUNT(*)::text AS count
        FROM dependencies
        WHERE organization_id = $1
        GROUP BY criticality
        `,
        [organizationId]
      );
      const byStatusResult = await pg.query<{ status: string; count: string }>(
        `
        SELECT status, COUNT(*)::text AS count
        FROM dependencies
        WHERE organization_id = $1
        GROUP BY status
        `,
        [organizationId]
      );
      const byTypeResult = await pg.query<{ dependency_type: string; count: string }>(
        `
        SELECT dependency_type, COUNT(*)::text AS count
        FROM dependencies
        WHERE organization_id = $1
        GROUP BY dependency_type
        ORDER BY count DESC, dependency_type ASC
        `,
        [organizationId]
      );

      const summary = buildDependencySummary(
        byCriticalityResult.rows,
        byStatusResult.rows,
        byTypeResult.rows
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "dependency_summary_failed", err },
        "GET /api/dependencies/summary failed"
      );
      res.status(500).json({ error: "dependency_summary_failed" });
    }
  })
);

/* =========================================================
   GET /api/dependencies/:id
   Get a single dependency record by id.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/dependencies/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const dependencyId = String(req.params.id ?? "").trim();
    if (!dependencyId) {
      res.status(400).json({ error: "dependency_id_required" });
      return;
    }
    if (!isUuid(dependencyId)) {
      res.status(400).json({ error: "dependency_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${DEPENDENCY_SELECT}
        FROM dependencies
        WHERE id = $1
          AND organization_id = $2
        `,
        [dependencyId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "dependency_not_found" });
        return;
      }

      res.status(200).json({ dependency: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "dependency_get_failed", err },
        "GET /api/dependencies/:id failed"
      );
      res.status(500).json({ error: "dependency_get_failed" });
    }
  })
);

/* =========================================================
   PATCH /api/dependencies/:id
   Partial update of a dependency record.
   If vendor_id is updated to a non-null value, re-verifies
   org ownership of the new vendor.
   ========================================================= */

router.patch(
  "/dependencies/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const dependencyId = String(req.params.id ?? "").trim();
    if (!dependencyId) {
      res.status(400).json({ error: "dependency_id_required" });
      return;
    }
    if (!isUuid(dependencyId)) {
      res.status(400).json({ error: "dependency_id_must_be_uuid" });
      return;
    }

    const validated = validateDependencyUpdate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the dependency exists and belongs to this org.
      const existingResult = await client.query(
        `SELECT id FROM dependencies WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [dependencyId, organizationId]
      );

      if ((existingResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "dependency_not_found" });
        return;
      }

      // If vendor_id is being set to a non-null value, re-verify org ownership.
      if (input.vendor_id !== undefined && input.vendor_id !== null) {
        const vendorResult = await client.query(
          `SELECT id FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [input.vendor_id, organizationId]
        );
        if ((vendorResult.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "vendor_not_found" });
          return;
        }
      }

      // Build dynamic SET clause.
      const setClauses: string[] = ["updated_at = NOW()"];
      const updateParams: unknown[] = [];

      function addField(column: string, value: unknown) {
        updateParams.push(value);
        setClauses.push(`${column} = $${updateParams.length}`);
      }

      if (input.name !== undefined) addField("name", input.name);
      if (input.dependency_type !== undefined) addField("dependency_type", input.dependency_type);
      if (input.criticality !== undefined) addField("criticality", input.criticality);
      if (input.status !== undefined) addField("status", input.status);
      if (input.vendor_id !== undefined) addField("vendor_id", input.vendor_id);
      if (input.version !== undefined) addField("version", input.version);
      if (input.description !== undefined) addField("description", input.description);
      if (input.license !== undefined) addField("license", input.license);
      if (input.external_ref !== undefined) addField("external_ref", input.external_ref);

      updateParams.push(dependencyId, organizationId);
      const idParam = updateParams.length - 1;
      const orgParam = updateParams.length;

      const updatedResult = await client.query(
        `
        UPDATE dependencies
        SET ${setClauses.join(", ")}
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${DEPENDENCY_SELECT}
        `,
        updateParams
      );

      const dependency = updatedResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "dependency_updated",
          organizationId,
          dependencyId: dependency.id
        },
        "Dependency record updated"
      );

      res.status(200).json({ dependency });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "dependency_update_failed", err },
        "PATCH /api/dependencies/:id failed"
      );
      res.status(500).json({ error: "dependency_update_failed" });
    } finally {
      client.release();
    }
  })
);

export default router;
