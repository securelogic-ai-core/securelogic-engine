/**
 * enterpriseEntities.ts — Enterprise Context Layer (ECL) Slice 1 route family.
 *
 * Tenant-scoped CRUD for enterprise_entities (the canonical header for NEW
 * customer-context objects) and its typed child enterprise_data_stores. This is
 * the durable-object substrate; the relationship graph, applicability engine,
 * CSV import, connectors, and UI are LATER slices and are NOT here.
 *
 * ROUTES (all gated by the SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED flag — 404
 * before auth when off)
 *   GET    /api/enterprise-entities            — list for the org (paginated, ?entity_type)
 *   POST   /api/enterprise-entities            — create (metered) + optional data_store child
 *   GET    /api/enterprise-entities/:id         — fetch one (+ data_store child)
 *   PATCH  /api/enterprise-entities/:id         — partial update (+ upsert child)
 *   DELETE /api/enterprise-entities/:id         — delete (cascades child)
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never the body/param.
 *   - Every read/write is scoped by organization_id. Cross-org access → 404 (no enumeration).
 *   - owner_user_id (if set) is verified same-org with a pre-flight SELECT before persist.
 *   - Every mutation is audit-logged via writeAuditEvent (pgElevated, asTenant-safe).
 *   - Handlers run under asTenant() so all queries execute inside ONE tenant transaction
 *     with app.current_org_id set (RLS-correct post-flip; inert until then).
 *
 * Handlers are NAMED EXPORTS so unit tests can invoke them directly with mocked pg.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { enforceEnterpriseEntityLimit } from "../lib/enterpriseEntityLimit.js";
import { enqueueApplicabilityReassessment } from "../lib/applicabilityReassessment.js";
import {
  validateEnterpriseEntityCreate,
  validateEnterpriseEntityUpdate,
  isUuid,
  type DataStoreInput
} from "../lib/enterpriseEntityValidation.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { registerAsset, deregisterAsset } from "../lib/assetRegistrar.js";
import { entityTypeToAssetType } from "../lib/assetRegistry.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 100_000;
const INTEGER_RE = /^-?\d+$/;

const ENTITY_COLS = `
  id, organization_id, entity_type, name, description, owner_user_id,
  status, criticality, confidence, source_type, source_id, provenance,
  external_ref, created_at, updated_at
`;

const DATA_STORE_COLS = `
  data_classification, residency_region, retention_policy, encryption_at_rest
`;

/** org id from context only; null → caller must 403. */
function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

/** Parse a bounded non-negative integer query param; null on non-integer. */
function parseBoundedInt(raw: unknown, def: number, max: number): number | null {
  if (raw === undefined) return def;
  if (typeof raw !== "string" || !INTEGER_RE.test(raw.trim())) return null;
  const n = parseInt(raw.trim(), 10);
  if (n < 0) return null;
  return Math.min(n, max);
}

function auditActor(req: Request): { actorApiKeyId: string | null; actorUserId: string | null; ipAddress: string | null } {
  return {
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    ipAddress: req.ip ?? null
  };
}

// ---------------------------------------------------------------------------
// LIST — GET /api/enterprise-entities
// ---------------------------------------------------------------------------
export async function listEnterpriseEntities(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseBoundedInt(req.query.offset, DEFAULT_OFFSET, MAX_OFFSET);
  if (limit === null || offset === null) {
    res.status(400).json({ error: "invalid_pagination" });
    return;
  }

  // Optional entity_type filter — validated against the closed enum by reuse
  // of the create validator's guard would be overkill; inline check.
  const entityType = req.query.entity_type;
  const typeFilter = typeof entityType === "string" && entityType.length > 0 ? entityType : null;

  const rows = await pg.query(
    `SELECT ${ENTITY_COLS}
       FROM enterprise_entities
      WHERE organization_id = $1
        AND ($2::text IS NULL OR entity_type = $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [orgId, typeFilter, limit, offset]
  );

  res.status(200).json({ enterprise_entities: rows.rows, limit, offset });
}

// ---------------------------------------------------------------------------
// GET ONE — GET /api/enterprise-entities/:id
// ---------------------------------------------------------------------------
export async function getEnterpriseEntity(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (!isUuid(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const result = await pg.query(
    `SELECT ${ENTITY_COLS},
            ds.data_classification, ds.residency_region,
            ds.retention_policy, ds.encryption_at_rest
       FROM enterprise_entities e
       LEFT JOIN enterprise_data_stores ds
         ON ds.enterprise_entity_id = e.id AND ds.organization_id = e.organization_id
      WHERE e.id = $1 AND e.organization_id = $2
      LIMIT 1`,
    [id, orgId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(200).json({ enterprise_entity: result.rows[0] });
}

// ---------------------------------------------------------------------------
// CREATE — POST /api/enterprise-entities
// ---------------------------------------------------------------------------
export async function createEnterpriseEntity(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateEnterpriseEntityCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { input } = validated;

  // Per-org capacity cap (SEPARATE from max_monitored_entities). Checked at
  // creation; existing over-cap rows grandfathered.
  const limit = await enforceEnterpriseEntityLimit(orgId);
  if (limit.exceeded) {
    res.status(409).json({
      error: "enterprise_entity_limit_reached",
      detail: `Your plan allows up to ${limit.cap} enterprise context entities. Delete one or raise the limit.`
    });
    return;
  }

  // owner_user_id same-org pre-flight (IDOR defense — never trust the body).
  if (input.owner_user_id) {
    const owner = await pg.query(
      `SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.owner_user_id, orgId]
    );
    if (owner.rowCount === 0) {
      res.status(400).json({ error: "owner_user_id_not_in_org" });
      return;
    }
  }

  let created;
  try {
    created = await pg.query(
      `INSERT INTO enterprise_entities (
         organization_id, entity_type, name, description, owner_user_id,
         status, criticality, confidence, provenance
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
       RETURNING ${ENTITY_COLS}`,
      [
        orgId,
        input.entity_type,
        input.name,
        input.description,
        input.owner_user_id,
        input.status,
        input.criticality,
        input.confidence
      ]
    );
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "enterprise_entity_name_already_exists", name: input.name });
      return;
    }
    throw err;
  }

  const entity = created.rows[0] as { id: string };

  // EAR Phase 1: registry upsert, same asTenant tx (flag-gated, dark by default).
  if (assetRegistryEnabled()) {
    await registerAsset(orgId, entityTypeToAssetType(input.entity_type), "enterprise_entities", entity.id);
  }

  // Typed child (data_store only). Runs in the same asTenant transaction.
  let dataStore: DataStoreInput | null = null;
  if (input.entity_type === "data_store" && input.data_store) {
    const ds = input.data_store;
    const dsRow = await pg.query(
      `INSERT INTO enterprise_data_stores (
         enterprise_entity_id, organization_id,
         data_classification, residency_region, retention_policy, encryption_at_rest
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${DATA_STORE_COLS}`,
      [entity.id, orgId, ds.data_classification, ds.residency_region, ds.retention_policy, ds.encryption_at_rest]
    );
    dataStore = dsRow.rows[0] as DataStoreInput;
  }

  logger.info(
    { event: "enterprise_entity_created", organizationId: orgId, enterpriseEntityId: entity.id, entityType: input.entity_type },
    "Enterprise entity created"
  );
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "enterprise_entity.created",
    resourceType: "enterprise_entity",
    resourceId: entity.id,
    payload: { entity_type: input.entity_type, name: input.name, criticality: input.criticality }
  });

  res.status(201).json({ enterprise_entity: { ...created.rows[0], ...(dataStore ?? {}) } });
}

// ---------------------------------------------------------------------------
// UPDATE — PATCH /api/enterprise-entities/:id
// ---------------------------------------------------------------------------
export async function updateEnterpriseEntity(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (!isUuid(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const validated = validateEnterpriseEntityUpdate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { input } = validated;

  // Load + org-scope the target (404 cross-org, no enumeration).
  const existing = await pg.query<{ id: string; entity_type: string }>(
    `SELECT id, entity_type FROM enterprise_entities WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId]
  );
  if (existing.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const entityType = existing.rows[0]!.entity_type;

  if (input.data_store !== undefined && entityType !== "data_store") {
    res.status(400).json({ error: "data_store_only_for_data_store_type" });
    return;
  }

  // owner_user_id same-org pre-flight when being set to a non-null value.
  if (input.owner_user_id) {
    const owner = await pg.query(
      `SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.owner_user_id, orgId]
    );
    if (owner.rowCount === 0) {
      res.status(400).json({ error: "owner_user_id_not_in_org" });
      return;
    }
  }

  // Build a dynamic SET list from only the supplied header fields.
  const sets: string[] = [];
  const vals: unknown[] = [];
  let p = 1;
  const headerFields: Array<[keyof typeof input, string]> = [
    ["name", "name"],
    ["description", "description"],
    ["owner_user_id", "owner_user_id"],
    ["status", "status"],
    ["criticality", "criticality"],
    ["confidence", "confidence"],
    ["external_ref", "external_ref"]
  ];
  for (const [key, col] of headerFields) {
    if (key in input) {
      sets.push(`${col} = $${p++}`);
      vals.push((input as Record<string, unknown>)[key as string]);
    }
  }

  let updatedHeader = existing.rows[0];
  if (sets.length > 0) {
    sets.push(`updated_at = NOW()`);
    vals.push(id, orgId);
    const upd = await pg.query(
      `UPDATE enterprise_entities SET ${sets.join(", ")}
        WHERE id = $${p++} AND organization_id = $${p}
        RETURNING ${ENTITY_COLS}`,
      vals
    );
    updatedHeader = upd.rows[0];
  } else {
    const cur = await pg.query(
      `SELECT ${ENTITY_COLS} FROM enterprise_entities WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, orgId]
    );
    updatedHeader = cur.rows[0];
  }

  // Upsert the typed child when supplied.
  let dataStore: DataStoreInput | null = null;
  if (input.data_store !== undefined) {
    const ds = input.data_store;
    const dsRow = await pg.query(
      `INSERT INTO enterprise_data_stores (
         enterprise_entity_id, organization_id,
         data_classification, residency_region, retention_policy, encryption_at_rest
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (enterprise_entity_id) DO UPDATE SET
         data_classification = EXCLUDED.data_classification,
         residency_region    = EXCLUDED.residency_region,
         retention_policy    = EXCLUDED.retention_policy,
         encryption_at_rest  = EXCLUDED.encryption_at_rest,
         updated_at          = NOW()
       RETURNING ${DATA_STORE_COLS}`,
      [id, orgId, ds.data_classification, ds.residency_region, ds.retention_policy, ds.encryption_at_rest]
    );
    dataStore = dsRow.rows[0] as DataStoreInput;
  }

  // ECL R3: a changed entity may invalidate applicability decisions whose target
  // or blast radius touches it. Same asTenant tx — enqueued iff the PATCH commits.
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "entity_changed",
    organization_id: orgId,
    node_type: "enterprise_entity",
    node_id: id
  });

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "enterprise_entity.updated",
    resourceType: "enterprise_entity",
    resourceId: id,
    payload: { fields: Object.keys(input) }
  });

  res.status(200).json({ enterprise_entity: { ...updatedHeader, ...(dataStore ?? {}) } });
}

// ---------------------------------------------------------------------------
// DELETE — DELETE /api/enterprise-entities/:id
// ---------------------------------------------------------------------------
export async function deleteEnterpriseEntity(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (!isUuid(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  // Child rows cascade via FK ON DELETE CASCADE.
  const del = await pg.query(
    `DELETE FROM enterprise_entities WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [id, orgId]
  );
  if (del.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // EAR Phase 1: registry row removal, same asTenant tx (flag-gated).
  if (assetRegistryEnabled()) {
    await deregisterAsset(orgId, "enterprise_entities", id);
  }

  // ECL R3: a deleted entity shrinks blast radii that referenced it. Same
  // asTenant tx — enqueued iff the DELETE commits.
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "entity_changed",
    organization_id: orgId,
    node_type: "enterprise_entity",
    node_id: id
  });

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "enterprise_entity.deleted",
    resourceType: "enterprise_entity",
    resourceId: id,
    payload: null
  });

  // 200 + JSON, not 204 + send(): under asTenant the buffering proxy allows only
  // status()+json() and THROWS on send()/streaming (deferredResponse.ts), which would
  // roll back the delete and leave a false "deleted" audit event. (Wave-0d pattern.)
  res.status(200).json({ deleted: true, id });
}

// ---------------------------------------------------------------------------
// Route wiring — flag FIRST (404 before auth), then the mandatory chain, then asTenant.
// ---------------------------------------------------------------------------
const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/enterprise-entities", ...chain, asTenant(listEnterpriseEntities));
router.post("/enterprise-entities", ...chain, asTenant(createEnterpriseEntity));
router.get("/enterprise-entities/:id", ...chain, asTenant(getEnterpriseEntity));
router.patch("/enterprise-entities/:id", ...chain, asTenant(updateEnterpriseEntity));
router.delete("/enterprise-entities/:id", ...chain, asTenant(deleteEnterpriseEntity));

export default router;
