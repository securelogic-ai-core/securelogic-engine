/**
 * applicabilityBridge.test.ts — C4 part 4: the proof that EVIDENCE gates `affected`.
 *
 * This is the whole point of C4, expressed as four assertions:
 *
 *   an asset the customer ATTESTED runs Exchange        -> can be `affected`
 *   an asset an SBOM/connector says runs Exchange       -> can be `affected`
 *   an asset merely NAMED "Exchange", with no evidence  -> `potentially_affected`, never `affected`
 *   a vendor-only signal ("Microsoft", no product)      -> never resolves at all (ERG R2)
 *
 * The engine is untouched: it already tiers on applicabilityPolicy.matchThresholds and
 * already owns the decision matrix. The bridge only decides what SCORE the evidence earns.
 * That mapping is the gate, so it is what is pinned here.
 */
import { describe, it, expect } from "vitest";
import { toApplicabilityCandidates } from "../lib/applicabilityBridge.js";
import { IDENTITY_CONFIDENCE, type AssetResolution } from "../lib/tenantAssetResolver.js";
import { ApplicabilityEngineV1 } from "../../engine/applicability/v1/ApplicabilityEngineV1.js";
import { DEFAULT_APPLICABILITY_POLICY } from "../../engine/applicability/v1/applicabilityPolicy.js";
import type { GraphNeighborhood } from "../../engine/applicability/v1/types.js";

const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BACKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** The asset's backing node, plus one thing that depends on it (so reachability exists). */
const NEIGHBORHOOD: GraphNeighborhood = {
  nodes: [
    { node_type: "enterprise_entity", node_id: BACKING, depth: 0 },
    { node_type: "enterprise_entity", node_id: DEP, depth: 1 },
  ],
  edges: [
    {
      from_type: "enterprise_entity",
      from_id: BACKING,
      to_type: "enterprise_entity",
      to_id: DEP,
      relationship_type: "depends_on",
    },
  ],
} as unknown as GraphNeighborhood;

function resolutionWith(provenance: keyof typeof IDENTITY_CONFIDENCE): AssetResolution {
  return {
    resolver_version: "tar-v2.0.0",
    status: "resolved",
    reason: "single_active_asset_match",
    candidates: [
      {
        asset_id: ASSET,
        asset_type: "application",
        name: "EXCH-PROD-01",
        match_rationale: `asset_product_identity(${provenance})`,
        confidence: IDENTITY_CONFIDENCE[provenance]!,
        source_identifiers: ["product_canonical:exchange", `provenance:${provenance}`],
      },
    ],
  };
}

function decide(provenance: keyof typeof IDENTITY_CONFIDENCE) {
  const candidates = toApplicabilityCandidates(resolutionWith(provenance), () => ({
    node_type: "enterprise_entity",
    node_id: BACKING,
  }));
  return ApplicabilityEngineV1.assess({
    signalId: "sig-1",
    candidates,
    neighborhood: NEIGHBORHOOD,
  });
}

describe("the evidence gate — what may and may not be called `affected`", () => {
  it("ATTESTED: the customer said this asset runs it -> `affected`", () => {
    expect(decide("attestation").decision).toBe("affected");
  });

  it("SBOM / CONNECTOR evidence -> `affected`", () => {
    expect(decide("sbom").decision).toBe("affected");
    expect(decide("connector").decision).toBe("affected");
  });

  it("A NAME COINCIDENCE is NOT evidence -> `potentially_affected`, never `affected`", () => {
    // The whole reason C4 exists. Before it, this scored 100 and would have asserted
    // `affected` because someone happened to name an asset after the product.
    const r = decide("inferred");
    expect(r.decision).toBe("potentially_affected");
    expect(r.decision).not.toBe("affected");
  });

  it("the gate is the POLICY's threshold, not a number invented here", () => {
    const high = DEFAULT_APPLICABILITY_POLICY.matchThresholds.high;
    expect(IDENTITY_CONFIDENCE.connector).toBeGreaterThanOrEqual(high);
    expect(IDENTITY_CONFIDENCE.inferred).toBeLessThan(high);
  });
});

describe("the bridge hands the engine what it needs — and nothing else", () => {
  it("passes confidence through as match_score VERBATIM (no second, invisible policy)", () => {
    const [c] = toApplicabilityCandidates(resolutionWith("connector"));
    expect(c!.match_score).toBe(IDENTITY_CONFIDENCE.connector);
  });

  it("targets the ASSET (R1: impact attaches to assets, never to vendors/products)", () => {
    const [c] = toApplicabilityCandidates(resolutionWith("attestation"));
    expect(c!.target_type).toBe("asset");
    expect(c!.target_id).toBe(ASSET);
    expect(c!.asset_id).toBe(ASSET);
  });

  it("roots the blast radius at the BACKING node — without it, `affected` is unreachable", () => {
    // An 'asset' target lives in the graph as its backing node. Omit graph_node and a
    // strong match has no reachability, so the engine caps at `potentially_affected` —
    // silently suppressing every `affected`. Hence this test.
    const withNode = toApplicabilityCandidates(resolutionWith("connector"), () => ({
      node_type: "enterprise_entity",
      node_id: BACKING,
    }));
    expect(withNode[0]!.graph_node).toEqual({ node_type: "enterprise_entity", node_id: BACKING });

    const withoutNode = ApplicabilityEngineV1.assess({
      signalId: "sig-1",
      candidates: toApplicabilityCandidates(resolutionWith("connector")),
      neighborhood: NEIGHBORHOOD,
    });
    expect(withoutNode.decision).toBe("potentially_affected");
  });

  it("an empty resolution yields no candidates — nothing to decide on", () => {
    const empty: AssetResolution = {
      resolver_version: "tar-v2.0.0",
      status: "no_match",
      reason: "no_active_asset_matches_product",
      candidates: [],
    };
    expect(toApplicabilityCandidates(empty)).toEqual([]);
  });
});

describe("ambiguity and needs_review survive the bridge", () => {
  it("TWO matching assets stay two candidates — the bridge never auto-picks", () => {
    const ambiguous: AssetResolution = {
      resolver_version: "tar-v2.0.0",
      status: "ambiguous",
      reason: "multiple_active_assets_match_product",
      candidates: [
        { ...resolutionWith("attestation").candidates[0]!, asset_id: ASSET },
        { ...resolutionWith("attestation").candidates[0]!, asset_id: DEP },
      ],
    };
    expect(toApplicabilityCandidates(ambiguous)).toHaveLength(2);
  });

  it("a needs_review resolution (vendor-only, R2) carries NO candidates — it cannot seed `affected`", () => {
    const vendorOnly: AssetResolution = {
      resolver_version: "tar-v2.0.0",
      status: "needs_review",
      reason: "not_product_identifiable",
      candidates: [],
    };
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-1",
      candidates: toApplicabilityCandidates(vendorOnly),
      neighborhood: NEIGHBORHOOD,
    });
    expect(r.decision).not.toBe("affected");
  });
});
