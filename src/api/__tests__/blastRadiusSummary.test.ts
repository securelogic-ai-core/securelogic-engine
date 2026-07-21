/**
 * blastRadiusSummary.test.ts — ERIP Epic 7: the pure neighbourhood summary
 * (ERIP-AD-28). Deterministic; root-excluded counts; by-type; depth.
 */

import { describe, expect, it } from "vitest";
import { summarizeBlastRadius, type GraphNodeLike, type GraphEdgeLike } from "../lib/blastRadiusSummary.js";

function node(node_type: string, node_id: string, depth: number): GraphNodeLike {
  return { node_type, node_id, depth };
}
function edge(from: string, to: string): GraphEdgeLike {
  return { from_type: "asset", from_id: from, to_type: "vendor", to_id: to };
}

describe("summarizeBlastRadius", () => {
  it("excludes the root and counts reachable nodes by type", () => {
    const s = summarizeBlastRadius(
      [
        node("asset", "root", 0),
        node("vendor", "v1", 1),
        node("vendor", "v2", 1),
        node("ai_system", "a1", 2)
      ],
      [edge("root", "v1"), edge("root", "v2")]
    );
    expect(s.reachable_count).toBe(3);
    expect(s.by_type).toEqual({ ai_system: 1, vendor: 2 });
    expect(s.max_depth).toBe(2);
    expect(s.edge_count).toBe(2);
  });

  it("a lone root has an empty blast radius", () => {
    const s = summarizeBlastRadius([node("asset", "root", 0)], []);
    expect(s.reachable_count).toBe(0);
    expect(s.by_type).toEqual({});
    expect(s.max_depth).toBe(0);
  });

  it("by_type keys are emitted sorted (stable payload)", () => {
    const s = summarizeBlastRadius(
      [node("asset", "r", 0), node("zebra", "z", 1), node("alpha", "a", 1)],
      []
    );
    expect(Object.keys(s.by_type)).toEqual(["alpha", "zebra"]);
  });

  it("is deterministic", () => {
    const nodes = [node("asset", "r", 0), node("vendor", "v", 1)];
    expect(summarizeBlastRadius(nodes, [])).toEqual(summarizeBlastRadius(nodes, []));
  });
});
