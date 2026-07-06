/**
 * knowledgeGraph.ts — ERIP Epic 7 (Knowledge Graph / Digital Twin): the
 * blast-radius / dependency analysis surface. A read-time projection over the
 * ONE existing graph substrate (ERIP-AD-28) — resolve an asset's outbound
 * neighbourhood, label every node from its canonical home (ERIP-AD-29), and
 * summarize the blast radius. Read-only; no new store.
 *
 * Route chain: the Knowledge-Graph flag FIRST (404 while dark), then the
 * asset-registry flag (it maps an asset via the registry), auth, org context,
 * the per-org `enterprise_context` capability, and asTenant.
 *
 * Natural-language question answering is DEFERRED behind its own safety gate
 * (ERIP-AD-30) — this surface is structured, injection-free query only.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { knowledgeGraphFeatureFlag } from "../lib/knowledgeGraphFeatureFlag.js";
import { resolveNeighborhood, DEFAULT_DEPTH, MAX_DEPTH } from "../lib/enterpriseGraphResolver.js";
import { labelNodes } from "../lib/graphLabeling.js";
import { summarizeBlastRadius } from "../lib/blastRadiusSummary.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER_RE = /^-?\d+$/;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

/** Map an asset's backing table to its graph node identity (EAR-AD-4). */
function graphNodeForBacking(backingKind: string, backingId: string, assetId: string): { node_type: string; node_id: string } {
  switch (backingKind) {
    case "vendors":
      return { node_type: "vendor", node_id: backingId };
    case "ai_systems":
      return { node_type: "ai_system", node_id: backingId };
    case "enterprise_entities":
      return { node_type: "enterprise_entity", node_id: backingId };
    default:
      return { node_type: "asset", node_id: assetId };
  }
}

export async function getBlastRadius(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.assetId;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  let depth = DEFAULT_DEPTH;
  const raw = req.query.depth;
  if (raw !== undefined) {
    if (typeof raw !== "string" || !INTEGER_RE.test(raw)) {
      res.status(400).json({ error: "invalid_depth" });
      return;
    }
    depth = Number(raw);
    if (depth < 0 || depth > MAX_DEPTH) {
      res.status(400).json({ error: "invalid_depth" });
      return;
    }
  }

  const header = await pg.query(
    `SELECT backing_kind, backing_id FROM asset_registry_v
      WHERE organization_id = $1 AND asset_id = $2 LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { backing_kind, backing_id } = header.rows[0] as { backing_kind: string; backing_id: string };
  const root = graphNodeForBacking(backing_kind, backing_id, id);

  const neighbourhood = await resolveNeighborhood(orgId, root.node_type, root.node_id, depth);
  const labels = await labelNodes(orgId, neighbourhood.nodes.map((n) => ({ node_type: n.node_type, node_id: n.node_id })));

  res.status(200).json({
    asset_id: id,
    root,
    depth: neighbourhood.depth,
    nodes: neighbourhood.nodes.map((n) => ({
      node_type: n.node_type,
      node_id: n.node_id,
      label: labels.get(`${n.node_type}:${n.node_id}`) ?? null,
      depth: n.depth
    })),
    edges: neighbourhood.edges,
    summary: summarizeBlastRadius(neighbourhood.nodes, neighbourhood.edges)
  });
}

const chain = [
  knowledgeGraphFeatureFlag,
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/graph/blast-radius/:assetId", ...chain, asTenant(getBlastRadius));

export default router;
