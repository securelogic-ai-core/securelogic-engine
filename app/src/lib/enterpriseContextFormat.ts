/**
 * enterpriseContextFormat.ts — pure, I/O-free display helpers for the ECL Tier-1
 * screens (goal Item 7, Phase 7A.2). Same convention as enterpriseContext.ts:
 * no fetch, no React — everything here is unit-testable without mocks.
 */

import {
  enterpriseContextErrorMessage,
  type EntityType,
  type NodeType,
} from "./enterpriseContext";

/** "business_unit" → "Business Unit" (fallback for vocab values without a custom label). */
export function titleFromSnake(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ENTITY_TYPE_LABELS: Partial<Record<EntityType, string>> = {
  asset: "Asset",
  application: "Application",
  business_service: "Business Service",
  business_unit: "Business Unit",
  department: "Department",
  data_store: "Data Store",
  data_classification: "Data Classification",
  identity: "Identity",
};

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type as EntityType] ?? titleFromSnake(type);
}

const NODE_TYPE_LABELS: Partial<Record<NodeType, string>> = {
  enterprise_entity: "Entity",
  vendor: "Vendor",
  ai_system: "AI System",
  user: "User",
};

export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type as NodeType] ?? titleFromSnake(type);
}

/** "depends_on" → "depends on" (edge labels read as prose between two node names). */
export function relationshipTypeLabel(type: string): string {
  return type.split("_").filter(Boolean).join(" ");
}

/**
 * Offset pagination links for a list page. The engine returns no total count, so
 * "next" exists only when the current page came back full (a full page may still be
 * the last one — the next page then renders empty, which is acceptable for v1).
 */
export function pageNav(
  offset: number,
  limit: number,
  receivedCount: number,
): { prevOffset: number | null; nextOffset: number | null } {
  const prevOffset = offset > 0 ? Math.max(0, offset - limit) : null;
  const nextOffset = receivedCount >= limit ? offset + limit : null;
  return { prevOffset, nextOffset };
}

// ─── Applicability display helpers (R5) ─────────────────────────────────────────

const DECISION_LABELS: Record<string, string> = {
  affected: "Affected",
  potentially_affected: "Potentially Affected",
  not_affected: "Not Affected",
  needs_review: "Needs Review",
  unknown: "Unknown",
};

export function decisionLabel(decision: string): string {
  return DECISION_LABELS[decision] ?? titleFromSnake(decision);
}

/** "vendor" → "Vendor", "ai_system" → "AI System" — applicability target labels. */
export function matchTargetLabel(type: string): string {
  if (type === "ai_system") return "AI System";
  return titleFromSnake(type);
}

/** First 12 hex chars of a chain hash for compact display ("" stays ""). */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

/** "graph_reachability" → "Graph Reachability" etc. for evidence categories. */
export function evidenceCategoryLabel(category: string): string {
  return titleFromSnake(category);
}

export type ReadFailureKind = "disabled" | "capability" | "error";

/**
 * Classify a failed ReadResult for rendering. 404 (disabled=true) means the feature
 * doesn't exist for this org → hide the surface entirely. capability_required means
 * the org exists but isn't granted → show the entitlement affordance. Everything
 * else is a plain error with the shared human copy.
 */
export function readFailure(result: { disabled: boolean; error: string }): {
  kind: ReadFailureKind;
  message: string;
} {
  if (result.disabled) {
    return {
      kind: "disabled",
      message: "Enterprise Context isn't available for your organization yet.",
    };
  }
  if (result.error === "capability_required") {
    return { kind: "capability", message: enterpriseContextErrorMessage(result.error) };
  }
  return { kind: "error", message: enterpriseContextErrorMessage(result.error) };
}

/** Parse a ?offset= search param into a non-negative integer (bad input → 0). */
export function parseOffsetParam(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
