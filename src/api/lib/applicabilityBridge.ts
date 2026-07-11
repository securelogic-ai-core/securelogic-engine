/**
 * applicabilityBridge.ts — C4 part 4: the seam where evidence becomes a decision.
 *
 * ERG R2 says `affected` requires a high-confidence, explainable match to a tenant asset.
 * Parts 1–3 built the evidence and scored it. This is where that score is handed to the
 * ONE applicability engine (EAR-AD-3) and becomes an applicability decision.
 *
 * WHY A BRIDGE AND NOT A NEW ENGINE
 *   Everything here is composition. `resolveTenantAssets` finds the assets, the resolver's
 *   `confidence` becomes the engine's `match_score`, `resolveNeighborhood` supplies the
 *   blast radius, and `ApplicabilityEngineV1.assess` decides. No new decision logic, no
 *   second matcher, no re-derived thresholds — the engine already tiers on
 *   applicabilityPolicy.matchThresholds and already owns the decision matrix.
 *
 * THE ONE NUMBER THAT MATTERS
 *   confidence -> match_score. That is the whole evidence gate:
 *
 *     attestation 100 | sbom 95 | connector 85   >= matchThresholds.high (70)  -> `affected`
 *     inferred     60                            <  70                          -> `potentially_affected`
 *
 *   So an asset the customer ATTESTED runs Exchange can be `affected`; an asset that merely
 *   happens to be NAMED "Exchange" cannot. Without this mapping the engine would have to
 *   trust a name coincidence exactly as much as an SBOM.
 *
 * WHAT IT STILL WILL NOT DO
 *   `ambiguous` and `needs_review` survive. Two assets matching one product does not become
 *   an auto-pick; a vendor-only (non-product-identifiable) signal never resolves at all (R2).
 *   The engine turns those into `needs_review`, which is a human's job, not a default.
 */

import type { PoolClient } from "pg";
import { ApplicabilityEngineV1 } from "../../engine/applicability/v1/ApplicabilityEngineV1.js";
import type {
  ApplicabilityInput,
  ApplicabilityResult,
  MatcherCandidate,
} from "../../engine/applicability/v1/types.js";
import { resolveTenantAssets, type AssetResolution } from "./tenantAssetResolver.js";
import type { CanonicalProductIdentity } from "./canonicalProduct.js";

/**
 * PURE: resolver output -> engine candidates.
 *
 * The resolver's `confidence` becomes `match_score` verbatim. Nothing is rescaled or
 * re-weighted here — rescaling would be a second, invisible policy, and the whole point of
 * applicabilityPolicy.ts is that there is exactly one.
 *
 * `graph_node` roots the blast-radius BFS at the asset's BACKING node, which is how an
 * 'asset' target reaches the graph (EAR Phase 2). Without it a strong match has no
 * reachability and the engine correctly caps at `potentially_affected` — so omitting it
 * would silently suppress every `affected`.
 */
export function toApplicabilityCandidates(
  resolution: AssetResolution,
  backingNodeOf?: (assetId: string) => { node_type: string; node_id: string } | null
): MatcherCandidate[] {
  return resolution.candidates.map((c) => ({
    target_type: "asset",
    target_id: c.asset_id,
    match_score: c.confidence,
    match_reason: c.match_rationale,
    asset_type: c.asset_type,
    asset_id: c.asset_id,
    graph_node: backingNodeOf?.(c.asset_id) ?? null,
  }));
}

export interface SignalApplicability {
  resolution: AssetResolution;
  result: ApplicabilityResult;
}

/**
 * Assess a signal's applicability to an org's assets: resolve -> candidates -> engine.
 *
 * READ-ONLY. Persisting the assessment is C5's job, not this one — C4 stops at deciding.
 * Org-scoped throughout; the resolver's only query filters organization_id, and the graph
 * read below is org-scoped too.
 */
export async function assessSignalApplicability(
  client: PoolClient,
  organizationId: string,
  signalId: string,
  identity: CanonicalProductIdentity
): Promise<SignalApplicability> {
  const resolution = await resolveTenantAssets(client, organizationId, identity);

  // Map each resolved asset to its backing graph node, so the engine can project a blast
  // radius from it. Org-scoped; registry-only.
  const backing = new Map<string, { node_type: string; node_id: string }>();
  if (resolution.candidates.length > 0) {
    const rows = await client.query<{ asset_id: string; backing_kind: string; backing_id: string }>(
      `SELECT a.id AS asset_id, a.backing_kind, a.backing_id
         FROM assets a
        WHERE a.organization_id = $1 AND a.id = ANY($2::uuid[])`,
      [organizationId, resolution.candidates.map((c) => c.asset_id)]
    );
    for (const r of rows.rows) {
      // The graph identity an asset has DEPENDS ON HOW IT IS EDGED, and the two cases are
      // genuinely different — getting this wrong roots the BFS at a node with no edges,
      // which yields "strong match, no reachability" and silently caps every evidenced
      // match at `potentially_affected`. That is how this bridge failed its first run.
      //
      //   vendors / ai_systems — the asset IS that entity, and enterprise_relationships +
      //     ai_system_vendor_dependencies edge it as ('vendor'|'ai_system', backing_id).
      //   everything else — enterprise_relationships edges it as ('asset', assets.id)
      //     (from_type='asset', from_id=assets.id; see 20260801). NOT the backing row id.
      const node =
        r.backing_kind === "vendors"
          ? { node_type: "vendor", node_id: r.backing_id }
          : r.backing_kind === "ai_systems"
            ? { node_type: "ai_system", node_id: r.backing_id }
            : { node_type: "asset", node_id: r.asset_id };
      backing.set(r.asset_id, node);
    }
  }

  const candidates = toApplicabilityCandidates(resolution, (id) => backing.get(id) ?? null);

  // The neighborhood is resolved lazily and only when there is something to root at — the
  // graph modules construct the pg pool at import (see findingEnterpriseContext).
  let neighborhood: ApplicabilityInput["neighborhood"];
  const root = candidates.find((c) => c.graph_node);
  if (root?.graph_node) {
    try {
      const { resolveNeighborhood } = await import("./enterpriseGraphResolver.js");
      neighborhood = await resolveNeighborhood(
        organizationId,
        root.graph_node.node_type,
        root.graph_node.node_id,
        2,
        client
      );
    } catch {
      // A failed traversal must not manufacture an `affected`. Leaving the neighborhood
      // absent makes the engine reason on match signals alone and cap at
      // `potentially_affected` — the safe direction to fail in.
      neighborhood = undefined;
    }
  }

  // exactOptionalPropertyTypes: an absent neighborhood must be OMITTED, not set to
  // undefined — the engine's contract distinguishes "no graph" from "a graph key holding
  // undefined", and only the former means "reason on match signals alone".
  const input: ApplicabilityInput = neighborhood
    ? { signalId, candidates, neighborhood }
    : { signalId, candidates };

  const result = ApplicabilityEngineV1.assess(input);
  return { resolution, result };
}
