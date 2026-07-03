/**
 * types.ts — Contract types for the Intelligent Applicability Engine (IAE), v1.
 *
 * These are the pure, I/O-free input/output shapes of the reasoning core
 * (`ApplicabilityEngineV1`). They deliberately carry NO `organization_id` and NO
 * DB handles: the engine cannot query, therefore it cannot leak across tenants.
 * Tenant scoping is the CALLER's responsibility — a later slice (S4b) invokes the
 * engine inside `withTenant(orgId, …)` with matcher output and a graph
 * neighborhood that were BOTH already org-scoped at the source (the matcher and
 * `enterpriseGraphResolver`).
 *
 * Design authority: ENTERPRISE_CONTEXT_ARCHITECTURE.md §6 (AD-5/AD-6), §7
 * (AD-7-revised/AD-16). The decision enum + confidence + ordered `reasoning_steps`
 * + normalized `affected_entities` blast radius are the substrate a later slice
 * persists (WORM, by-value, hash-chained). Persisting them is NOT this slice.
 */

import type {
  GraphNeighborhood,
  GraphNode,
  GraphEdge
} from "../../../api/lib/enterpriseGraphResolver.js";

// Re-export the graph types so downstream engine consumers depend on the engine
// surface, not reach across into an api/lib module. Type-only — compile-erased.
export type { GraphNeighborhood, GraphNode, GraphEdge };

/**
 * The five applicability decisions (AD-5). Ordered here from strongest-positive
 * to strongest-uncertain; `unknown` is the fail-safe for inputs that cannot be
 * reasoned over (the engine never throws).
 */
export const APPLICABILITY_DECISIONS = [
  "affected",
  "potentially_affected",
  "not_affected",
  "needs_review",
  "unknown"
] as const;
export type ApplicabilityDecision = (typeof APPLICABILITY_DECISIONS)[number];

export const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/**
 * The matcher's per-candidate output, mirrored from `signal_match_suggestions`
 * (see signalMatchSuggestionValidation.ts). `match_score` is the INTEGER 0–100
 * the matcher writes (NULL when it does not score). This is a by-value copy — the
 * engine reads it, never fetches it.
 */
export const MATCH_TARGET_TYPES = [
  "vendor",
  "ai_system",
  "control",
  "obligation"
] as const;
export type MatchTargetType = (typeof MATCH_TARGET_TYPES)[number];

export interface MatcherCandidate {
  target_type: MatchTargetType;
  target_id: string;
  /** INTEGER 0–100, or null when the matcher did not score. */
  match_score: number | null;
  /** Short code, e.g. 'vendor_name_ilike', 'cve_match'. May be null. */
  match_reason: string | null;
}

/**
 * Input to a single applicability assessment. `neighborhood` is OPTIONAL: when
 * absent (graph not resolved, or empty org), the engine reasons on match signals
 * alone and cannot conclude reachability-backed `affected`.
 */
export interface ApplicabilityInput {
  /** Opaque; echoed into the trace for provenance. Never used for I/O. */
  signalId: string;
  candidates: MatcherCandidate[];
  neighborhood?: GraphNeighborhood;
}

/**
 * One deterministic rule-trace entry. Ordered, by value — this IS the
 * explainability substrate (AD-7-revised). A later slice hash-chains it (AD-16).
 */
export interface ReasoningStep {
  /** Stable rule identifier from the corpus, e.g. 'R1_strong_match_reachable'. */
  rule_id: string;
  /** The concrete inputs this rule weighed (by value, human-readable). */
  inputs_considered: string;
  /** What the rule concluded / contributed. */
  outcome: string;
}

/**
 * One normalized blast-radius entry: an enterprise entity reachable from a
 * matched target within the passed-in neighborhood. Projected in-memory from
 * `neighborhood.edges` — the engine does NOT re-walk the graph (AD-13 keeps the
 * resolver the single traversal authority).
 */
export interface AffectedEntity {
  node_type: string;
  node_id: string;
  /** Shortest hop count from a matched target node within the neighborhood. */
  min_depth: number;
  /** The matched target node this entity is reachable from. */
  via_target_type: MatchTargetType;
  via_target_id: string;
}

export interface ApplicabilityResult {
  decision: ApplicabilityDecision;
  /** Deterministic 0–100. For `not_affected`, confidence IN the non-applicability. */
  confidence: number;
  confidence_band: ConfidenceBand;
  reasoning_steps: ReasoningStep[];
  affected_entities: AffectedEntity[];
  /** Pins the corpus version that produced this decision (AD-7-support). */
  engine_version: string;
  schema_version: string;
}
