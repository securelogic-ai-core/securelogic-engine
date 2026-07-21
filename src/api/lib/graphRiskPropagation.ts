/**
 * graphRiskPropagation.ts — ERIP Epic 3 (E3.P1): the PURE graph-aware risk
 * engine (ERIP-AD-15/17). No I/O. Given a seed asset's own risk, its outbound
 * neighbourhood (nodes with own-risk seeds + hop depth), and a decay factor,
 * compute the seed's direct / inherited / total risk with a full contributor
 * trace. Deterministic and bounded [0, 100].
 *
 * Model:
 *   - direct_risk   = the seed's own risk (from its own canonical signals).
 *   - a dependency at hop `d` contributes own_risk × decay^d (risk decays with
 *     distance — a two-hop-away dependency matters less).
 *   - inherited_risk = noisy-OR of every dependency's decayed contribution
 *     (independent risks combine probabilistically, never exceeding 100).
 *   - total_risk    = noisy-OR of direct_risk and inherited_risk.
 *   - contributors  = every dependency that added risk, ordered by contribution,
 *     each with its own_risk, hop depth, and decayed value (explainability).
 */

export interface RiskNode {
  node_type: string;
  node_id: string;
  /** 0–100 own-risk seed (ERIP-AD-16). */
  own_risk: number;
  /** Hops from the seed (0 = the seed itself). */
  depth: number;
}

export interface RiskContributor {
  node_type: string;
  node_id: string;
  own_risk: number;
  depth: number;
  /** own_risk × decay^depth, rounded. */
  contribution: number;
}

export interface RiskPropagationResult {
  direct_risk: number;
  inherited_risk: number;
  total_risk: number;
  contributors: RiskContributor[];
}

/** Default per-hop decay: a dependency one hop away transmits 60% of its risk. */
export const DEFAULT_DEPENDENCY_DECAY = 0.6;

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Noisy-OR of independent risks in [0,100]: 100·(1 − ∏(1 − xi/100)). */
function noisyOr(values: readonly number[]): number {
  let product = 1;
  for (const v of values) product *= 1 - clamp100(v) / 100;
  return clamp100(100 * (1 - product));
}

/**
 * Compute the seed's risk from its neighbourhood. `nodes` MUST include the seed
 * at depth 0; dependencies are the depth ≥ 1 nodes (the resolver already
 * dedups by shortest path, so each dependency appears once).
 */
export function propagateRisk(
  seed: { node_type: string; node_id: string },
  nodes: readonly RiskNode[],
  decay: number = DEFAULT_DEPENDENCY_DECAY
): RiskPropagationResult {
  const d = Math.max(0, Math.min(1, decay));
  const seedNode = nodes.find((n) => n.node_type === seed.node_type && n.node_id === seed.node_id);
  const direct = clamp100(Math.round(seedNode?.own_risk ?? 0));

  const contributors: RiskContributor[] = [];
  for (const n of nodes) {
    if (n.depth <= 0) continue; // the seed itself is direct, not a contributor
    const own = clamp100(n.own_risk);
    if (own <= 0) continue;
    const contribution = Math.round(own * d ** n.depth);
    if (contribution <= 0) continue;
    contributors.push({ node_type: n.node_type, node_id: n.node_id, own_risk: Math.round(own), depth: n.depth, contribution });
  }
  contributors.sort((a, b) =>
    b.contribution - a.contribution ||
    a.depth - b.depth ||
    (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0)
  );

  const inherited = Math.round(noisyOr(contributors.map((c) => c.contribution)));
  const total = Math.round(noisyOr([direct, inherited]));

  return { direct_risk: direct, inherited_risk: inherited, total_risk: total, contributors };
}
