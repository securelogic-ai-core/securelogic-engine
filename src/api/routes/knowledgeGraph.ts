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
import { ownRiskForNodes } from "../lib/assetOwnRisk.js";
import { analyzeGraphImpact, type EnrichedNode } from "../lib/graphImpactAnalysis.js";
import { answerGraphQuestion } from "../lib/graphNlAnswer.js";

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

/** Batched criticality per node from the federated view (asset_id OR backing_id). */
async function criticalityForNodes(orgId: string, nodeIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (nodeIds.length === 0) return out;
  const ids = [...new Set(nodeIds)];
  const r = await pg.query<{ asset_id: string; backing_id: string; criticality: string | null }>(
    `SELECT asset_id, backing_id, criticality FROM asset_registry_v
      WHERE organization_id = $1 AND (asset_id = ANY($2::uuid[]) OR backing_id = ANY($2::uuid[]))`,
    [orgId, ids]
  );
  for (const row of r.rows) {
    out.set(row.asset_id, row.criticality);
    out.set(row.backing_id, row.criticality);
  }
  return out;
}

/**
 * ERIP E7: natural-language question answering + impact analysis over an
 * asset's dependency graph. Retrieval is deterministic + org-scoped (resolver +
 * labeling + own-risk); the LLM only reasons over the pre-fetched evidence
 * (injection-safe, ERIP-AD-30). Degrades to a deterministic answer with no LLM.
 */
export async function askGraph(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const body = req.body as { asset_id?: unknown; question?: unknown; depth?: unknown } | null;
  const id = body && typeof body.asset_id === "string" ? body.asset_id : "";
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const question = body && typeof body.question === "string" ? body.question : "";
  if (question.trim().length === 0 || question.length > 500) {
    res.status(400).json({ error: "invalid_question" });
    return;
  }
  let depth = DEFAULT_DEPTH;
  if (body && typeof body.depth === "number" && Number.isInteger(body.depth) && body.depth >= 0 && body.depth <= MAX_DEPTH) {
    depth = body.depth;
  }

  const header = await pg.query(
    `SELECT name, backing_kind, backing_id FROM asset_registry_v WHERE organization_id = $1 AND asset_id = $2 LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { name: rootLabel, backing_kind, backing_id } = header.rows[0] as { name: string | null; backing_kind: string; backing_id: string };
  const root = graphNodeForBacking(backing_kind, backing_id, id);

  const neighbourhood = await resolveNeighborhood(orgId, root.node_type, root.node_id, depth);
  const keys = neighbourhood.nodes.map((n) => ({ node_type: n.node_type, node_id: n.node_id }));
  const [labels, ownRisk, criticality] = await Promise.all([
    labelNodes(orgId, keys),
    ownRiskForNodes(orgId, keys),
    criticalityForNodes(orgId, neighbourhood.nodes.map((n) => n.node_id))
  ]);

  const enriched: EnrichedNode[] = neighbourhood.nodes.map((n) => ({
    node_type: n.node_type,
    node_id: n.node_id,
    label: labels.get(`${n.node_type}:${n.node_id}`) ?? null,
    depth: n.depth,
    own_risk: ownRisk.get(`${n.node_type}:${n.node_id}`) ?? 0,
    criticality: criticality.get(n.node_id) ?? null
  }));

  const analysis = analyzeGraphImpact(enriched, neighbourhood.edges);
  const answer = await answerGraphQuestion(rootLabel, question, analysis);

  res.status(200).json({
    asset_id: id,
    question,
    answer,
    analysis: {
      business_impact_score: analysis.business_impact_score,
      business_impact_band: analysis.business_impact_band,
      blast_radius: analysis.blast_radius,
      at_risk_dependencies: analysis.at_risk_dependencies.map((d) => ({ label: d.label, node_type: d.node_type, depth: d.depth, own_risk: d.own_risk, criticality: d.criticality }))
    }
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
router.post("/graph/ask", ...chain, asTenant(askGraph));

export default router;
