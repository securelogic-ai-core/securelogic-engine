/**
 * graphImpactAnalysis.ts — ERIP E7 (Knowledge Graph): PURE impact analysis over
 * a resolved, labelled, own-risk-seeded neighbourhood. No I/O. Deterministic.
 * Produces dependency analysis, blast-radius shape, at-risk dependencies, and a
 * bounded business-impact score — the structured evidence the NL answer is
 * grounded in (ERIP-AD-28/29).
 */

import { summarizeBlastRadius, type GraphNodeLike, type GraphEdgeLike, type BlastRadiusSummary } from "./blastRadiusSummary.js";

/** A neighbourhood node enriched with label, criticality, and own-risk. */
export interface EnrichedNode {
  node_type: string;
  node_id: string;
  label: string | null;
  depth: number;
  own_risk: number;
  criticality: string | null;
}

export interface DependencyRef {
  node_type: string;
  node_id: string;
  label: string | null;
  depth: number;
  own_risk: number;
  criticality: string | null;
}

export interface GraphImpactAnalysis {
  blast_radius: BlastRadiusSummary;
  /** Reachable dependencies (root excluded), ordered by own-risk then depth. */
  dependencies: DependencyRef[];
  /** Dependencies carrying non-zero own-risk (regulatory/exposure-relevant). */
  at_risk_dependencies: DependencyRef[];
  /** 0–100 business-impact: blends reach breadth with the worst dependency risk. */
  business_impact_score: number;
  /** Factual band for the business-impact score. */
  business_impact_band: "critical" | "high" | "moderate" | "low" | "none";
}

const CRITICALITY_WEIGHT: Record<string, number> = { critical: 1, high: 0.8, medium: 0.5, low: 0.25 };

function band(score: number): GraphImpactAnalysis["business_impact_band"] {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "moderate";
  if (score > 0) return "low";
  return "none";
}

/**
 * Analyse the neighbourhood. `nodes` includes the root at depth 0 (excluded
 * from dependencies). Business impact = the worst dependency's own-risk scaled
 * by its criticality, lifted by breadth (a wide blast radius adds pressure) —
 * bounded [0,100], deterministic.
 */
export function analyzeGraphImpact(
  nodes: readonly EnrichedNode[],
  edges: readonly GraphEdgeLike[]
): GraphImpactAnalysis {
  const graphNodes: GraphNodeLike[] = nodes.map((n) => ({ node_type: n.node_type, node_id: n.node_id, depth: n.depth }));
  const blast = summarizeBlastRadius(graphNodes, edges);

  const deps: DependencyRef[] = nodes
    .filter((n) => n.depth > 0)
    .map((n) => ({ node_type: n.node_type, node_id: n.node_id, label: n.label, depth: n.depth, own_risk: n.own_risk, criticality: n.criticality }))
    .sort((a, b) => b.own_risk - a.own_risk || a.depth - b.depth || (a.node_id < b.node_id ? -1 : 1));

  const atRisk = deps.filter((d) => d.own_risk > 0);

  // Worst weighted dependency risk.
  let worst = 0;
  for (const d of atRisk) {
    const w = d.criticality ? CRITICALITY_WEIGHT[d.criticality] ?? 0.5 : 0.5;
    worst = Math.max(worst, d.own_risk * w);
  }
  // Breadth lift: up to +15 for a wide blast radius (log-ish, bounded).
  const breadthLift = Math.min(15, Math.round(Math.log2(1 + blast.reachable_count) * 5));
  const score = Math.max(0, Math.min(100, Math.round(worst + (worst > 0 ? breadthLift : 0))));

  return {
    blast_radius: blast,
    dependencies: deps,
    at_risk_dependencies: atRisk,
    business_impact_score: score,
    business_impact_band: band(score)
  };
}
