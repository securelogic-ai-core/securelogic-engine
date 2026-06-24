/**
 * aiSystemVendorDependencies.ts — Tenant-scoped record that an AI system
 * depends on a vendor in a specific role (model_provider, runtime, registry,
 * training_data, feature_store, mlops_platform, data_source, observability,
 * other).
 *
 * Establishes the AI-system → vendor edge. A subsequent matcher-cascade
 * package will traverse this edge to propagate vendor signals to dependent
 * AI systems. This package is schema + read-side endpoints only — no
 * runtime ingest behavior changes here.
 *
 * Mirrors the hardened link-route template (signalVendorLinks /
 * signalAiSystemLinks / signalControlLinks / signalObligationLinks) with
 * one variation: dependency_role is part of the partial unique key, so the
 * same vendor can serve an AI system in multiple roles (e.g., AWS as both
 * runtime and data_source) without colliding.
 *
 * ROUTES
 *   POST   /api/ai-system-vendor-dependencies         — create (idempotent)
 *   DELETE /api/ai-system-vendor-dependencies/:id     — soft-delete
 *   GET    /api/ai-systems/:id/vendors                — list vendor deps for an AI system
 *   GET    /api/vendors/:id/ai-systems                — list AI systems dependent on a vendor
 *
 * POST IDEMPOTENCY CONTRACT (locked, see package decision 2)
 *   POST is "create or read existing", not "create or update". If a live
 *   row already exists for the same (org, ai_system, vendor, dependency_role),
 *   the existing row is returned unchanged. A `notes` value supplied on a
 *   second POST is ignored — this matches the link-route template's contract
 *   for `note`. A future PATCH endpoint is the right place for editing
 *   notes; not in scope for this package.
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from
 *     the request body or any user-supplied parameter.
 *   - ai_system and vendor must both belong to the requesting org.
 *     Cross-org returns 404, not 403, to avoid enumeration.
 *   - No global asymmetry: both sides are first-class same-org entities.
 *   - Audit-log every create and delete via writeAuditEvent.
 *
 * HANDLERS ARE NAMED EXPORTS so the targeted behavioral tests in
 * aiSystemVendorDependencies.test.ts can invoke them directly with mocked pg.
 *
 * NOT IN SCOPE FOR THIS PACKAGE
 *   - Matcher cascade (next package; changes runtime ingest behavior).
 *   - PATCH endpoint to edit notes or role on an existing dependency.
 *   - Backfilling dependencies for the staging seed's vendor-supplied AI
 *     systems (separate small follow-up commit).
 *   - Dependency-aware risk scoring (Package 3).
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateAiSystemVendorDependencyCreate,
  isUuid
} from "../lib/aiSystemVendorDependencyValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const INTEGER_RE = /^-?\d+$/;

const DEP_SELECT = `
  id,
  organization_id,
  ai_system_id,
  vendor_id,
  dependency_role,
  notes,
  created_at,
  created_by_user_id,
  deleted_at
`;

/**
 * Parse a `?limit=` query string. Returns:
 *   - DEFAULT_LIMIT when absent or empty.
 *   - DEFAULT_LIMIT when a valid integer ≤ 0 (preserve prior tolerance for "0" / "-1").
 *   - clamped value (≤ MAX_LIMIT) when a valid positive integer.
 *   - null when the input is non-integer (fractional or non-numeric); the route
 *     handler converts null to a 400 invalid_limit response. Postgres rejects
 *     fractional LIMIT with a runtime error, so we must reject before the SQL.
 */
function parseLimit(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const raw = String(value).trim();
  if (raw === "") return DEFAULT_LIMIT;
  if (!INTEGER_RE.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/* =========================================================
   POST /api/ai-system-vendor-dependencies
   Create a tenant-scoped dependency between an AI system and a vendor.

   Idempotent on (organization_id, ai_system_id, vendor_id, dependency_role)
   where deleted_at IS NULL — second call returns the existing live row
   unchanged. Atomic via ON CONFLICT against the partial unique index —
   no SELECT-then-INSERT race.
   ========================================================= */

export async function createAiSystemVendorDependency(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateAiSystemVendorDependencyCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const { ai_system_id, vendor_id, dependency_role, notes } = validated.input;

  try {
    // Pre-flight: ai_system must belong to this org. 404 not 403.
    const aiCheck = await pg.query(
      `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [ai_system_id, organizationId]
    );
    if ((aiCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }

    // Pre-flight: vendor must belong to this org. 404 not 403.
    const vendorCheck = await pg.query(
      `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [vendor_id, organizationId]
    );
    if ((vendorCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "vendor_not_found" });
      return;
    }

    // Atomic upsert. ON CONFLICT against the partial unique index
    // idx_ai_system_vendor_dependencies_unique_active eliminates the
    // SELECT-then-INSERT race. If a live dependency already exists,
    // rowCount=0 and we read it back unchanged.
    const insertResult = await pg.query(
      `INSERT INTO ai_system_vendor_dependencies (
         organization_id, ai_system_id, vendor_id, dependency_role, notes, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, ai_system_id, vendor_id, dependency_role)
         WHERE deleted_at IS NULL
         DO NOTHING
       RETURNING ${DEP_SELECT}`,
      [organizationId, ai_system_id, vendor_id, dependency_role, notes, req.userId ?? null]
    );

    if ((insertResult.rowCount ?? 0) === 0) {
      // Conflict on partial unique index — a live dependency already exists.
      // Per the locked POST idempotency contract, the existing row is
      // returned unchanged — notes from this request are NOT applied.
      const existing = await pg.query(
        `SELECT ${DEP_SELECT}
           FROM ai_system_vendor_dependencies
          WHERE organization_id = $1
            AND ai_system_id = $2
            AND vendor_id = $3
            AND dependency_role = $4
            AND deleted_at IS NULL
          LIMIT 1`,
        [organizationId, ai_system_id, vendor_id, dependency_role]
      );
      res.status(200).json({ dependency: existing.rows[0], created: false });
      return;
    }

    const dependency = insertResult.rows[0];

    logger.info(
      {
        event: "ai_system_vendor_dependency_created",
        organizationId,
        dependencyId: dependency.id,
        aiSystemId: ai_system_id,
        vendorId: vendor_id,
        dependencyRole: dependency_role
      },
      "AI-system-vendor dependency created"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "ai_system_vendor_dependency.created",
      resourceType: "ai_system_vendor_dependency",
      resourceId: dependency.id as string,
      payload: {
        ai_system_id,
        vendor_id,
        dependency_role
      },
      ipAddress: req.ip ?? null
    });

    res.status(201).json({ dependency, created: true });
  } catch (err) {
    logger.error(
      { event: "ai_system_vendor_dependency_create_failed", err },
      "POST /api/ai-system-vendor-dependencies failed"
    );
    res.status(500).json({ error: "ai_system_vendor_dependency_create_failed" });
  }
}

/* =========================================================
   DELETE /api/ai-system-vendor-dependencies/:id
   Soft-delete a dependency belonging to the requesting organization.
   ========================================================= */

export async function deleteAiSystemVendorDependency(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const dependencyId = String(req.params.id ?? "").trim();
  if (!isUuid(dependencyId)) {
    res.status(400).json({ error: "dependency_id_must_be_uuid" });
    return;
  }

  try {
    const result = await pg.query(
      `UPDATE ai_system_vendor_dependencies
          SET deleted_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND deleted_at IS NULL
        RETURNING ${DEP_SELECT}`,
      [dependencyId, organizationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      // Cross-org, non-existent, or already-deleted — uniformly 404 to avoid
      // enumeration.
      res.status(404).json({ error: "ai_system_vendor_dependency_not_found" });
      return;
    }

    const dependency = result.rows[0];

    logger.info(
      {
        event: "ai_system_vendor_dependency_deleted",
        organizationId,
        dependencyId: dependency.id,
        aiSystemId: dependency.ai_system_id,
        vendorId: dependency.vendor_id,
        dependencyRole: dependency.dependency_role
      },
      "AI-system-vendor dependency deleted"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "ai_system_vendor_dependency.deleted",
      resourceType: "ai_system_vendor_dependency",
      resourceId: dependency.id as string,
      payload: {
        ai_system_id: dependency.ai_system_id,
        vendor_id: dependency.vendor_id,
        dependency_role: dependency.dependency_role
      },
      ipAddress: req.ip ?? null
    });

    res.status(200).json({ dependency });
  } catch (err) {
    logger.error(
      { event: "ai_system_vendor_dependency_delete_failed", err },
      "DELETE /api/ai-system-vendor-dependencies/:id failed"
    );
    res.status(500).json({ error: "ai_system_vendor_dependency_delete_failed" });
  }
}

/* =========================================================
   GET /api/ai-systems/:id/vendors
   List active vendor dependencies for an AI system, joined with the
   vendor's name so callers do not need a follow-up vendor read.
   ========================================================= */

export async function listVendorsForAiSystem(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const aiSystemId = String(req.params.id ?? "").trim();
  if (!isUuid(aiSystemId)) {
    res.status(400).json({ error: "ai_system_id_must_be_uuid" });
    return;
  }

  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({
      error: "invalid_limit",
      detail: "limit must be a positive integer"
    });
    return;
  }

  try {
    const aiCheck = await pg.query(
      `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [aiSystemId, organizationId]
    );
    if ((aiCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }

    const result = await pg.query(
      `SELECT
         d.id              AS dependency_id,
         d.dependency_role AS dependency_role,
         d.notes           AS notes,
         d.created_at      AS created_at,
         d.created_by_user_id AS created_by_user_id,
         v.id              AS vendor_id,
         v.name            AS vendor_name,
         v.criticality     AS vendor_criticality,
         v.status          AS vendor_status
         FROM ai_system_vendor_dependencies d
         JOIN vendors v ON v.id = d.vendor_id
        WHERE d.organization_id = $1
          AND d.ai_system_id = $2
          AND d.deleted_at IS NULL
          AND v.organization_id = $1
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $3`,
      [organizationId, aiSystemId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      aiSystemId,
      dependencies: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "ai_system_vendor_dependencies_list_failed", err },
      "GET /api/ai-systems/:id/vendors failed"
    );
    res.status(500).json({ error: "ai_system_vendor_dependencies_list_failed" });
  }
}

/* =========================================================
   GET /api/vendors/:id/ai-systems
   List active AI systems that depend on this vendor, with AI system
   name and role joined. This is the cascade-side query the matcher
   will eventually use to propagate vendor signals to dependent AI
   systems.
   ========================================================= */

export async function listAiSystemsForVendor(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const vendorId = String(req.params.id ?? "").trim();
  if (!isUuid(vendorId)) {
    res.status(400).json({ error: "vendor_id_must_be_uuid" });
    return;
  }

  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({
      error: "invalid_limit",
      detail: "limit must be a positive integer"
    });
    return;
  }

  try {
    const vendorCheck = await pg.query(
      `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [vendorId, organizationId]
    );
    if ((vendorCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "vendor_not_found" });
      return;
    }

    const result = await pg.query(
      `SELECT
         d.id              AS dependency_id,
         d.dependency_role AS dependency_role,
         d.notes           AS notes,
         d.created_at      AS created_at,
         d.created_by_user_id AS created_by_user_id,
         a.id              AS ai_system_id,
         a.name            AS ai_system_name,
         a.criticality     AS ai_system_criticality,
         a.deployment_status AS ai_system_deployment_status
         FROM ai_system_vendor_dependencies d
         JOIN ai_systems a ON a.id = d.ai_system_id
        WHERE d.organization_id = $1
          AND d.vendor_id = $2
          AND d.deleted_at IS NULL
          AND a.organization_id = $1
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $3`,
      [organizationId, vendorId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      vendorId,
      dependencies: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "vendor_dependent_ai_systems_list_failed", err },
      "GET /api/vendors/:id/ai-systems failed"
    );
    res.status(500).json({ error: "vendor_dependent_ai_systems_list_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for
   direct invocation in targeted behavioral tests.

   All four handlers are asTenant()-wrapped (A04-G1 phase-3) — same posture
   as the signal-link tables: single status().json() terminals (DELETE 200
   json), sequential awaits, writeAuditEvent on its own pgElevated pool, and
   the table is written only by these routes → full coverage for the RLS
   policy in 20260702_ai_system_vendor_dependencies_rls at the DATABASE_URL flip.
   ========================================================= */

router.post(
  "/ai-system-vendor-dependencies",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(createAiSystemVendorDependency)
);

router.delete(
  "/ai-system-vendor-dependencies/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(deleteAiSystemVendorDependency)
);

router.get(
  "/ai-systems/:id/vendors",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(listVendorsForAiSystem)
);

router.get(
  "/vendors/:id/ai-systems",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(listAiSystemsForVendor)
);

export default router;
