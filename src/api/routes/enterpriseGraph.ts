/**
 * enterpriseGraph.ts — ECL Slice 2b: read-only graph traversal endpoint.
 *
 *   GET /api/enterprise-graph?node_type=&node_id=&depth=
 *     → the outbound neighbourhood of the node (bounded depth), over the unified
 *       edge view (enterprise_relationships + ai_system_vendor_dependencies).
 *
 * Flag-gated (SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED — 404 before auth). asTenant so
 * the recursive-CTE traversal runs org-scoped in one tenant transaction. The seed
 * node's same-org membership is verified before traversal (IDOR defense); the
 * traversal itself only follows this org's edges, so it is org-isolated.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import {
  isNodeType,
  isUuid,
  NODE_TYPE_TABLE,
  type NodeType
} from "../lib/enterpriseRelationshipValidation.js";
import { resolveNeighborhood, DEFAULT_DEPTH, MAX_DEPTH } from "../lib/enterpriseGraphResolver.js";

const router = Router();
const INTEGER_RE = /^-?\d+$/;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

async function nodeInOrg(nodeType: NodeType, nodeId: string, orgId: string): Promise<boolean> {
  const table = NODE_TYPE_TABLE[nodeType]; // closed map — never user text
  const r = await pg.query(`SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2 LIMIT 1`, [nodeId, orgId]);
  return (r.rowCount ?? 0) > 0;
}

export async function getEnterpriseGraph(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const nodeType = req.query.node_type;
  const nodeId = req.query.node_id;
  if (!isNodeType(nodeType) || !isUuid(nodeId)) {
    res.status(400).json({ error: "invalid_node" });
    return;
  }

  // depth: default 3, bounded to MAX_DEPTH (do not raise without the AR-4 load test).
  let depth = DEFAULT_DEPTH;
  if (req.query.depth !== undefined) {
    const raw = req.query.depth;
    if (typeof raw !== "string" || !INTEGER_RE.test(raw.trim())) {
      res.status(400).json({ error: "invalid_depth" });
      return;
    }
    const n = parseInt(raw.trim(), 10);
    if (n < 1 || n > MAX_DEPTH) {
      res.status(400).json({ error: "depth_out_of_range", detail: `depth must be between 1 and ${MAX_DEPTH}` });
      return;
    }
    depth = n;
  }

  const seedId = (nodeId as string).trim();

  // Seed-node same-org pre-flight (IDOR defense). 'user' seeds are allowed but rare;
  // still verified against the users table.
  if (!(await nodeInOrg(nodeType, seedId, orgId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const graph = await resolveNeighborhood(orgId, nodeType, seedId, depth);
  res.status(200).json({ enterprise_graph: graph });
}

const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/enterprise-graph", ...chain, asTenant(getEnterpriseGraph));

export default router;
