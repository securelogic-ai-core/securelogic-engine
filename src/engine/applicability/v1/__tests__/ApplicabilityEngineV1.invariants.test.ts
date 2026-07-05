/**
 * ApplicabilityEngineV1.invariants.test.ts — database-free unit + determinism +
 * purity proofs for the pure IAE core. Mirrors the scoring engine's
 * `.invariants.test.ts`. No Postgres, no I/O.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ApplicabilityEngineV1 } from "../ApplicabilityEngineV1.js";
import { DEFAULT_APPLICABILITY_POLICY } from "../applicabilityPolicy.js";
import {
  APPLICABILITY_DECISIONS,
  type ApplicabilityInput,
  type GraphNeighborhood,
  type MatcherCandidate
} from "../types.js";

const P = DEFAULT_APPLICABILITY_POLICY;

function candidate(partial: Partial<MatcherCandidate>): MatcherCandidate {
  return {
    target_type: "vendor",
    target_id: "11111111-1111-1111-1111-111111111111",
    match_score: 90,
    match_reason: "vendor_name_ilike",
    ...partial
  };
}

/** A neighborhood seeded at a vendor with two outward hops (app, then owner). */
function neighborhood(vendorId: string): GraphNeighborhood {
  return {
    root: { node_type: "vendor", node_id: vendorId },
    depth: 3,
    nodes: [
      { node_type: "vendor", node_id: vendorId, depth: 0 },
      { node_type: "application", node_id: "app-1", depth: 1 },
      { node_type: "business_service", node_id: "svc-1", depth: 1 },
      { node_type: "identity", node_id: "owner-1", depth: 2 }
    ],
    edges: [
      { from_type: "vendor", from_id: vendorId, to_type: "application", to_id: "app-1", relationship_type: "supplies", source: "enterprise_relationship" },
      { from_type: "vendor", from_id: vendorId, to_type: "business_service", to_id: "svc-1", relationship_type: "supports", source: "enterprise_relationship" },
      { from_type: "application", from_id: "app-1", to_type: "identity", to_id: "owner-1", relationship_type: "owned_by", source: "enterprise_relationship" }
    ]
  };
}

describe("ApplicabilityEngineV1 — decision matrix", () => {
  const vendorId = "22222222-2222-2222-2222-222222222222";

  it("strong match + reachable path -> affected (high confidence)", () => {
    const input: ApplicabilityInput = {
      signalId: "sig-1",
      candidates: [candidate({ target_id: vendorId, match_score: 92 })],
      neighborhood: neighborhood(vendorId)
    };
    const r = ApplicabilityEngineV1.assess(input);
    expect(r.decision).toBe("affected");
    expect(r.affected_entities.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThanOrEqual(P.baseConfidence.affected);
    expect(r.confidence_band).toBe("high");
  });

  it("strong match but NO neighborhood -> potentially_affected", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-2",
      candidates: [candidate({ target_id: vendorId, match_score: 88 })]
    });
    expect(r.decision).toBe("potentially_affected");
    expect(r.affected_entities).toEqual([]);
  });

  it("moderate match -> potentially_affected regardless of reachability", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-3",
      candidates: [candidate({ target_id: vendorId, match_score: 50 })],
      neighborhood: neighborhood(vendorId)
    });
    expect(r.decision).toBe("potentially_affected");
  });

  it("weak match without reachability -> not_affected", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-4",
      candidates: [candidate({ target_id: vendorId, match_score: 25 })]
    });
    expect(r.decision).toBe("not_affected");
  });

  it("weak match WITH reachability -> potentially_affected", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-4b",
      candidates: [candidate({ target_id: vendorId, match_score: 25 })],
      neighborhood: neighborhood(vendorId)
    });
    expect(r.decision).toBe("potentially_affected");
  });

  it("no candidates -> not_affected (confidence IN non-applicability)", () => {
    const r = ApplicabilityEngineV1.assess({ signalId: "sig-5", candidates: [] });
    expect(r.decision).toBe("not_affected");
    expect(r.confidence).toBe(P.baseConfidence.not_affected);
  });

  it("candidates present but ALL null score -> needs_review", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-6",
      candidates: [candidate({ match_score: null }), candidate({ target_id: "x", match_score: null })]
    });
    expect(r.decision).toBe("needs_review");
    expect(r.affected_entities).toEqual([]);
  });

  it("malformed input -> unknown, never throws", () => {
    const r = ApplicabilityEngineV1.assess({ signalId: "sig-7" } as unknown as ApplicabilityInput);
    expect(r.decision).toBe("unknown");
    expect(r.confidence).toBe(0);
  });
});

describe("ApplicabilityEngineV1 — blast radius", () => {
  const vendorId = "33333333-3333-3333-3333-333333333333";

  it("projects only outward-reachable nodes with correct min_depth, excludes the matched node", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-b",
      candidates: [candidate({ target_id: vendorId, match_score: 95 })],
      neighborhood: neighborhood(vendorId)
    });
    const keys = r.affected_entities.map((a) => `${a.node_type}:${a.node_id}@${a.min_depth}`);
    expect(keys).toContain("application:app-1@1");
    expect(keys).toContain("business_service:svc-1@1");
    expect(keys).toContain("identity:owner-1@2");
    // the matched vendor is never in its own blast radius
    expect(r.affected_entities.some((a) => a.node_id === vendorId)).toBe(false);
    // every affected entity records the matched target it came via
    for (const a of r.affected_entities) {
      expect(a.via_target_type).toBe("vendor");
      expect(a.via_target_id).toBe(vendorId);
    }
  });

  it("control/obligation targets carry no blast radius but strong matches reach 'affected' (R1b)", () => {
    // EAR Phase 2: reachability is only required of graph-representable
    // targets. control/obligation structurally cannot appear in the graph, so
    // a strong match alone concludes 'affected' (rule R1b) — previously they
    // were capped at potentially_affected forever (ARCHITECTURE.md §1.4).
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-c",
      candidates: [candidate({ target_type: "control", target_id: "ctrl-1", match_score: 95 })],
      neighborhood: neighborhood(vendorId)
    });
    expect(r.affected_entities).toEqual([]); // still no blast radius
    expect(r.decision).toBe("affected");
    expect(r.reasoning_steps.some((s) => s.rule_id === "R1b_strong_match_non_graph_target")).toBe(true);
  });

  it("moderate-tier control matches stay potentially_affected (R1b requires strong)", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-c2",
      candidates: [candidate({ target_type: "control", target_id: "ctrl-1", match_score: 60 })],
      neighborhood: neighborhood(vendorId)
    });
    expect(r.decision).toBe("potentially_affected");
  });

  it("strong vendor match WITHOUT reachability still stays potentially_affected (R2 unchanged)", () => {
    // Graph-representable targets keep the reachability requirement — R1b
    // must not weaken the vendor/ai_system decision matrix.
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-c3",
      candidates: [candidate({ target_id: "vendor-unreachable", match_score: 95 })]
      // no neighborhood
    });
    expect(r.decision).toBe("potentially_affected");
    expect(r.reasoning_steps.some((s) => s.rule_id === "R2_strong_match_no_reachability")).toBe(true);
  });

  it("asset targets consult the registry spec: graph-representable asset types require reachability, non-graph ones don't", () => {
    // application → graphRepresentable=true → no reachability ⇒ R2.
    const app = ApplicabilityEngineV1.assess({
      signalId: "sig-c4",
      candidates: [candidate({ target_type: "asset", target_id: "asset-1", match_score: 95, asset_type: "application" })]
    });
    expect(app.decision).toBe("potentially_affected");
    // cloud_resource → graphRepresentable=false (no detail table yet) ⇒ R1b.
    const cr = ApplicabilityEngineV1.assess({
      signalId: "sig-c5",
      candidates: [candidate({ target_type: "asset", target_id: "asset-2", match_score: 95, asset_type: "cloud_resource" })]
    });
    expect(cr.decision).toBe("affected");
    // unknown asset_type → fail-closed (not graph-representable) ⇒ R1b path.
    const unk = ApplicabilityEngineV1.assess({
      signalId: "sig-c6",
      candidates: [candidate({ target_type: "asset", target_id: "asset-3", match_score: 95, asset_type: "not_a_type" })]
    });
    expect(unk.decision).toBe("affected");
  });

  it("empty neighborhood -> empty blast radius, decision still valid", () => {
    const r = ApplicabilityEngineV1.assess({
      signalId: "sig-d",
      candidates: [candidate({ target_id: vendorId, match_score: 95 })],
      neighborhood: { root: { node_type: "vendor", node_id: vendorId }, depth: 3, nodes: [], edges: [] }
    });
    expect(r.affected_entities).toEqual([]);
    expect(r.decision).toBe("potentially_affected");
  });
});

describe("ApplicabilityEngineV1 — determinism & invariants", () => {
  const vendorId = "44444444-4444-4444-4444-444444444444";
  const base: ApplicabilityInput = {
    signalId: "sig-det",
    candidates: [
      candidate({ target_id: vendorId, match_score: 92 }),
      candidate({ target_type: "ai_system", target_id: "ai-1", match_score: 44 }),
      candidate({ target_type: "control", target_id: "c-1", match_score: 60 })
    ],
    neighborhood: neighborhood(vendorId)
  };

  it("identical input twice -> deep-equal output (incl. reasoning_steps)", () => {
    expect(ApplicabilityEngineV1.assess(base)).toEqual(ApplicabilityEngineV1.assess(base));
  });

  it("candidate-order permutation -> identical output", () => {
    const shuffled: ApplicabilityInput = {
      ...base,
      candidates: [base.candidates[2], base.candidates[0], base.candidates[1]]
    };
    expect(ApplicabilityEngineV1.assess(shuffled)).toEqual(ApplicabilityEngineV1.assess(base));
  });

  it("edge-order permutation -> identical output", () => {
    const nb = base.neighborhood!;
    const permuted: ApplicabilityInput = {
      ...base,
      neighborhood: { ...nb, edges: [nb.edges[2], nb.edges[0], nb.edges[1]] }
    };
    expect(ApplicabilityEngineV1.assess(permuted)).toEqual(ApplicabilityEngineV1.assess(base));
  });

  it("confidence stays within [0,100] and decision/band are always valid enums (fuzz scores)", () => {
    for (let s = -10; s <= 110; s += 7) {
      const r = ApplicabilityEngineV1.assess({
        signalId: `fuzz-${s}`,
        candidates: [candidate({ target_id: vendorId, match_score: s })],
        neighborhood: neighborhood(vendorId)
      });
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
      expect(APPLICABILITY_DECISIONS).toContain(r.decision);
      expect(["low", "medium", "high"]).toContain(r.confidence_band);
    }
  });

  it("output pins the corpus versions; injecting a different policy changes the pins", () => {
    const r = ApplicabilityEngineV1.assess(base);
    expect(r.engine_version).toBe(P.engine_version);
    expect(r.schema_version).toBe(P.schema_version);

    const custom = { ...P, engine_version: "iae-test-9.9.9" };
    const r2 = ApplicabilityEngineV1.assess(base, custom);
    expect(r2.engine_version).toBe("iae-test-9.9.9");
  });
});

describe("ApplicabilityEngineV1 — purity / inertness", () => {
  const engineSrc = fileURLToPath(new URL("../ApplicabilityEngineV1.ts", import.meta.url));
  const files = [
    "../ApplicabilityEngineV1.ts",
    "../applicabilityPolicy.ts",
    "../types.ts"
  ].map((f) => fileURLToPath(new URL(f, import.meta.url)));

  it("the engine module imports no DB/runtime I/O (pg, postgres, resolver runtime)", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // No pg / postgres runtime import.
      expect(src).not.toMatch(/from\s+["'].*infra\/postgres/);
      expect(src).not.toMatch(/from\s+["']pg["']/);
      // The resolver may only be imported as a TYPE (compile-erased), never a value.
      const nonTypeResolverImport = /import\s+(?!type)[^;]*enterpriseGraphResolver/;
      expect(src).not.toMatch(nonTypeResolverImport);
    }
    expect(readFileSync(engineSrc, "utf8")).toContain("static assess");
  });
});
