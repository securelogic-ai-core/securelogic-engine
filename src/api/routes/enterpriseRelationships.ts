/**
 * enterpriseRelationships.ts — Enterprise Context Layer (ECL) Slice 2 route family:
 * the generic relationship edge substrate (enterprise_relationships).
 *
 * This slice ships EDGE CRUD only. The read-time graph resolver / traversal
 * (recursive CTE unioning the existing typed edges, global-signal special-case,
 * load-tested) is a SEPARATE later slice (S2b) and is NOT here.
 *
 * ROUTES (all gated by SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED — 404 before auth)
 *   GET    /api/enterprise-relationships           — list edges for the org (?node_type,&node_id)
 *   POST   /api/enterprise-relationships            — create an edge (two-endpoint same-org pre-flight)
 *   DELETE /api/enterprise-relationships/:id         — soft-delete an edge
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id from req.organizationContext only.
 *   - BOTH endpoints verified same-org before insert (cross-org edges forbidden).
 *   - Cross-org access → 404 (no enumeration). Mutations audited. asTenant-wrapped.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { enforceEnterpriseEdgeLimit } from "../lib/enterpriseEdgeLimit.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enqueueApplicabilityReassessment } from "../lib/applicabilityReassessment.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import {
  validateEnterpriseRelationshipCreate,
  isUuid,
  isNodeType,
  NODE_TYPE_TABLE,
  type NodeType
} from "../lib/enterpriseRelationshipValidation.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 100_000;
const INTEGER_RE = /^-?\d+$/;

const REL_COLS = `
  id, organization_id, from_type, from_id, to_type, to_id,
  relationship_type, note, created_by_user_id, created_at
`;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

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

/**
 * Verify a node (type + id) belongs to the org. node_type is validated against the
 * closed enum first, so NODE_TYPE_TABLE[node] is a constant identifier — never user text.
 */
async function nodeInOrg(nodeType: NodeType, nodeId: string, orgId: string): Promise<boolean> {
  const table = NODE_TYPE_TABLE[nodeType];
  const r = await pg.query(`SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2 LIMIT 1`, [nodeId, orgId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// LIST — GET /api/enterprise-relationships  (?node_type=&node_id= to filter to a node)
// ---------------------------------------------------------------------------
export async function listEnterpriseRelationships(req: Request, res: Response): Promise<void> {
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

  // Optional node filter: edges where the node is EITHER endpoint.
  const nodeType = req.query.node_type;
  const nodeId = req.query.node_id;
  let nodeFilter: { type: string; id: string } | null = null;
  if (nodeType !== undefined || nodeId !== undefined) {
    if (!isNodeType(nodeType) || !isUuid(nodeId)) {
      res.status(400).json({ error: "invalid_node_filter" });
      return;
    }
    nodeFilter = { type: nodeType, id: (nodeId as string).trim() };
  }

  const rows = await pg.query(
    `SELECT ${REL_COLS}
       FROM enterprise_relationships
      WHERE organization_id = $1
        AND deleted_at IS NULL
        AND (
          $2::text IS NULL
          OR (from_type = $2 AND from_id = $3::uuid)
          OR (to_type   = $2 AND to_id   = $3::uuid)
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $4 OFFSET $5`,
    [orgId, nodeFilter?.type ?? null, nodeFilter?.id ?? null, limit, offset]
  );

  res.status(200).json({ enterprise_relationships: rows.rows, limit, offset });
}

// ---------------------------------------------------------------------------
// CREATE — POST /api/enterprise-relationships
// ---------------------------------------------------------------------------
export async function createEnterpriseRelationship(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateEnterpriseRelationshipCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { input } = validated;

  // Two-endpoint same-org pre-flight (IDOR defense — both nodes must be in the org).
  if (!(await nodeInOrg(input.from_type, input.from_id, orgId))) {
    res.status(400).json({ error: "from_node_not_in_org" });
    return;
  }
  if (!(await nodeInOrg(input.to_type, input.to_id, orgId))) {
    res.status(400).json({ error: "to_node_not_in_org" });
    return;
  }

  // Per-org edge cap (H1). Separate counter — never touches max_monitored_entities /
  // enforceEntityLimit. Enforced at create; existing over-cap edges are grandfathered.
  const edgeLimit = await enforceEnterpriseEdgeLimit(orgId);
  if (edgeLimit.exceeded) {
    res.status(409).json({ error: "enterprise_edge_limit_reached", used: edgeLimit.used, cap: edgeLimit.cap });
    return;
  }

  let created;
  try {
    created = await pg.query(
      `INSERT INTO enterprise_relationships (
         organization_id, from_type, from_id, to_type, to_id,
         relationship_type, note, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${REL_COLS}`,
      [
        orgId,
        input.from_type,
        input.from_id,
        input.to_type,
        input.to_id,
        input.relationship_type,
        input.note,
        (req as { userId?: string }).userId ?? null
      ]
    );
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "enterprise_relationship_already_exists" });
      return;
    }
    throw err;
  }

  const edge = created.rows[0] as { id: string };
  logger.info(
    { event: "enterprise_relationship_created", organizationId: orgId, relationshipId: edge.id, relationshipType: input.relationship_type },
    "Enterprise relationship created"
  );

  // ECL R3: a new edge extends reachability from BOTH endpoints — one
  // edge_changed event per endpoint node (planReassessment matches single
  // nodes). Same asTenant tx; deduped + self-gated inside the enqueuer.
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "edge_changed", organization_id: orgId, node_type: input.from_type, node_id: input.from_id
  });
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "edge_changed", organization_id: orgId, node_type: input.to_type, node_id: input.to_id
  });
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "enterprise_relationship.created",
    resourceType: "enterprise_relationship",
    resourceId: edge.id,
    payload: {
      from_type: input.from_type,
      to_type: input.to_type,
      relationship_type: input.relationship_type
    }
  });

  res.status(201).json({ enterprise_relationship: created.rows[0] });
}

// ---------------------------------------------------------------------------
// DELETE — DELETE /api/enterprise-relationships/:id  (soft-delete)
// ---------------------------------------------------------------------------
export async function deleteEnterpriseRelationship(req: Request, res: Response): Promise<void> {
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

  const del = await pg.query(
    `UPDATE enterprise_relationships SET deleted_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING id, from_type, from_id, to_type, to_id`,
    [id, orgId]
  );
  if (del.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // ECL R3: a removed edge shrinks reachability from both endpoints.
  const removed = del.rows[0] as { from_type: string; from_id: string; to_type: string; to_id: string };
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "edge_changed", organization_id: orgId, node_type: removed.from_type, node_id: removed.from_id
  });
  await enqueueApplicabilityReassessment(pg, orgId, {
    type: "edge_changed", organization_id: orgId, node_type: removed.to_type, node_id: removed.to_id
  });

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "enterprise_relationship.deleted",
    resourceType: "enterprise_relationship",
    resourceId: id,
    payload: null
  });

  // 200 + JSON, not 204 + send(): under asTenant the buffering proxy throws on send()
  // (deferredResponse.ts), which would roll back the soft-delete and leave a false
  // "deleted" audit event. (Wave-0d pattern.)
  res.status(200).json({ deleted: true, id });
}

// ---------------------------------------------------------------------------
// Route wiring — flag FIRST, then the mandatory chain, then asTenant.
// ---------------------------------------------------------------------------
const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/enterprise-relationships", ...chain, asTenant(listEnterpriseRelationships));
router.post("/enterprise-relationships", ...chain, asTenant(createEnterpriseRelationship));
router.delete("/enterprise-relationships/:id", ...chain, asTenant(deleteEnterpriseRelationship));

export default router;
