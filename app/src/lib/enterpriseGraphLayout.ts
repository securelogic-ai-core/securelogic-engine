/**
 * enterpriseGraphLayout.ts — pure, deterministic layered layout for the enterprise
 * graph view (goal Item 7, Phase 7A.3). No React, no DOM, no I/O: takes the resolver's
 * GraphNeighborhood and produces absolute SVG coordinates, so the layout is fully
 * unit-testable and the rendering component stays trivial.
 *
 * Layout model: one column per BFS depth (0 = the root), nodes sorted within a column
 * by (node_type, node_id) for determinism. Columns are capped (MAX_PER_COLUMN) so a
 * high-fan-out neighborhood (the resolver allows hundreds of nodes) can't produce an
 * unusably tall SVG — omitted nodes are counted per depth and surfaced to the UI.
 * Edges whose endpoints aren't both placed are dropped and counted, never guessed.
 */

import type { GraphEdge, GraphNeighborhood, GraphNode } from "./enterpriseContext";

export const GRAPH_LAYOUT = {
  nodeWidth: 190,
  nodeHeight: 44,
  columnGap: 90,
  rowGap: 16,
  margin: 40,
  maxPerColumn: 40,
} as const;

export interface PlacedNode {
  key: string;
  node_type: GraphNode["node_type"];
  node_id: string;
  depth: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  fromKey: string;
  toKey: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  relationship_type: string;
  source: string;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** nodes dropped because their column exceeded maxPerColumn, keyed by depth */
  omitted: Array<{ depth: number; count: number }>;
  /** edges dropped because an endpoint wasn't placed */
  omittedEdgeCount: number;
}

export function graphNodeKey(nodeType: string, nodeId: string): string {
  return `${nodeType}:${nodeId}`;
}

export function layoutGraph(
  neighborhood: GraphNeighborhood,
  opts: { maxPerColumn?: number } = {},
): GraphLayout {
  const { nodeWidth, nodeHeight, columnGap, rowGap, margin } = GRAPH_LAYOUT;
  const maxPerColumn = opts.maxPerColumn ?? GRAPH_LAYOUT.maxPerColumn;

  // Group by depth, deterministic order within a column.
  const byDepth = new Map<number, GraphNode[]>();
  for (const n of neighborhood.nodes) {
    const col = byDepth.get(n.depth) ?? [];
    col.push(n);
    byDepth.set(n.depth, col);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  const placed: PlacedNode[] = [];
  const positions = new Map<string, PlacedNode>();
  const omitted: Array<{ depth: number; count: number }> = [];
  let tallestColumn = 0;

  for (const depth of depths) {
    const column = [...(byDepth.get(depth) ?? [])].sort(
      (a, b) =>
        a.node_type.localeCompare(b.node_type) || a.node_id.localeCompare(b.node_id),
    );
    const kept = column.slice(0, maxPerColumn);
    if (column.length > kept.length) {
      omitted.push({ depth, count: column.length - kept.length });
    }
    tallestColumn = Math.max(tallestColumn, kept.length);

    kept.forEach((n, i) => {
      const node: PlacedNode = {
        key: graphNodeKey(n.node_type, n.node_id),
        node_type: n.node_type,
        node_id: n.node_id,
        depth,
        x: margin + depth * (nodeWidth + columnGap),
        y: margin + i * (nodeHeight + rowGap),
      };
      placed.push(node);
      positions.set(node.key, node);
    });
  }

  // Edges: connect box edges (right side of the shallower endpoint → left side of the
  // deeper one); same-depth edges connect left sides. Endpoints must both be placed.
  const edges: PlacedEdge[] = [];
  let omittedEdgeCount = 0;
  for (const e of neighborhood.edges) {
    const from = positions.get(graphNodeKey(e.from_type, e.from_id));
    const to = positions.get(graphNodeKey(e.to_type, e.to_id));
    if (!from || !to) {
      omittedEdgeCount += 1;
      continue;
    }
    edges.push(placeEdge(e, from, to, nodeWidth, nodeHeight));
  }

  const columnCount = depths.length === 0 ? 0 : Math.max(...depths) + 1;
  const width =
    columnCount === 0
      ? 2 * margin
      : 2 * margin + columnCount * nodeWidth + (columnCount - 1) * columnGap;
  const height =
    2 * margin + Math.max(0, tallestColumn * nodeHeight + Math.max(0, tallestColumn - 1) * rowGap);

  return { width, height, nodes: placed, edges, omitted, omittedEdgeCount };
}

function placeEdge(
  e: GraphEdge,
  from: PlacedNode,
  to: PlacedNode,
  nodeWidth: number,
  nodeHeight: number,
): PlacedEdge {
  const midY = (n: PlacedNode) => n.y + nodeHeight / 2;
  let x1: number;
  let x2: number;
  if (from.depth < to.depth) {
    x1 = from.x + nodeWidth;
    x2 = to.x;
  } else if (from.depth > to.depth) {
    x1 = from.x;
    x2 = to.x + nodeWidth;
  } else {
    x1 = from.x;
    x2 = to.x;
  }
  return {
    fromKey: from.key,
    toKey: to.key,
    x1,
    y1: midY(from),
    x2,
    y2: midY(to),
    relationship_type: e.relationship_type,
    source: e.source,
  };
}

// ─── Node display names ────────────────────────────────────────────────────────
//
// The resolver returns ids only. The graph page batch-loads what it can (entities,
// vendors, AI systems — each list-capped) and falls back to a short id. Honest about
// coverage: names beyond the loaded pages render as ids, never invented.

export function buildNodeNameMap(sources: {
  entities?: Array<{ id: string; name: string }>;
  vendors?: Array<{ id: string; name: string }>;
  aiSystems?: Array<{ id: string; name: string }>;
}): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of sources.entities ?? []) map.set(graphNodeKey("enterprise_entity", e.id), e.name);
  for (const v of sources.vendors ?? []) map.set(graphNodeKey("vendor", v.id), v.name);
  for (const a of sources.aiSystems ?? []) map.set(graphNodeKey("ai_system", a.id), a.name);
  return map;
}

export function nodeDisplayName(
  nameMap: Map<string, string>,
  nodeType: string,
  nodeId: string,
): string {
  return nameMap.get(graphNodeKey(nodeType, nodeId)) ?? `${nodeId.slice(0, 8)}…`;
}
