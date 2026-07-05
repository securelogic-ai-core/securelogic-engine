import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getAiSystems,
  getEnterpriseEntities,
  getEnterpriseGraph,
  getVendors,
} from "@/lib/api";
import {
  GRAPH_DEPTH,
  NODE_TYPES,
  type NodeType,
} from "@/lib/enterpriseContext";
import {
  nodeTypeLabel,
  readFailure,
  relationshipTypeLabel,
} from "@/lib/enterpriseContextFormat";
import {
  GRAPH_LAYOUT,
  buildNodeNameMap,
  layoutGraph,
  nodeDisplayName,
  type PlacedNode,
} from "@/lib/enterpriseGraphLayout";
import { ReadFailurePanel } from "../shared";

function isNodeType(v: string | undefined): v is NodeType {
  return !!v && (NODE_TYPES as readonly string[]).includes(v);
}

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  enterprise_entity: { fill: "rgba(59,130,246,0.12)", stroke: "rgba(59,130,246,0.45)", text: "#93c5fd" },
  vendor:            { fill: "rgba(249,115,22,0.12)", stroke: "rgba(249,115,22,0.45)", text: "#fdba74" },
  ai_system:         { fill: "rgba(168,85,247,0.12)", stroke: "rgba(168,85,247,0.45)", text: "#d8b4fe" },
  user:              { fill: "rgba(148,163,184,0.12)", stroke: "rgba(148,163,184,0.4)", text: "#94a3b8" },
};

export default async function EnterpriseGraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  if (!isNodeType(sp.node_type) || !sp.node_id) redirect("/enterprise-context");
  const nodeType = sp.node_type;
  const nodeId = sp.node_id;
  const depthRaw = Number(sp.depth);
  const depth =
    Number.isFinite(depthRaw) && depthRaw >= GRAPH_DEPTH.min && depthRaw <= GRAPH_DEPTH.max
      ? Math.floor(depthRaw)
      : GRAPH_DEPTH.default;

  // Graph + best-effort name sources (each list is page-capped; unknown names fall
  // back to short ids — never invented).
  const [graphResult, entitiesResult, vendorsResult, aiSystemsResult] = await Promise.all([
    getEnterpriseGraph(token, { node_type: nodeType, node_id: nodeId, depth }),
    getEnterpriseEntities(token, { limit: 100 }),
    getVendors(token),
    getAiSystems(token),
  ]);

  if (!graphResult.ok) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <BackLink nodeType={nodeType} nodeId={nodeId} />
        <ReadFailurePanel {...readFailure(graphResult)} />
      </div>
    );
  }

  const graph = graphResult.enterprise_graph;
  const nameMap = buildNodeNameMap({
    entities: entitiesResult.ok ? entitiesResult.enterprise_entities : [],
    vendors: vendorsResult?.vendors ?? [],
    aiSystems: aiSystemsResult?.ai_systems ?? [],
  });
  const layout = layoutGraph(graph);
  const rootName = nodeDisplayName(nameMap, nodeType, nodeId);
  const omittedNodeCount = layout.omitted.reduce((s, o) => s + o.count, 0);

  const depthHref = (d: number) => {
    const q = new URLSearchParams({ node_type: nodeType, node_id: nodeId, depth: String(d) });
    return `/enterprise-context/graph?${q.toString()}`;
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <BackLink nodeType={nodeType} nodeId={nodeId} />

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Dependency Graph
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Everything reachable from <span style={{ color: "#f1f5f9" }}>{rootName}</span>{" "}
            within {graph.depth} hop{graph.depth !== 1 ? "s" : ""} — {graph.nodes.length}{" "}
            node{graph.nodes.length !== 1 ? "s" : ""}, {graph.edges.length} connection
            {graph.edges.length !== 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs mr-1" style={{ color: "#64748b" }}>Depth</span>
          {Array.from({ length: GRAPH_DEPTH.max }, (_, i) => i + 1).map((d) => (
            <Link
              key={d}
              href={depthHref(d)}
              className="px-2.5 py-1 rounded text-xs font-medium border transition-colors hover:opacity-80"
              style={
                d === depth
                  ? { background: "rgba(0,196,180,0.15)", borderColor: "rgba(0,196,180,0.4)", color: "#5eead4" }
                  : { background: "transparent", borderColor: "#1e293b", color: "#94a3b8" }
              }
            >
              {d}
            </Link>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        {NODE_TYPES.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-xs" style={{ color: "#94a3b8" }}>
            <span
              className="inline-block w-3 h-3 rounded"
              style={{ background: NODE_COLORS[t].fill, border: `1px solid ${NODE_COLORS[t].stroke}` }}
            />
            {nodeTypeLabel(t)}
          </span>
        ))}
      </div>

      {(omittedNodeCount > 0 || layout.omittedEdgeCount > 0) && (
        <p className="mb-4 text-xs" style={{ color: "#fcd34d" }}>
          Dense neighborhood: {omittedNodeCount > 0 && `${omittedNodeCount} node${omittedNodeCount !== 1 ? "s" : ""} not drawn`}
          {omittedNodeCount > 0 && layout.omittedEdgeCount > 0 && ", "}
          {layout.omittedEdgeCount > 0 &&
            `${layout.omittedEdgeCount} connection${layout.omittedEdgeCount !== 1 ? "s" : ""} not drawn`}
          . Lower the depth for a complete picture.
        </p>
      )}

      {graph.nodes.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>Nothing connected yet.</p>
        </div>
      ) : (
        <div
          className="bg-brand-surface border border-brand-line rounded-xl p-4"
          style={{ overflowX: "auto" }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={`Dependency graph for ${rootName}`}
          >
            {/* Edges under nodes */}
            {layout.edges.map((e, i) => (
              <g key={i}>
                <line
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="#334155"
                  strokeWidth={1.2}
                />
                <text
                  x={(e.x1 + e.x2) / 2}
                  y={(e.y1 + e.y2) / 2 - 4}
                  fontSize={9}
                  fill="#64748b"
                  textAnchor="middle"
                >
                  {relationshipTypeLabel(e.relationship_type)}
                </text>
              </g>
            ))}
            {/* Nodes */}
            {layout.nodes.map((n) => (
              <GraphNodeBox
                key={n.key}
                node={n}
                name={nodeDisplayName(nameMap, n.node_type, n.node_id)}
                isRoot={n.node_type === nodeType && n.node_id === nodeId}
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function BackLink({ nodeType, nodeId }: { nodeType: NodeType; nodeId: string }) {
  const href =
    nodeType === "enterprise_entity"
      ? `/enterprise-context/entities/${nodeId}`
      : "/enterprise-context";
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
      style={{ color: "#94a3b8" }}
    >
      ← {nodeType === "enterprise_entity" ? "Entity" : "Enterprise Context"}
    </Link>
  );
}

function GraphNodeBox({
  node,
  name,
  isRoot,
}: {
  node: PlacedNode;
  name: string;
  isRoot: boolean;
}) {
  const colors = NODE_COLORS[node.node_type] ?? NODE_COLORS.user;
  const { nodeWidth, nodeHeight } = GRAPH_LAYOUT;
  const label = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  const box = (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={nodeWidth}
        height={nodeHeight}
        rx={8}
        fill={colors.fill}
        stroke={isRoot ? "#00c4b4" : colors.stroke}
        strokeWidth={isRoot ? 2 : 1}
      />
      <text
        x={node.x + 10}
        y={node.y + 18}
        fontSize={12}
        fontWeight={600}
        fill="#f1f5f9"
      >
        {label}
      </text>
      <text x={node.x + 10} y={node.y + 33} fontSize={9} fill={colors.text}>
        {nodeTypeLabel(node.node_type)}
        {node.depth > 0 ? ` · ${node.depth} hop${node.depth !== 1 ? "s" : ""}` : ""}
      </text>
    </g>
  );

  if (node.node_type === "enterprise_entity") {
    return <Link href={`/enterprise-context/entities/${node.node_id}`}>{box}</Link>;
  }
  if (node.node_type === "vendor") {
    return <Link href={`/vendors/${node.node_id}`}>{box}</Link>;
  }
  if (node.node_type === "ai_system") {
    return <Link href={`/ai-systems/${node.node_id}`}>{box}</Link>;
  }
  return box;
}
