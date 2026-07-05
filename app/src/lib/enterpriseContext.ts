/**
 * enterpriseContext.ts — pure, I/O-free types + helpers for the Enterprise Context
 * Layer (ECL) Tier-1 UI (goal Item 7, Phase 7A.1).
 *
 * This module deliberately contains NO fetch/network code so its logic is unit-testable
 * without mocking the network (matching the app's pure-function test convention). The
 * fetch wrappers that consume these helpers live in `api.ts` (which owns the private
 * `engineFetch`/`readError`) and the mutation proxies live under
 * `app/src/app/api/enterprise-context/**`.
 *
 * Every vocabulary/bound here mirrors the engine contracts on `develop`:
 *  - entities:      src/api/lib/enterpriseEntityValidation.ts
 *  - relationships: src/api/lib/enterpriseRelationshipValidation.ts
 *  - graph:         src/engine/... enterpriseGraphResolver.ts (MAX_DEPTH 5, default 3)
 *  - import:        src/api/routes/enterpriseContextImport.ts
 *
 * The whole ECL surface is dark: every engine route returns 404 when
 * SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED is off, and 403 { error: "capability_required" }
 * when the org lacks the `enterprise_context` capability. The UI infers both from the
 * response — see `isFeatureDisabledStatus` and `enterpriseContextErrorMessage`.
 */

// ─── Vocabularies (mirror the engine validators) ───────────────────────────────

export const ENTITY_TYPES = [
  "asset",
  "application",
  "business_service",
  "business_unit",
  "department",
  "data_store",
  "data_classification",
  "identity",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = ["active", "archived", "retired"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const CRITICALITIES = ["critical", "high", "medium", "low"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const CONFIDENCES = ["high", "medium", "low", "unverified"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const NODE_TYPES = ["enterprise_entity", "vendor", "ai_system", "user"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  "depends_on",
  "runs_on",
  "owned_by",
  "part_of",
  "serves",
  "processes_data_in",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Entity types the CSV/XLSX importer accepts (subset of ENTITY_TYPES + vendor/ai_system). */
export const IMPORT_ENTITY_TYPES = [
  "asset",
  "application",
  "data_store",
  "vendor",
  "ai_system",
] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

// ─── Applicability decisions (mirror src/engine/applicability/v1/types.ts) ─────

export const APPLICABILITY_DECISIONS = [
  "affected",
  "potentially_affected",
  "not_affected",
  "needs_review",
  "unknown",
] as const;
export type ApplicabilityDecision = (typeof APPLICABILITY_DECISIONS)[number];

export const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/** Applicability target types (mirror MATCH_TARGET_TYPES on the engine). */
export const MATCH_TARGET_TYPES = ["vendor", "ai_system", "control", "obligation"] as const;
export type MatchTargetType = (typeof MATCH_TARGET_TYPES)[number];

// ─── Pagination / depth bounds (mirror the engine) ─────────────────────────────

export const ENTITY_PAGE = { defaultLimit: 25, maxLimit: 100, maxOffset: 100_000 } as const;
export const RELATIONSHIP_PAGE = { defaultLimit: 50, maxLimit: 200, maxOffset: 100_000 } as const;
export const GRAPH_DEPTH = { min: 1, default: 3, max: 5 } as const;
export const APPLICABILITY_PAGE = { defaultLimit: 25, maxLimit: 100, maxOffset: 100_000 } as const;

// ─── Row shapes (mirror the engine response JSON) ──────────────────────────────

export interface DataStoreAttributes {
  data_classification: DataClassification | null;
  residency_region: string | null;
  retention_policy: string | null;
  encryption_at_rest: boolean | null;
}

export interface EnterpriseEntity {
  id: string;
  organization_id: string;
  entity_type: EntityType;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  status: EntityStatus;
  criticality: Criticality | null;
  confidence: Confidence | null;
  source_type: string | null;
  source_id: string | null;
  provenance: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
  // present on GET/:id and on data_store rows (LEFT JOIN); absent otherwise
  data_classification?: DataClassification | null;
  residency_region?: string | null;
  retention_policy?: string | null;
  encryption_at_rest?: boolean | null;
}

export interface EnterpriseRelationship {
  id: string;
  organization_id: string;
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relationship_type: RelationshipType;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export interface GraphNode {
  node_type: NodeType;
  node_id: string;
  depth: number;
}

export interface GraphEdge {
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relationship_type: string;
  source: string;
}

export interface GraphNeighborhood {
  root: { node_type: NodeType; node_id: string };
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Applicability read-route shapes (mirror routes/applicabilityAssessments.ts) ─

export interface ApplicabilityAssessmentRow {
  id: string;
  organization_id: string;
  signal_id: string;
  target_type: MatchTargetType;
  target_id: string;
  decision: ApplicabilityDecision;
  confidence: number;
  confidence_band: ConfidenceBand;
  engine_version: string;
  schema_version: string;
  content_hash: string;
  prev_hash: string;
  created_at: string;
  /** LIST only: blast-radius size for the row. */
  affected_count?: number;
}

export interface ApplicabilityReasoningStep {
  rule_id: string;
  inputs_considered: string;
  outcome: string;
}

export interface ApplicabilityAffectedEntity {
  node_type: string;
  node_id: string;
  min_depth: number;
  via_target_type: MatchTargetType;
  via_target_id: string;
}

export interface ApplicabilityEvidenceItem {
  evidence_type: string;
  ref_table: string;
  ref_id: string | null;
  captured_value: string;
  weight: number | null;
}

export interface ApplicabilityAssessmentDetail extends ApplicabilityAssessmentRow {
  reasoning_steps: ApplicabilityReasoningStep[];
  affected_entities: ApplicabilityAffectedEntity[];
  evidence: ApplicabilityEvidenceItem[];
}

/** The S5 explainability rendering the GET-one route returns alongside the record. */
export interface ApplicabilityExplanation {
  headline: string;
  decision_statement: string;
  reasoning_chain: string[];
  evidence_used: Array<{ category: string; count: number; types: string[] }>;
  evidence_missing: string[];
  blast_radius: Array<{ node_type: string; count: number; min_depth: number }>;
  affected_count: number;
  reproducibility: {
    engine_version: string;
    schema_version: string;
    content_hash: string;
    prev_hash: string;
    reproduces: boolean;
  };
}

/** A single row of the import dry-run/commit plan (engine `planImport` output). */
export interface ImportRow {
  status: string;
  normalized?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ImportPlan {
  mode: "preview" | "commit";
  truncated: boolean;
  committed?: number;
  rows: ImportRow[];
  summary: Record<string, number> & { ok?: number };
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * The engine returns 404 for BOTH "flag off" and "route absent" — indistinguishable by
 * design (no enumeration). The UI treats 404 as "feature does not exist for me" → hide.
 * A 403 (capability_required) is NOT disabled — the org exists but isn't granted, so the
 * UI shows an entitlement affordance instead of hiding.
 */
export function isFeatureDisabledStatus(status: number): boolean {
  return status === 404;
}

/** Clamp a requested limit into the engine's accepted range (defensive; engine re-validates). */
export function clampLimit(
  requested: number | undefined,
  bounds: { defaultLimit: number; maxLimit: number },
): number {
  if (requested === undefined || !Number.isFinite(requested)) return bounds.defaultLimit;
  const n = Math.floor(requested);
  if (n < 1) return 1;
  if (n > bounds.maxLimit) return bounds.maxLimit;
  return n;
}

/** Clamp a requested offset into [0, maxOffset]. */
export function clampOffset(requested: number | undefined, maxOffset: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return 0;
  const n = Math.floor(requested);
  if (n < 0) return 0;
  if (n > maxOffset) return maxOffset;
  return n;
}

/** Clamp a requested graph depth into [min, max]; undefined → default. */
export function clampDepth(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return GRAPH_DEPTH.default;
  const n = Math.floor(requested);
  if (n < GRAPH_DEPTH.min) return GRAPH_DEPTH.min;
  if (n > GRAPH_DEPTH.max) return GRAPH_DEPTH.max;
  return n;
}

/** Build the query string for GET /api/enterprise-entities (already-clamped values). */
export function entitiesQuery(params: {
  entity_type?: EntityType;
  limit?: number;
  offset?: number;
}): string {
  const q = new URLSearchParams();
  if (params.entity_type) q.set("entity_type", params.entity_type);
  q.set("limit", String(clampLimit(params.limit, ENTITY_PAGE)));
  q.set("offset", String(clampOffset(params.offset, ENTITY_PAGE.maxOffset)));
  return q.toString();
}

/** Build the query string for GET /api/enterprise-relationships. */
export function relationshipsQuery(params: {
  node_type?: NodeType;
  node_id?: string;
  limit?: number;
  offset?: number;
}): string {
  const q = new URLSearchParams();
  // node_type + node_id must travel together or not at all (engine returns 400 otherwise)
  if (params.node_type && params.node_id) {
    q.set("node_type", params.node_type);
    q.set("node_id", params.node_id);
  }
  q.set("limit", String(clampLimit(params.limit, RELATIONSHIP_PAGE)));
  q.set("offset", String(clampOffset(params.offset, RELATIONSHIP_PAGE.maxOffset)));
  return q.toString();
}

/** Build the query string for GET /api/enterprise-graph. */
export function graphQuery(params: {
  node_type: NodeType;
  node_id: string;
  depth?: number;
}): string {
  const q = new URLSearchParams();
  q.set("node_type", params.node_type);
  q.set("node_id", params.node_id);
  q.set("depth", String(clampDepth(params.depth)));
  return q.toString();
}

/** Build the query string for GET /api/applicability-assessments. */
export function applicabilityQuery(params: {
  decision?: ApplicabilityDecision;
  target_type?: MatchTargetType;
  signal_id?: string;
  limit?: number;
  offset?: number;
}): string {
  const q = new URLSearchParams();
  if (params.decision) q.set("decision", params.decision);
  if (params.target_type) q.set("target_type", params.target_type);
  if (params.signal_id) q.set("signal_id", params.signal_id);
  q.set("limit", String(clampLimit(params.limit, APPLICABILITY_PAGE)));
  q.set("offset", String(clampOffset(params.offset, APPLICABILITY_PAGE.maxOffset)));
  return q.toString();
}

/** Build the query string for POST /api/enterprise-context/import. */
export function importQuery(entity_type: ImportEntityType, mode: "preview" | "commit"): string {
  const q = new URLSearchParams();
  q.set("entity_type", entity_type);
  q.set("mode", mode);
  return q.toString();
}

/**
 * Human-readable message for an engine error code. Keep this the single source of truth so
 * every ECL screen shows consistent copy. Unknown codes fall back to a generic message
 * (never leak a raw code to the user).
 */
const ERROR_MESSAGES: Record<string, string> = {
  // capability / gating
  capability_required: "Enterprise Context isn't enabled for your organization.",
  organization_context_missing: "Your session is missing organization context. Sign in again.",
  not_authenticated: "You're not signed in.",
  // entities
  enterprise_entity_limit_reached: "Entity limit reached for your organization. Contact your administrator to raise the cap.",
  enterprise_entity_name_already_exists: "An entity with that name already exists.",
  owner_user_id_not_in_org: "That owner isn't a member of your organization.",
  entity_type_immutable: "An entity's type can't be changed after it's created.",
  // relationships
  enterprise_edge_limit_reached: "Relationship limit reached for your organization. Contact your administrator to raise the cap.",
  enterprise_relationship_already_exists: "That relationship already exists.",
  from_node_not_in_org: "The source of that relationship isn't in your organization.",
  to_node_not_in_org: "The target of that relationship isn't in your organization.",
  self_edge_not_allowed: "An entity can't have a relationship to itself.",
  invalid_node_filter: "That relationship filter is invalid.",
  // validation / lookup
  invalid_pagination: "Invalid pagination request.",
  invalid_id: "That identifier is invalid.",
  invalid_node: "That node reference is invalid.",
  invalid_depth: "That graph depth is invalid.",
  depth_out_of_range: "Graph depth must be between 1 and 5.",
  not_found: "Not found.",
  // import
  invalid_entity_type: "That import type isn't supported.",
  invalid_mode: "Invalid import mode.",
  no_file_uploaded: "No file was uploaded.",
  // transport
  network_error: "Couldn't reach the server. Try again.",
  engine_unavailable: "The service is temporarily unavailable. Try again.",
  invalid_json: "The server returned an unexpected response.",
};

export function enterpriseContextErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";
}
