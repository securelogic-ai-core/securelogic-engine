/**
 * inherentRisk.ts — the deterministic vendor inherent-risk model.
 *
 * PURE. No I/O, no DB handle, no LLM, no clock, no randomness. Identical inputs
 * produce byte-identical output, forever. That is the ratified requirement: the
 * authoritative core of the methodology must be reproducible without a model,
 * and AI must never be the opaque authority deciding a rating.
 *
 * ── The taxonomy ────────────────────────────────────────────────────────────
 *
 * Thirteen candidate dimensions were evaluated against the repository and
 * recognized TPRM practice; NINE survive. Two merges removed double-counting
 * and three demotions expressed conditional structure:
 *
 *   - external/network connectivity MERGED into access_exposure. The shipped
 *     `vendors.access_level` enum already carries `network_access` as its top
 *     value; scoring both would count one fact twice.
 *   - data_volume is a SUB-FACTOR of data_exposure, not a peer. Volume without
 *     sensitivity is not risk; volume amplifies sensitivity. As a peer it would
 *     let high-volume public data outrank low-volume PHI.
 *   - ai_autonomy is a SUB-FACTOR of ai_exposure. A vendor with no AI cannot
 *     have autonomy — conditional by construction.
 *   - recoverability is a SUB-FACTOR of operational_dependency: RTO tolerance is
 *     the magnitude of the dependency, not a separate exposure.
 *
 * ── Why weighted-additive, not multiplicative ───────────────────────────────
 *
 * The repo has both precedents: riskScore.ts multiplies two terms,
 * riskScoring.ts multiplies three. Multiplying NINE terms collapses toward zero
 * and stops being explainable — which defeats the point, since the whole model
 * exists to answer "why is this vendor High?" in terms a customer can audit.
 *
 * Additive alone has the opposite failure: a single catastrophic combination can
 * be diluted by eight benign dimensions. That is what the named ESCALATION
 * FLOORS below are for. Named rules beat tuned constants: "Tier 1 because rule
 * E1 fired" is defensible in a way that "because the dominance factor is 1.4"
 * is not.
 *
 * ── This finally makes two shipped fields load-bearing ──────────────────────
 *
 * `vendors.data_sensitivity` and `vendors.access_level` have been collected at
 * intake since April 2026 and read by NOTHING but the edit form and the CSV
 * export. They are the two highest-weighted dimensions here.
 */

import {
  clampScore,
  bandForScore,
  maxBand,
  tierForBand,
  type AssessmentTier,
  type RiskBand,
} from "./riskBands.js";
import {
  METHODOLOGY_VERSION,
  type MethodologyAdjustment,
  type MethodologyBasis,
} from "./methodologyVersion.js";

// ── Dimension identifiers ───────────────────────────────────────────────────

export const INHERENT_DIMENSIONS = [
  "data_exposure",
  "access_exposure",
  "operational_dependency",
  "business_criticality",
  "regulatory_exposure",
  "ai_exposure",
  "hosting_model",
  "fourth_party_exposure",
  "concentration",
] as const;
export type InherentDimension = (typeof INHERENT_DIMENSIONS)[number];

/**
 * Fixed weights. MUST sum to exactly 1.0 — asserted by a unit test, because a
 * drift here silently rescales every vendor in the portfolio.
 */
export const DIMENSION_WEIGHTS: Record<InherentDimension, number> = {
  data_exposure: 0.2,
  access_exposure: 0.18,
  operational_dependency: 0.13,
  business_criticality: 0.12,
  regulatory_exposure: 0.12,
  ai_exposure: 0.09,
  hosting_model: 0.06,
  fourth_party_exposure: 0.05,
  concentration: 0.05,
};

// ── Level tables ────────────────────────────────────────────────────────────
//
// Each dimension scores 0–100 on NAMED levels. Named, not numeric, so the stored
// basis records what the assessor actually declared rather than a magic number
// nobody can reconstruct later.

/** vendors.data_sensitivity — the shipped enum. */
export const DATA_SENSITIVITY_LEVELS = ["none", "internal", "confidential", "restricted"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITY_LEVELS)[number];
const DATA_SENSITIVITY_SCORE: Record<DataSensitivity, number> = {
  none: 0,
  internal: 30,
  confidential: 70,
  restricted: 100,
};

/** Engagement-level declaration: how much of it. Amplifies sensitivity, never creates risk alone. */
export const DATA_VOLUME_BANDS = ["minimal", "moderate", "large", "mass"] as const;
export type DataVolumeBand = (typeof DATA_VOLUME_BANDS)[number];
const DATA_VOLUME_MULTIPLIER: Record<DataVolumeBand, number> = {
  minimal: 0.7,
  moderate: 0.85,
  large: 1.0,
  mass: 1.0, // capped: beyond "large" the sensitivity term already dominates
};

/** vendors.access_level — the shipped enum. Absorbs external/network connectivity. */
export const ACCESS_LEVELS = ["none", "read_only", "read_write", "admin", "network_access"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
const ACCESS_SCORE: Record<AccessLevel, number> = {
  none: 0,
  read_only: 35,
  read_write: 60,
  admin: 85,
  network_access: 100,
};

/**
 * How hard the vendor is to replace RIGHT NOW. Deliberately distinct from
 * business_criticality: criticality is how important the FUNCTION is; dependency
 * is substitutability × notice period. A critical function with three
 * interchangeable suppliers is not the same exposure as a moderate function with
 * one irreplaceable one.
 */
export const OPERATIONAL_DEPENDENCY_LEVELS = ["low", "moderate", "high", "critical"] as const;
export type OperationalDependency = (typeof OPERATIONAL_DEPENDENCY_LEVELS)[number];
const OPERATIONAL_DEPENDENCY_SCORE: Record<OperationalDependency, number> = {
  low: 20,
  moderate: 45,
  high: 70,
  critical: 100,
};

/** Sub-factor: how much an outage actually costs. Modulates dependency. */
export const RECOVERABILITY_LEVELS = ["hours", "days", "weeks", "none"] as const;
export type Recoverability = (typeof RECOVERABILITY_LEVELS)[number];
const RECOVERABILITY_MULTIPLIER: Record<Recoverability, number> = {
  hours: 0.85, // tolerable outage window
  days: 1.0,
  weeks: 1.0,
  none: 1.0, // no workaround exists
};

/** vendors.criticality — the shipped enum (note: 'medium', not 'moderate'). */
export const BUSINESS_CRITICALITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type BusinessCriticality = (typeof BUSINESS_CRITICALITY_LEVELS)[number];
const BUSINESS_CRITICALITY_SCORE: Record<BusinessCriticality, number> = {
  low: 15,
  medium: 40,
  high: 70,
  critical: 100,
};

/**
 * Derived from the org's ACTIVE obligations, not declared. See resolveRegulatoryExposure().
 * `breach_notification` is separated because it is the trigger for escalation E3.
 */
export const REGULATORY_EXPOSURE_LEVELS = ["none", "low", "moderate", "high"] as const;
export type RegulatoryExposure = (typeof REGULATORY_EXPOSURE_LEVELS)[number];
const REGULATORY_EXPOSURE_SCORE: Record<RegulatoryExposure, number> = {
  none: 0,
  low: 30,
  moderate: 60,
  high: 100,
};

/** Is AI involved at all. Gate for the autonomy sub-factor. */
export const AI_INVOLVEMENT_LEVELS = ["none", "embedded", "core"] as const;
export type AiInvolvement = (typeof AI_INVOLVEMENT_LEVELS)[number];
const AI_INVOLVEMENT_SCORE: Record<AiInvolvement, number> = {
  none: 0,
  embedded: 60, // AI assists a human-owned process
  core: 100, // the service IS the model
};

/**
 * Sub-factor, meaningful only when involvement !== 'none'.
 * `autonomous_consequential` is the NIST AI RMF shape that triggers escalation E2:
 * the vendor's AI makes decisions materially affecting people without human review.
 */
export const AI_AUTONOMY_LEVELS = [
  "none",
  "human_in_the_loop",
  "human_on_the_loop",
  "autonomous_consequential",
] as const;
export type AiAutonomy = (typeof AI_AUTONOMY_LEVELS)[number];
const AI_AUTONOMY_MULTIPLIER: Record<AiAutonomy, number> = {
  none: 0.5,
  human_in_the_loop: 0.7,
  human_on_the_loop: 0.85,
  autonomous_consequential: 1.0,
};

export const HOSTING_MODELS = ["on_prem", "private_cloud", "saas", "multi_tenant_saas"] as const;
export type HostingModel = (typeof HOSTING_MODELS)[number];
const HOSTING_SCORE: Record<HostingModel, number> = {
  on_prem: 20,
  private_cloud: 40,
  saas: 60,
  multi_tenant_saas: 100,
};

/** Sub-processors / fourth parties. The SOC extractor already surfaces this. */
export const FOURTH_PARTY_LEVELS = ["none", "low", "moderate", "high"] as const;
export type FourthPartyExposure = (typeof FOURTH_PARTY_LEVELS)[number];
const FOURTH_PARTY_SCORE: Record<FourthPartyExposure, number> = {
  none: 0,
  low: 20,
  moderate: 50,
  high: 70,
};

/**
 * The ONLY portfolio-derived dimension. Ratified decision 2: the value used for
 * a formal rating is SNAPSHOTTED at scoping so historical assessments stay
 * reproducible; live concentration may be displayed separately, clearly labelled
 * as current and not used in the rating.
 */
export const CONCENTRATION_LEVELS = ["none", "low", "moderate", "single_point_of_failure"] as const;
export type Concentration = (typeof CONCENTRATION_LEVELS)[number];
const CONCENTRATION_SCORE: Record<Concentration, number> = {
  none: 0,
  low: 20,
  moderate: 50,
  single_point_of_failure: 100,
};

// ── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Every input is REQUIRED and explicitly typed. There is deliberately no
 * "unknown" fallback that scores 0: silently treating a missing declaration as
 * no-risk is how a Tier 1 vendor gets assessed as Tier 4. Callers resolve
 * defaults explicitly and visibly at the route layer.
 */
export type InherentRiskInput = {
  data_sensitivity: DataSensitivity;
  data_volume: DataVolumeBand;
  access_level: AccessLevel;
  operational_dependency: OperationalDependency;
  recoverability: Recoverability;
  business_criticality: BusinessCriticality;
  regulatory_exposure: RegulatoryExposure;
  /** True when any active obligation in scope carries a breach-notification duty. */
  regulatory_breach_notification: boolean;
  ai_involvement: AiInvolvement;
  ai_autonomy: AiAutonomy;
  hosting_model: HostingModel;
  fourth_party_exposure: FourthPartyExposure;
  concentration: Concentration;
};

export type InherentFactor = {
  dimension: InherentDimension;
  /** The declared level(s), by value — what the assessor actually chose. */
  level: string;
  /** The dimension's own 0–100 score before weighting. */
  raw: number;
  weight: number;
  /** raw × weight, rounded to 2dp for display stability. */
  contribution: number;
  /** Customer-facing sentence. This is what the UI renders. */
  explanation: string;
};

export type InherentRiskBasis = MethodologyBasis<"vendor_inherent_v1", InherentFactor>;

export type InherentRiskResult = {
  /** 0–100, HIGHER = WORSE (risk-register polarity). */
  score: number;
  /** Authoritative band AFTER escalation floors. */
  band: RiskBand;
  /** Band from arithmetic alone, before any escalation. Kept for provenance. */
  arithmetic_band: RiskBand;
  tier: AssessmentTier;
  basis: InherentRiskBasis;
};

// ── Escalation floors ───────────────────────────────────────────────────────

type EscalationRule = {
  rule_id: string;
  floor: RiskBand;
  applies: (i: InherentRiskInput) => boolean;
  explanation: string;
};

/**
 * Named floors. Real TPRM tiering does not let arithmetic wash out a
 * catastrophic combination, and these fire RARELY by design — across the four
 * reference profiles in the methodology none of them binds. They exist for the
 * corner the weights under-score: a small, low-criticality, entirely replaceable
 * vendor that nonetheless holds restricted data with network access.
 */
export const ESCALATION_RULES: EscalationRule[] = [
  {
    rule_id: "E1",
    floor: "High",
    applies: (i) =>
      i.data_sensitivity === "restricted" &&
      (i.access_level === "admin" || i.access_level === "network_access"),
    explanation:
      "Holds restricted data AND has privileged control over the systems that hold it. " +
      "Your own access controls, segmentation and monitoring no longer bound the blast " +
      "radius — a compromise of this vendor is functionally a compromise of you.",
  },
  {
    rule_id: "E1b",
    floor: "Critical",
    applies: (i) =>
      i.data_sensitivity === "restricted" &&
      (i.access_level === "admin" || i.access_level === "network_access") &&
      i.operational_dependency === "critical",
    explanation:
      "Meets E1 and cannot be disconnected: restricted data, privileged access, and no " +
      "practical ability to operate without them. This is the profile behind every major " +
      "supply-chain incident of the last five years.",
  },
  {
    rule_id: "E2",
    floor: "High",
    applies: (i) =>
      i.ai_involvement !== "none" && i.ai_autonomy === "autonomous_consequential",
    explanation:
      "The vendor's AI makes decisions that materially affect people without human review.",
  },
  {
    rule_id: "E3",
    floor: "High",
    applies: (i) =>
      i.regulatory_breach_notification &&
      (i.data_sensitivity === "confidential" || i.data_sensitivity === "restricted"),
    explanation:
      "An active obligation carries a breach-notification duty and this vendor holds " +
      "confidential or restricted data, so their incident becomes your reportable event.",
  },
  {
    rule_id: "E4",
    floor: "High",
    applies: (i) =>
      i.concentration === "single_point_of_failure" && i.operational_dependency === "critical",
    explanation:
      "Single point of failure for a critical dependency — there is no second supplier " +
      "and no ability to operate without this one.",
  },
];

// ── The model ───────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute inherent risk. Pure and total — every input is a closed enum, so there
 * is no error path and no null return.
 */
export function computeVendorInherentRisk(input: InherentRiskInput): InherentRiskResult {
  const factors: InherentFactor[] = [];

  const push = (
    dimension: InherentDimension,
    level: string,
    raw: number,
    explanation: string
  ): void => {
    const weight = DIMENSION_WEIGHTS[dimension];
    factors.push({
      dimension,
      level,
      raw: round2(raw),
      weight,
      contribution: round2(raw * weight),
      explanation,
    });
  };

  // 1. data_exposure = sensitivity × volume
  const dataRaw =
    DATA_SENSITIVITY_SCORE[input.data_sensitivity] * DATA_VOLUME_MULTIPLIER[input.data_volume];
  push(
    "data_exposure",
    `${input.data_sensitivity} / ${input.data_volume} volume`,
    dataRaw,
    `Handles ${input.data_sensitivity} data at ${input.data_volume} volume.`
  );

  // 2. access_exposure (absorbs external/network connectivity)
  push(
    "access_exposure",
    input.access_level,
    ACCESS_SCORE[input.access_level],
    `Access to your systems: ${input.access_level.replace(/_/g, " ")}.`
  );

  // 3. operational_dependency × recoverability
  const depRaw =
    OPERATIONAL_DEPENDENCY_SCORE[input.operational_dependency] *
    RECOVERABILITY_MULTIPLIER[input.recoverability];
  push(
    "operational_dependency",
    `${input.operational_dependency} / recovery in ${input.recoverability}`,
    depRaw,
    `Replacing them is ${input.operational_dependency}; tolerable outage window is ${input.recoverability}.`
  );

  // 4. business_criticality
  push(
    "business_criticality",
    input.business_criticality,
    BUSINESS_CRITICALITY_SCORE[input.business_criticality],
    `The business function they support is ${input.business_criticality} criticality.`
  );

  // 5. regulatory_exposure
  push(
    "regulatory_exposure",
    input.regulatory_exposure,
    REGULATORY_EXPOSURE_SCORE[input.regulatory_exposure],
    input.regulatory_breach_notification
      ? `Regulatory exposure is ${input.regulatory_exposure}, including a breach-notification duty.`
      : `Regulatory exposure is ${input.regulatory_exposure}.`
  );

  // 6. ai_exposure = involvement × autonomy (autonomy is inert when involvement is none)
  const aiRaw =
    input.ai_involvement === "none"
      ? 0
      : AI_INVOLVEMENT_SCORE[input.ai_involvement] * AI_AUTONOMY_MULTIPLIER[input.ai_autonomy];
  push(
    "ai_exposure",
    input.ai_involvement === "none"
      ? "none"
      : `${input.ai_involvement} / ${input.ai_autonomy}`,
    aiRaw,
    input.ai_involvement === "none"
      ? "No AI involvement declared."
      : `AI is ${input.ai_involvement} to the service, operating ${input.ai_autonomy.replace(/_/g, " ")}.`
  );

  // 7. hosting_model
  push(
    "hosting_model",
    input.hosting_model,
    HOSTING_SCORE[input.hosting_model],
    `Delivered as ${input.hosting_model.replace(/_/g, " ")}.`
  );

  // 8. fourth_party_exposure
  push(
    "fourth_party_exposure",
    input.fourth_party_exposure,
    FOURTH_PARTY_SCORE[input.fourth_party_exposure],
    `Reliance on their own sub-processors is ${input.fourth_party_exposure}.`
  );

  // 9. concentration (snapshotted at scoping — see CONCENTRATION_LEVELS)
  push(
    "concentration",
    input.concentration,
    CONCENTRATION_SCORE[input.concentration],
    `Portfolio concentration: ${input.concentration.replace(/_/g, " ")}.`
  );

  const score = clampScore(factors.reduce((sum, f) => sum + f.contribution, 0));
  const arithmeticBand = bandForScore(score);

  // Escalation floors raise the BAND only. They never rewrite the score: the
  // arithmetic result stays visible beside the final rating so a reader can see
  // both what the weights said and which named rule overrode them.
  const adjustments: MethodologyAdjustment[] = [];
  let band = arithmeticBand;
  for (const rule of ESCALATION_RULES) {
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
    tier: tierForBand(band),
    basis: {
      method: "vendor_inherent_v1",
      version: 1,
      methodology_version: METHODOLOGY_VERSION,
      factors,
      adjustments,
    },
  };
}
