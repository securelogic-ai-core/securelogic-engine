/**
 * applicabilityPolicy.ts — The versioned, unit-tested rule corpus for the IAE v1.
 *
 * Mirrors src/engine/policy/defaultScoringPolicy.ts: rules are expressed as TYPED
 * DATA (thresholds, bands, weights), never as inline literals scattered through the
 * engine. `engine_version` + `schema_version` pin the exact corpus that produced a
 * decision (AD-7-support). Governance without over-engineering: the golden-case
 * suite in git is the change-audit — any edit here that moves a golden output MUST
 * ship with the updated expected fixture AND a version bump, reviewed in the PR diff.
 * No DB-backed rule table, no dynamic loading — that arrives (if ever) with the
 * persistence slice.
 */

export interface ApplicabilityPolicy {
  /**
   * Pins the reasoning corpus. Bump `engine_version` on ANY change that can move a
   * decision/confidence; bump `schema_version` only when the RESULT SHAPE changes.
   */
  engine_version: string;
  schema_version: string;

  /** match_score cutoffs (INTEGER 0–100). A candidate at/above HIGH is a strong match. */
  matchThresholds: {
    /** At/above this, a scored candidate is "strong". */
    high: number;
    /** At/above this (and below high), a scored candidate is "moderate". */
    moderate: number;
    /** Below this, a scored candidate is treated as noise (does not raise applicability). */
    floor: number;
  };

  /** Confidence-band cutoffs over the 0–100 confidence value (mirrors severityBands). */
  confidenceBands: {
    /** confidence >= high -> "high". */
    high: number;
    /** confidence >= medium (and < high) -> "medium"; below -> "low". */
    medium: number;
  };

  /** Base confidence assigned per decision before reachability adjustment. */
  baseConfidence: {
    affected: number;
    potentially_affected: number;
    not_affected: number;
    needs_review: number;
  };

  /**
   * Reachability boost: each distinct affected entity in the blast radius adds a
   * log-damped boost (like the scoring engine's accumulationBoost) so a huge blast
   * radius does not pathologically saturate confidence.
   */
  reachability: {
    perEntityBoost: number;
    maxBoost: number;
  };
}

export const DEFAULT_APPLICABILITY_POLICY: ApplicabilityPolicy = {
  engine_version: "iae-v1.0.0",
  schema_version: "applicability-result.v1",

  matchThresholds: {
    high: 70,
    moderate: 40,
    floor: 20
  },

  confidenceBands: {
    high: 75,
    medium: 50
  },

  baseConfidence: {
    affected: 80,
    potentially_affected: 55,
    not_affected: 80,
    needs_review: 50
  },

  reachability: {
    perEntityBoost: 6,
    maxBoost: 18
  }
};
