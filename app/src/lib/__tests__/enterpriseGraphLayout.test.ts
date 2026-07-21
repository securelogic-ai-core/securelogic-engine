import { describe, it, expect } from "vitest";
import type { GraphNeighborhood } from "../enterpriseContext";
import {
  GRAPH_LAYOUT,
  buildNodeNameMap,
  graphNodeKey,
  layoutGraph,
  nodeDisplayName,
} from "../enterpriseGraphLayout";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function neighborhood(overrides: Partial<GraphNeighborhood> = {}): GraphNeighborhood {
  return {
    root: { node_type: "enterprise_entity", node_id: id(1) },
    depth: 3,
    nodes: [
      { node_type: "enterprise_entity", node_id: id(1), depth: 0 },
      { node_type: "enterprise_entity", node_id: id(2), depth: 1 },
      { node_type: "vendor", node_id: id(3), depth: 1 },
      { node_type: "ai_system", node_id: id(4), depth: 2 },
    ],
    edges: [
      {
        from_type: "enterprise_entity",
        from_id: id(1),
        to_type: "enterprise_entity",
        to_id: id(2),
        relationship_type: "depends_on",
        source: "enterprise_relationships",
      },
      {
        from_type: "enterprise_entity",
        from_id: id(2),
        to_type: "ai_system",
        to_id: id(4),
        relationship_type: "runs_on",
        source: "enterprise_relationships",
      },
    ],
    ...overrides,
  };
}

describe("layoutGraph", () => {
  it("places one column per depth, left to right", () => {
    const layout = layoutGraph(neighborhood());
    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    const root = byKey.get(graphNodeKey("enterprise_entity", id(1)))!;
    const d1 = byKey.get(graphNodeKey("vendor", id(3)))!;
    const d2 = byKey.get(graphNodeKey("ai_system", id(4)))!;
    expect(root.x).toBeLessThan(d1.x);
    expect(d1.x).toBeLessThan(d2.x);
    expect(root.x).toBe(GRAPH_LAYOUT.margin);
  });

  it("is deterministic under node/edge order permutations", () => {
    const base = neighborhood();
    const shuffled = neighborhood({
      nodes: [...base.nodes].reverse(),
      edges: [...base.edges].reverse(),
    });
    const a = layoutGraph(base);
    const b = layoutGraph(shuffled);
    expect(b.nodes).toEqual(a.nodes);
    expect(new Set(b.edges.map((e) => e.fromKey + e.toKey))).toEqual(
      new Set(a.edges.map((e) => e.fromKey + e.toKey)),
    );
  });

  it("caps a column and reports omissions per depth", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      node_type: "enterprise_entity" as const,
      node_id: id(100 + i),
      depth: 1,
    }));
    const layout = layoutGraph(
      neighborhood({ nodes: [{ node_type: "enterprise_entity", node_id: id(1), depth: 0 }, ...many] }),
      { maxPerColumn: 10 },
    );
    expect(layout.nodes.filter((n) => n.depth === 1)).toHaveLength(10);
    expect(layout.omitted).toEqual([{ depth: 1, count: 40 }]);
  });

  it("drops edges with unplaced endpoints and counts them, never guesses", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      node_type: "enterprise_entity" as const,
      node_id: id(100 + i),
      depth: 1,
    }));
    // Edge to the node that will be cut by the column cap (sorted order keeps 100..109).
    const layout = layoutGraph(
      neighborhood({
        nodes: [{ node_type: "enterprise_entity", node_id: id(1), depth: 0 }, ...many],
        edges: [
          {
            from_type: "enterprise_entity",
            from_id: id(1),
            to_type: "enterprise_entity",
            to_id: id(111),
            relationship_type: "depends_on",
            source: "enterprise_relationships",
          },
        ],
      }),
      { maxPerColumn: 10 },
    );
    expect(layout.edges).toHaveLength(0);
    expect(layout.omittedEdgeCount).toBe(1);
  });

  it("forward edges leave the right side of the shallower node", () => {
    const layout = layoutGraph(neighborhood());
    const e = layout.edges.find((x) => x.relationship_type === "depends_on")!;
    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    const from = byKey.get(e.fromKey)!;
    expect(e.x1).toBe(from.x + GRAPH_LAYOUT.nodeWidth);
    expect(e.y1).toBe(from.y + GRAPH_LAYOUT.nodeHeight / 2);
  });

  it("computes a bounding box that contains every node", () => {
    const layout = layoutGraph(neighborhood());
    for (const n of layout.nodes) {
      expect(n.x + GRAPH_LAYOUT.nodeWidth).toBeLessThanOrEqual(layout.width);
      expect(n.y + GRAPH_LAYOUT.nodeHeight).toBeLessThanOrEqual(layout.height);
    }
  });

  it("handles an empty neighborhood", () => {
    const layout = layoutGraph(neighborhood({ nodes: [], edges: [] }));
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(2 * GRAPH_LAYOUT.margin);
  });
});

describe("node names", () => {
  it("maps each node family and falls back to a short id", () => {
    const map = buildNodeNameMap({
      entities: [{ id: id(1), name: "Payments API" }],
      vendors: [{ id: id(3), name: "Stripe" }],
      aiSystems: [{ id: id(4), name: "Fraud Model" }],
    });
    expect(nodeDisplayName(map, "enterprise_entity", id(1))).toBe("Payments API");
    expect(nodeDisplayName(map, "vendor", id(3))).toBe("Stripe");
    expect(nodeDisplayName(map, "ai_system", id(4))).toBe("Fraud Model");
    expect(nodeDisplayName(map, "user", id(9))).toBe("00000009…");
  });
});
