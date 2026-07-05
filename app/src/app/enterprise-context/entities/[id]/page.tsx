import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getAiSystems,
  getEnterpriseEntities,
  getEnterpriseEntity,
  getEnterpriseRelationships,
  getVendors,
} from "@/lib/api";
import type { EnterpriseRelationship, NodeType } from "@/lib/enterpriseContext";
import {
  entityTypeLabel,
  nodeTypeLabel,
  readFailure,
  relationshipTypeLabel,
  titleFromSnake,
} from "@/lib/enterpriseContextFormat";
import { buildNodeNameMap, nodeDisplayName } from "@/lib/enterpriseGraphLayout";
import {
  CriticalityBadge,
  EntityTypeChip,
  ReadFailurePanel,
  StatusChip,
} from "../../shared";
import { AddRelationshipForm, type TargetCandidate } from "./AddRelationshipForm";
import { DeleteEntityButton } from "./DeleteEntityButton";
import { DeleteRelationshipButton } from "./DeleteRelationshipButton";

export default async function EnterpriseEntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [entityResult, relsResult, entitiesResult, vendorsResult, aiSystemsResult] =
    await Promise.all([
      getEnterpriseEntity(token, id),
      getEnterpriseRelationships(token, {
        node_type: "enterprise_entity",
        node_id: id,
        limit: 50,
      }),
      // Name resolution + relationship-target candidates (each list page-capped;
      // the form keeps a paste-an-ID fallback for anything beyond the first page).
      getEnterpriseEntities(token, { limit: 100 }),
      getVendors(token),
      getAiSystems(token),
    ]);

  if (!entityResult.ok) {
    // A plain not_found 404 is indistinguishable from feature-off by design; either
    // way this entity has no page for this user.
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <BackLink />
        <ReadFailurePanel {...readFailure(entityResult)} />
      </div>
    );
  }

  const entity = entityResult.enterprise_entity;
  const relationships = relsResult.ok ? relsResult.enterprise_relationships : [];
  const isDataStore = entity.entity_type === "data_store";

  const nameMap = buildNodeNameMap({
    entities: entitiesResult.ok ? entitiesResult.enterprise_entities : [],
    vendors: vendorsResult?.vendors ?? [],
    aiSystems: aiSystemsResult?.ai_systems ?? [],
  });
  const candidates: Partial<Record<NodeType, TargetCandidate[]>> = {
    enterprise_entity: entitiesResult.ok
      ? entitiesResult.enterprise_entities.map((e) => ({ id: e.id, name: e.name }))
      : [],
    vendor: (vendorsResult?.vendors ?? []).map((v) => ({ id: v.id, name: v.name })),
    ai_system: (aiSystemsResult?.ai_systems ?? []).map((a) => ({ id: a.id, name: a.name })),
    user: [],
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <BackLink />

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate" style={{ color: "#f1f5f9" }}>
              {entity.name}
            </h1>
            <EntityTypeChip value={entity.entity_type} />
            <CriticalityBadge value={entity.criticality} />
            <StatusChip value={entity.status} />
          </div>
          {entity.description && (
            <p className="mt-2 text-sm" style={{ color: "#94a3b8" }}>
              {entity.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/enterprise-context/graph?node_type=enterprise_entity&node_id=${entity.id}`}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            View Graph
          </Link>
          <Link
            href={`/enterprise-context/entities/${entity.id}/edit`}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Details */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-6">
        <h2 className="text-sm font-semibold mb-4" style={{ color: "#f1f5f9" }}>
          Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <DetailField label="Type" value={entityTypeLabel(entity.entity_type)} />
          <DetailField label="Status" value={titleFromSnake(entity.status)} />
          <DetailField
            label="Criticality"
            value={entity.criticality ? titleFromSnake(entity.criticality) : null}
          />
          <DetailField
            label="Confidence"
            value={entity.confidence ? titleFromSnake(entity.confidence) : null}
          />
          <DetailField label="Source" value={entity.source_type} />
          <DetailField label="External Reference" value={entity.external_ref} />
          <DetailField
            label="Created"
            value={new Date(entity.created_at).toLocaleDateString()}
          />
          <DetailField
            label="Updated"
            value={new Date(entity.updated_at).toLocaleDateString()}
          />
        </dl>
      </div>

      {/* Data store attributes */}
      {isDataStore && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#f1f5f9" }}>
            Data Store Attributes
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <DetailField
              label="Data Classification"
              value={
                entity.data_classification ? titleFromSnake(entity.data_classification) : null
              }
            />
            <DetailField label="Residency Region" value={entity.residency_region ?? null} />
            <DetailField label="Retention Policy" value={entity.retention_policy ?? null} />
            <DetailField
              label="Encrypted at Rest"
              value={
                entity.encryption_at_rest === true
                  ? "Yes"
                  : entity.encryption_at_rest === false
                  ? "No"
                  : null
              }
            />
          </dl>
        </div>
      )}

      {/* Relationships */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
            Relationships
            {relationships.length > 0 && (
              <span className="ml-2 text-xs font-normal" style={{ color: "#94a3b8" }}>
                {relationships.length}
                {relationships.length === 50 ? "+" : ""}
              </span>
            )}
          </h2>
        </div>
        {relationships.length === 0 ? (
          <p className="text-xs mb-4" style={{ color: "#64748b" }}>
            No relationships yet.
          </p>
        ) : (
          <ul className="space-y-2 mb-4">
            {relationships.map((rel) => (
              <RelationshipRow key={rel.id} rel={rel} selfId={entity.id} nameMap={nameMap} />
            ))}
          </ul>
        )}
        <AddRelationshipForm
          entityId={entity.id}
          entityName={entity.name}
          candidates={candidates}
        />
      </div>

      {/* Danger zone */}
      <div className="flex justify-end">
        <DeleteEntityButton entityId={entity.id} entityName={entity.name} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/enterprise-context"
      className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
      style={{ color: "#94a3b8" }}
    >
      ← Enterprise Context
    </Link>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-sm" style={{ color: value ? "#cbd5e1" : "#475569" }}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function NodeRef({
  nodeType,
  nodeId,
  selfId,
  nameMap,
}: {
  nodeType: string;
  nodeId: string;
  selfId: string;
  nameMap: Map<string, string>;
}) {
  if (nodeType === "enterprise_entity" && nodeId === selfId) {
    return <span style={{ color: "#f1f5f9" }}>this entity</span>;
  }
  const label = `${nodeTypeLabel(nodeType)} · ${nodeDisplayName(nameMap, nodeType, nodeId)}`;
  if (nodeType === "enterprise_entity") {
    return (
      <Link
        href={`/enterprise-context/entities/${nodeId}`}
        className="underline hover:opacity-80"
        style={{ color: "#93c5fd" }}
      >
        {label}
      </Link>
    );
  }
  if (nodeType === "vendor") {
    return (
      <Link href={`/vendors/${nodeId}`} className="underline hover:opacity-80" style={{ color: "#93c5fd" }}>
        {label}
      </Link>
    );
  }
  if (nodeType === "ai_system") {
    return (
      <Link href={`/ai-systems/${nodeId}`} className="underline hover:opacity-80" style={{ color: "#93c5fd" }}>
        {label}
      </Link>
    );
  }
  return <span style={{ color: "#cbd5e1" }}>{label}</span>;
}

function RelationshipRow({
  rel,
  selfId,
  nameMap,
}: {
  rel: EnterpriseRelationship;
  selfId: string;
  nameMap: Map<string, string>;
}) {
  return (
    <li
      className="rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap"
      style={{ borderColor: "#1e2d45" }}
    >
      <NodeRef nodeType={rel.from_type} nodeId={rel.from_id} selfId={selfId} nameMap={nameMap} />
      <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>
        {relationshipTypeLabel(rel.relationship_type)}
      </span>
      <NodeRef nodeType={rel.to_type} nodeId={rel.to_id} selfId={selfId} nameMap={nameMap} />
      <DeleteRelationshipButton relationshipId={rel.id} />
      {rel.note && (
        <span className="text-xs w-full mt-1" style={{ color: "#64748b" }}>
          {rel.note}
        </span>
      )}
    </li>
  );
}
