/**
 * criticality.ts — the deterministic vendor CRITICALITY model (Onboarding 2.0).
 *
 * PURE. No I/O, no DB handle, no LLM, no clock, no randomness. Identical inputs
 * produce byte-identical output, forever — the same contract inherentRisk.ts
 * honours, and for the same reason: the authoritative core of the methodology
 * must be reproducible without a model, and AI must never be the opaque
 * authority deciding a rating.
 *
 * ── What criticality IS, and is not ────────────────────────────────────────
 *
 * Criticality answers ONE question: "How important is this vendor/service to
 * the organization if it becomes unavailable or materially degraded?" It is
 * business dependency and impact — a statement about US, not about the
 * supplier's controls or the data they touch.
 *
 * It is therefore a PEER of inherent risk, not an input to it. Inherent risk
 * measures exposure before controls; criticality measures dependency. The
 * assessment tier is their joint function (assessmentTier.ts). Neither engine
 * consumes the other's OUTPUT — that is the owner-ruled guard against
 * double-counting, and this file has no import from inherentRisk*.ts.
 *
 * EXCLUDED BY RULING, and never to be added here: control effectiveness, SOC
 * reports, evidence quality, data sensitivity, privileged access, AI usage,
 * regulatory exposure. Those are exposure or assurance facts and belong to the
 * other engines.
 *
 * ── Why weighted-additive with named floors ─────────────────────────────────
 *
 * Same reasoning as inherentRisk.ts: additive stays explainable in terms a
 * customer can audit, and the named ESCALATION FLOORS catch the corner a
 * weighted sum washes out — a small vendor that is nonetheless irreplaceable
 * inside a 24-hour tolerance.
 *
 * ── Concentration is a LOW-WEIGHT PEER, deliberately ────────────────────────
 *
 * Concentration correlates with business_reach and substitutability. The owner
 * ruled (M1, M3) that it stays a separately-explainable peer at the smallest
 * weight rather than becoming a multiplier on substitutability: nonlinear
 * scoring would obscure which fact drove the rating. Multiplier treatment is
 * recorded as a possible FUTURE refinement on portfolio evidence — not pending
 * work, and not to be introduced as a patch.
 */

import { clampScore, bandForScore, maxBand, type RiskBand } from "./riskBands.js";
import {
  CRITICALITY_METHODOLOGY_VERSION,
  type MethodologyAdjustment,
  type MethodologyBasis,
} from "./methodologyVersion.js";

// ── Dimensions ──────────────────────────────────────────────────────────────

export const CRITICALITY_DIMENSIONS = [
  "max_tolerable_disruption",
  "operational_dependency",
  "business_reach",
  "substitutability",
  "process_coupling",
  "concentration",
] as const;
export type CriticalityDimension = (typeof CRITICALITY_DIMENSIONS)[number];

/**
 * Fixed weights. MUST sum to exactly 1.0 — asserted by a unit test. Order is
 * by weight; the rationale for each is in the design record.
 */
export const CRITICALITY_WEIGHTS: Record<CriticalityDimension, number> = {
  max_tolerable_disruption: 0.26, // time-to-harm is the sharpest BIA signal
  operational_dependency: 0.22, // breadth of day-to-day reliance
  business_reach: 0.18, // blast radius
  substitutability: 0.15, // a replaceable supplier is a smaller dependency
  process_coupling: 0.11, // structural embedding
  concentration: 0.08, // low-weight peer — see header
};

// ── Level tables ────────────────────────────────────────────────────────────
//
// Each dimension has FOUR named levels scoring 10 / 40 / 70 / 100. Named, not
// numeric, so the stored basis records what was actually declared.

const L4 = 10;
const L3 = 40;
const L2 = 70;
const L1 = 100;

/** C2. How long could the business operate acceptably without it? */
export const MTD_LEVELS = ["gt_1_month", "1_week_to_1_month", "1_to_7_days", "lt_24_hours"] as const;
export type MaxTolerableDisruption = (typeof MTD_LEVELS)[number];
const MTD_SCORE: Record<MaxTolerableDisruption, number> = {
  gt_1_month: L4,
  "1_week_to_1_month": L3,
  "1_to_7_days": L2,
  lt_24_hours: L1,
};

/** C1. How much of day-to-day operation depends on it? */
export const CRITICALITY_DEPENDENCY_LEVELS = ["incidental", "supporting", "significant", "essential"] as const;
export type CriticalityDependency = (typeof CRITICALITY_DEPENDENCY_LEVELS)[number];
const DEPENDENCY_SCORE: Record<CriticalityDependency, number> = {
  incidental: L4,
  supporting: L3,
  significant: L2,
  essential: L1,
};

/** C3. How much of the organization is affected if it degrades? */
export const BUSINESS_REACH_LEVELS = ["single_team", "single_function", "multi_function", "enterprise_wide"] as const;
export type BusinessReach = (typeof BUSINESS_REACH_LEVELS)[number];
const REACH_SCORE: Record<BusinessReach, number> = {
  single_team: L4,
  single_function: L3,
  multi_function: L2,
  enterprise_wide: L1,
};

/** C5. How replaceable is it, and how quickly? */
export const SUBSTITUTABILITY_LEVELS = [
  "interchangeable",
  "replaceable_weeks",
  "replaceable_months",
  "no_viable_alternative",
] as const;
export type Substitutability = (typeof SUBSTITUTABILITY_LEVELS)[number];
const SUBSTITUTABILITY_SCORE: Record<Substitutability, number> = {
  interchangeable: L4,
  replaceable_weeks: L3,
  replaceable_months: L2,
  no_viable_alternative: L1,
};

/** C4. How is it positioned in business processes? */
export const PROCESS_COUPLING_LEVELS = [
  "peripheral",
  "supports_critical_path",
  "in_critical_path",
  "embedded_no_manual_fallback",
] as const;
export type ProcessCoupling = (typeof PROCESS_COUPLING_LEVELS)[number];
const COUPLING_SCORE: Record<ProcessCoupling, number> = {
  peripheral: L4,
  supports_critical_path: L3,
  in_critical_path: L2,
  embedded_no_manual_fallback: L1,
};

/**
 * C6. How concentrated is OUR dependence on this one supplier? Same closed set
 * as vendor_engagements.concentration_snapshot so a relationship fact and an
 * engagement snapshot are directly comparable.
 */
export const CRITICALITY_CONCENTRATION_LEVELS = ["none", "low", "moderate", "single_point_of_failure"] as const;
export type CriticalityConcentration = (typeof CRITICALITY_CONCENTRATION_LEVELS)[number];
const CONCENTRATION_SCORE: Record<CriticalityConcentration, number> = {
  none: L4,
  low: L3,
  moderate: L2,
  single_point_of_failure: L1,
};

// ── Input / output contracts ────────────────────────────────────────────────

export type CriticalityInput = {
  max_tolerable_disruption: MaxTolerableDisruption;
  operational_dependency: CriticalityDependency;
  business_reach: BusinessReach;
  substitutability: Substitutability;
  process_coupling: ProcessCoupling;
  concentration: CriticalityConcentration;
};

export type CriticalityFactor = {
  dimension: CriticalityDimension;
  level: string;
  raw: number;
  weight: number;
  contribution: number;
  explanation: string;
};

export type CriticalityBasis = MethodologyBasis<"vendor_criticality_v1", CriticalityFactor>;

export type CriticalityResult = {
  /** 0–100, HIGHER = MORE CRITICAL. */
  score: number;
  /** Authoritative band AFTER escalation floors. */
  band: RiskBand;
  /** Band from arithmetic alone. Kept for provenance. */
  arithmetic_band: RiskBand;
  basis: CriticalityBasis;
  // Deliberately NO tier: the tier is a joint function of criticality and
  // inherent risk and belongs to neither engine (assessmentTier.ts).
};

// ── Escalation floors ───────────────────────────────────────────────────────

type CriticalityRule = {
  rule_id: string;
  floor: RiskBand;
  applies: (i: CriticalityInput) => boolean;
  explanation: string;
};

export const CRITICALITY_ESCALATION_RULES: CriticalityRule[] = [
  {
    rule_id: "CR1",
    floor: "Critical",
    applies: (i) =>
      i.max_tolerable_disruption === "lt_24_hours" && i.substitutability === "no_viable_alternative",
    explanation:
      "The business cannot operate for a day without this service and there is no viable " +
      "alternative supplier — no weighting can make that less than Critical.",
  },
  {
    rule_id: "CR2",
    floor: "High",
    applies: (i) =>
      i.business_reach === "enterprise_wide" &&
      (i.max_tolerable_disruption === "lt_24_hours" || i.max_tolerable_disruption === "1_to_7_days"),
    explanation:
      "An enterprise-wide dependency with less than a week of tolerable disruption is at " +
      "least High regardless of how replaceable the supplier is.",
  },
  {
    rule_id: "CR3",
    floor: "High",
    applies: (i) =>
      i.process_coupling === "embedded_no_manual_fallback" &&
      i.substitutability === "no_viable_alternative",
    explanation:
      "Embedded in a process with no manual fallback and no alternative supplier — the " +
      "organisation has no way to work around a failure.",
  },
];

// ── The model ───────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function humanize(level: string): string {
  return level.replace(/^gt_/, "more than ").replace(/^lt_/, "under ").replace(/_/g, " ");
}

export function computeVendorCriticality(input: CriticalityInput): CriticalityResult {
  const factors: CriticalityFactor[] = [];
  const push = (dimension: CriticalityDimension, level: string, raw: number, explanation: string): void => {
    const weight = CRITICALITY_WEIGHTS[dimension];
    factors.push({ dimension, level, raw: round2(raw), weight, contribution: round2(raw * weight), explanation });
  };

  push(
    "max_tolerable_disruption",
    input.max_tolerable_disruption,
    MTD_SCORE[input.max_tolerable_disruption],
    `The business could tolerate ${humanize(input.max_tolerable_disruption)} without it.`
  );
  push(
    "operational_dependency",
    input.operational_dependency,
    DEPENDENCY_SCORE[input.operational_dependency],
    `Day-to-day operation depends on it: ${input.operational_dependency}.`
  );
  push(
    "business_reach",
    input.business_reach,
    REACH_SCORE[input.business_reach],
    `A degradation affects: ${humanize(input.business_reach)}.`
  );
  push(
    "substitutability",
    input.substitutability,
    SUBSTITUTABILITY_SCORE[input.substitutability],
    `Replaceability: ${humanize(input.substitutability)}.`
  );
  push(
    "process_coupling",
    input.process_coupling,
    COUPLING_SCORE[input.process_coupling],
    `Position in business processes: ${humanize(input.process_coupling)}.`
  );
  push(
    "concentration",
    input.concentration,
    CONCENTRATION_SCORE[input.concentration],
    `Concentration of our dependence on this supplier: ${humanize(input.concentration)}.`
  );

  const score = clampScore(factors.reduce((sum, f) => sum + f.contribution, 0));
  const arithmeticBand = bandForScore(score);

  // Floors raise the BAND only, never the score — the arithmetic result stays
  // visible beside the final band so a reader sees both.
  const adjustments: MethodologyAdjustment[] = [];
  let band = arithmeticBand;
  for (const rule of CRITICALITY_ESCALATION_RULES) {
    if (!rule.applies(input)) continue;
    const before = band;
    band = maxBand(band, rule.floor);
    adjustments.push({
      rule_id: rule.rule_id,
      explanation:
        band === before
          ? `${rule.explanation} (Already at or above the ${rule.floor} floor this rule sets.)`
          : `${rule.explanation} Raised from ${before} to ${band}.`,
    });
  }

  return {
    score,
    band,
    arithmetic_band: arithmeticBand,
    basis: {
      method: "vendor_criticality_v1",
      version: 1,
      methodology_version: CRITICALITY_METHODOLOGY_VERSION,
      factors,
      adjustments,
    },
  };
}
