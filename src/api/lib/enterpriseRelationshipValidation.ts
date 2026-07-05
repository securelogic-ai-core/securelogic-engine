/**
 * enterpriseRelationshipValidation.ts — Pure validation for enterprise_relationships
 * create input. No I/O. Mirrors enterpriseEntityValidation.ts.
 *
 * Tenant rule: organization_id is NEVER from the body. Both endpoints' same-org
 * membership is verified at the route layer with a two-endpoint pre-flight before
 * persistence — this lib only validates SHAPE (node types, uuids, relationship type,
 * no self-edge).
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 500;

/**
 * Node types an edge endpoint may reference AT THE ROUTE LAYER. Must match the
 * DB CHECK (20260801_enterprise_relationships_asset_expansion.sql). 'asset' —
 * Tier-0 registry endpoints (EAR-AD-4) — went live in registry Phase 1
 * (20260803 ships the `assets` table the two-endpoint same-org pre-flight
 * dispatches to); no edge-table migration was needed, exactly as planned.
 */
export const NODE_TYPES = ["enterprise_entity", "vendor", "ai_system", "user", "asset"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Relationship types. Must match the migration CHECK. The second group is the
 * EAR-AD-4 infrastructure vocabulary (asset registry graph substrate expansion). */
export const RELATIONSHIP_TYPES = [
  "depends_on",
  "runs_on",
  "owned_by",
  "part_of",
  "serves",
  "processes_data_in",
  "hosted_on",
  "connects_to",
  "stores_data_in",
  "authenticates_via",
  "exposed_via",
  "managed_by"
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type EnterpriseRelationshipCreateInput = {
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relationship_type: RelationshipType;
  note: string | null;
};

export type CreateResult =
  | { input: EnterpriseRelationshipCreateInput }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

export function isNodeType(v: unknown): v is NodeType {
  return typeof v === "string" && (NODE_TYPES as readonly string[]).includes(v);
}

export function isRelationshipType(v: unknown): v is RelationshipType {
  return typeof v === "string" && (RELATIONSHIP_TYPES as readonly string[]).includes(v);
}

/**
 * Validate the body of POST /api/enterprise-relationships.
 * from_type/from_id/to_type/to_id/relationship_type are required. Self-edges
 * (same type AND same id) are rejected — the DB also enforces this.
 */
export function validateEnterpriseRelationshipCreate(body: unknown): CreateResult {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };

  if (!isNodeType(body.from_type)) {
    return { error: "from_type_invalid", detail: `from_type must be one of: ${NODE_TYPES.join(", ")}` };
  }
  if (!isNodeType(body.to_type)) {
    return { error: "to_type_invalid", detail: `to_type must be one of: ${NODE_TYPES.join(", ")}` };
  }
  if (!isUuid(body.from_id)) return { error: "from_id_invalid" };
  if (!isUuid(body.to_id)) return { error: "to_id_invalid" };
  if (!isRelationshipType(body.relationship_type)) {
    return {
      error: "relationship_type_invalid",
      detail: `relationship_type must be one of: ${RELATIONSHIP_TYPES.join(", ")}`
    };
  }

  const from_id = (body.from_id as string).trim();
  const to_id = (body.to_id as string).trim();
  if (body.from_type === body.to_type && from_id.toLowerCase() === to_id.toLowerCase()) {
    return { error: "self_edge_not_allowed" };
  }

  let note: string | null = null;
  if (body.note !== null && body.note !== undefined) {
    if (typeof body.note !== "string") return { error: "note_must_be_string" };
    const raw = body.note.trim();
    if (raw.length > MAX_NOTE) {
      return { error: "note_too_long", detail: `note must be ${MAX_NOTE} characters or fewer` };
    }
    note = raw.length === 0 ? null : sanitizeString(raw, MAX_NOTE);
  }

  return {
    input: {
      from_type: body.from_type,
      from_id,
      to_type: body.to_type,
      to_id,
      relationship_type: body.relationship_type,
      note
    }
  };
}

/** Map a node_type to the table whose (id, organization_id) proves same-org membership. */
export const NODE_TYPE_TABLE: Record<NodeType, string> = {
  enterprise_entity: "enterprise_entities",
  vendor: "vendors",
  ai_system: "ai_systems",
  user: "users",
  asset: "assets"
};
