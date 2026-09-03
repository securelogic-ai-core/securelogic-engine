/**
 * assessmentTier.ts — the ASSESSMENT TIER as a joint function of criticality,
 * inherent risk and customer policy (Onboarding 2.0, owner-frozen 2026-09-03).
 *
 * PURE. Supersedes `tierForBand(inherent-only)` in riskBands.ts, which is
 * RETAINED for reproducing engagements stamped under methodology 1.0.0 and must
 * not be edited.
 *
 * ── The matrix ──────────────────────────────────────────────────────────────
 *
 * Rows = criticality band, columns = inherent-risk band. Neither axis alone
 * decides; only when BOTH are elevated does tier_1 open. The corners are
 * deliberate: a business-critical vendor holding no sensitive data still earns
 * tier_2 (resilience assurance); a low-criticality vendor holding restricted
 * data with deep access still earns tier_2 (data-protection assurance).
 *
 * (Moderate, High) = tier_2 by owner amendment: high inherent exposure
 * requires deeper assurance even where business dependency is only moderate.
 *
 * MONOTONIC in both axes — asserted by test across all 16 cells. Increasing
 * criticality never lowers assurance; increasing inherent risk never does.
 *
 * ── Relocated floors (M2) ───────────────────────────────────────────────────
 *
 * E1b and E4 read an operational-dependency fact that the v2 inherent engine
 * no longer scores. They express "this combination demands deep assurance",
 * which is tier semantics, so they live here. Both read RAW FACTS — never a
 * derived criticality band — so the peer relationship holds and nothing is
 * counted twice.
 *
 * ── Customer policy (M4) ────────────────────────────────────────────────────
 *
 * Policy may RAISE the tier. It may NEVER lower SecureLogic's calculated
 * minimum. Implemented as a floor: the deterministic tier is the minimum, the
 * policy tier is honoured only when it is deeper.
 */

import { type RiskBand, ASSESSMENT_TIERS, type AssessmentTier } from "./riskBands.js";
import { TIER_METHODOLOGY_VERSION, type MethodologyAdjustment } from "./methodologyVersion.js";
import type { CriticalityDependency, CriticalityConcentration } from "./criticality.js";
import type { DataSensitivity, AccessLevel } from "./inherentRisk.js";

/** Depth rank: higher = deeper assurance. */
const TIER_RANK: Record<AssessmentTier, number> = {
  tier_4_low: 0,
  tier_3_moderate: 1,
  tier_2_high: 2,
  tier_1_critical: 3,
};

export function deeperTier(a: AssessmentTier, b: AssessmentTier): AssessmentTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export function tierExceeds(a: AssessmentTier, b: AssessmentTier): boolean {
  return TIER_RANK[a] > TIER_RANK[b];
}

/** The owner-approved matrix. Indexed [criticality][inherent]. */
export const TIER_MATRIX: Record<RiskBand, Record<RiskBand, AssessmentTier>> = {
  Critical: { Low: "tier_2_high", Moderate: "tier_2_high", High: "tier_1_critical", Critical: "tier_1_critical" },
  High: { Low: "tier_3_moderate", Moderate: "tier_3_moderate", High: "tier_2_high", Critical: "tier_1_critical" },
  Moderate: { Low: "tier_4_low", Moderate: "tier_3_moderate", High: "tier_2_high", Critical: "tier_2_high" },
  Low: { Low: "tier_4_low", Moderate: "tier_4_low", High: "tier_3_moderate", Critical: "tier_2_high" },
};

/** The raw facts the relocated floors read. Never a derived band. */
export type TierFloorFacts = {
  data_sensitivity: DataSensitivity;
  access_level: AccessLevel;
  operational_dependency: CriticalityDependency;
  concentration: CriticalityConcentration;
};

type TierRule = { rule_id: string; floor: AssessmentTier; applies: (f: TierFloorFacts) => boolean; explanation: string };

export const TIER_ESCALATION_RULES: TierRule[] = [
  {
    rule_id: "E1b",
    floor: "tier_1_critical",
    applies: (f) =>
      f.data_sensitivity === "restricted" &&
      (f.access_level === "admin" || f.access_level === "network_access") &&
      f.operational_dependency === "essential",
    explanation:
      "Restricted data, administrative or network access, and an essential operational dependency " +
      "together demand the deepest assurance regardless of the arithmetic.",
  },
  {
    rule_id: "E4",
    floor: "tier_2_high",
    applies: (f) => f.concentration === "single_point_of_failure" && f.operational_dependency === "essential",
    explanation:
      "Single point of failure for an essential dependency — there is no second supplier and no " +
      "ability to operate without this one.",
  },
];

export type AssessmentTierInput = {
  criticality_band: RiskBand;
  inherent_band: RiskBand;
  facts: TierFloorFacts;
  /**
   * The customer's policy minimum for this relationship, if any. Honoured only
   * when DEEPER than the calculated tier (M4: raise-only).
   */
  policy_minimum_tier?: AssessmentTier | null;
};

export type AssessmentTierResult = {
  /** Authoritative tier after floors and policy. */
  tier: AssessmentTier;
  /** What the matrix alone said. Kept for provenance. */
  matrix_tier: AssessmentTier;
  /** After named floors, before policy. This is SecureLogic's calculated minimum. */
  calculated_minimum_tier: AssessmentTier;
  basis: {
    method: "vendor_assessment_tier_v1";
    version: 1;
    methodology_version: string;
    criticality_band: RiskBand;
    inherent_band: RiskBand;
    adjustments: MethodologyAdjustment[];
    /** Present only when policy changed the outcome. */
    policy?: { requested: AssessmentTier; applied: boolean; reason: string };
  };
};

export function resolveAssessmentTier(input: AssessmentTierInput): AssessmentTierResult {
  const matrixTier = TIER_MATRIX[input.criticality_band][input.inherent_band];
  const adjustments: MethodologyAdjustment[] = [];
  let tier = matrixTier;

  for (const rule of TIER_ESCALATION_RULES) {
    if (!rule.applies(input.facts)) continue;
    const before = tier;
    tier = deeperTier(tier, rule.floor);
    adjustments.push({
      rule_id: rule.rule_id,
      explanation:
        tier === before
          ? `${rule.explanation} (Already at or above the ${rule.floor} floor this rule sets.)`
          : `${rule.explanation} Raised from ${before} to ${tier}.`,
    });
  }
  const calculatedMinimum = tier;

  let policy: AssessmentTierResult["basis"]["policy"];
  const requested = input.policy_minimum_tier ?? null;
  if (requested) {
    if (tierExceeds(requested, calculatedMinimum)) {
      tier = requested;
      policy = { requested, applied: true, reason: "Customer policy raised the tier above the calculated minimum." };
      adjustments.push({ rule_id: "POLICY_RAISE", explanation: `Customer policy raised the tier from ${calculatedMinimum} to ${requested}.` });
    } else {
      // M4: never lower. Recorded so the customer can see the request was
      // honoured as far as the methodology allows, and no further.
      policy = {
        requested,
        applied: false,
        reason: "Customer policy may raise the tier but never lower SecureLogic's calculated minimum.",
      };
    }
  }

  return {
    tier,
    matrix_tier: matrixTier,
    calculated_minimum_tier: calculatedMinimum,
    basis: {
      method: "vendor_assessment_tier_v1",
      version: 1,
      methodology_version: TIER_METHODOLOGY_VERSION,
      criticality_band: input.criticality_band,
      inherent_band: input.inherent_band,
      adjustments,
      ...(policy ? { policy } : {}),
    },
  };
}

/** Exported for the monotonicity test and for surfaces that render the matrix. */
export const TIER_RANKS = TIER_RANK;
export { ASSESSMENT_TIERS };
