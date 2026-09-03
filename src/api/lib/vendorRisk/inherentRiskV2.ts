/**
 * inherentRiskV2.ts — the deterministic vendor INHERENT-RISK model, v2
 * (Onboarding 2.0). EXPOSURE ONLY.
 *
 * PURE, like v1. Same contract: identical inputs, byte-identical output.
 *
 * ── Why a v2 module rather than an edit to v1 ───────────────────────────────
 *
 * Every engagement scored to date carries `methodology_version = "1.0.0"` and a
 * self-describing `inherent_basis`. Those are NEVER rescored, and their basis
 * must remain reproducible against the code that produced it. inherentRisk.ts
 * is therefore left byte-for-byte intact as the v1 authority; this module is
 * the v2 authority, and a reader must render the version so a v1 and a v2
 * rating are never silently compared.
 *
 * ── What left, and where it went (owner rulings M1–M3) ──────────────────────
 *
 *   business_criticality    REMOVED — criticality is now a PEER engine
 *   operational_dependency  MOVED to criticality (with its recoverability
 *                           sub-factor, as max_tolerable_disruption)
 *   concentration           MOVED to criticality (M1)
 *   E1b, E4                 MOVED to the tier methodology (M2) — both read an
 *                           operational-dependency fact this engine no longer
 *                           scores, and duplicating that fact here would
 *                           double-count
 *
 * E1, E2, E3 touch only surviving dimensions and are unchanged.
 *
 * ── Weights: exact rationals, not rounded decimals ──────────────────────────
 *
 * The six surviving weights are v1_weight / 0.70, expressed as exact rationals
 * so they sum to 1 in arithmetic (as IEEE-754 doubles the sum is 1 - 1e-16). Relative proportions of the
 * survivors are preserved — the minimum honest drift. Written as fractions of
 * 70 so a reader can check them against v1 by eye: 20/70, 18/70, 12/70, 9/70,
 * 6/70, 5/70.
 *
 * ── Double-count check ──────────────────────────────────────────────────────
 *
 * No business-dependency concept remains. `fourth_party_exposure` is THEIR
 * supply chain as exposure to us; `concentration` (now criticality-only) is
 * OUR dependence on them — opposite directions, no overlap.
 */

import { clampScore, bandForScore, maxBand, type RiskBand } from "./riskBands.js";
import {
  INHERENT_METHODOLOGY_VERSION_V2,
  type MethodologyAdjustment,
  type MethodologyBasis,
} from "./methodologyVersion.js";
import {
  DATA_SENSITIVITY_LEVELS,
  DATA_VOLUME_BANDS,
  ACCESS_LEVELS,
  REGULATORY_EXPOSURE_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  AI_AUTONOMY_LEVELS,
  HOSTING_MODELS,
  FOURTH_PARTY_LEVELS,
  type DataSensitivity,
  type DataVolumeBand,
  type AccessLevel,
  type RegulatoryExposure,
  type AiInvolvement,
  type AiAutonomy,
  type HostingModel,
  type FourthPartyExposure,
} from "./inherentRisk.js";

// Re-exported so v2 callers import the level vocabularies from ONE place and
// the two engines can never drift on what a level is called.
export {
  DATA_SENSITIVITY_LEVELS,
  DATA_VOLUME_BANDS,
  ACCESS_LEVELS,
  REGULATORY_EXPOSURE_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  AI_AUTONOMY_LEVELS,
  HOSTING_MODELS,
  FOURTH_PARTY_LEVELS,
};

export const INHERENT_V2_DIMENSIONS = [
  "data_exposure",
  "access_exposure",
  "regulatory_exposure",
  "ai_exposure",
  "hosting_model",
  "fourth_party_exposure",
] as const;
export type InherentV2Dimension = (typeof INHERENT_V2_DIMENSIONS)[number];

/** Exact rationals over 70 — see header. The float sum is asserted within 1e-12 of 1. */
export const INHERENT_V2_WEIGHTS: Record<InherentV2Dimension, number> = {
  data_exposure: 20 / 70,
  access_exposure: 18 / 70,
  regulatory_exposure: 12 / 70,
  ai_exposure: 9 / 70,
  hosting_model: 6 / 70,
  fourth_party_exposure: 5 / 70,
};

// Level scores are IDENTICAL to v1 — only the weight set changed. Duplicated
// here (rather than exported from v1) so a future v1 edit cannot silently move
// v2; the parity is asserted by test.
const DATA_SENSITIVITY_SCORE: Record<DataSensitivity, number> = { none: 0, internal: 30, confidential: 70, restricted: 100 };
const DATA_VOLUME_MULTIPLIER: Record<DataVolumeBand, number> = { minimal: 0.7, moderate: 0.85, large: 1.0, mass: 1.0 };
const ACCESS_SCORE: Record<AccessLevel, number> = { none: 0, read_only: 35, read_write: 60, admin: 85, network_access: 100 };
const REGULATORY_EXPOSURE_SCORE: Record<RegulatoryExposure, number> = { none: 0, low: 30, moderate: 60, high: 100 };
const AI_INVOLVEMENT_SCORE: Record<AiInvolvement, number> = { none: 0, embedded: 60, core: 100 };
const AI_AUTONOMY_MULTIPLIER: Record<AiAutonomy, number> = { none: 0.5, human_in_the_loop: 0.7, human_on_the_loop: 0.85, autonomous_consequential: 1.0 };
const HOSTING_SCORE: Record<HostingModel, number> = { on_prem: 20, private_cloud: 40, saas: 60, multi_tenant_saas: 100 };
const FOURTH_PARTY_SCORE: Record<FourthPartyExposure, number> = { none: 0, low: 20, moderate: 50, high: 70 };

export type InherentRiskV2Input = {
  data_sensitivity: DataSensitivity;
  data_volume: DataVolumeBand;
  access_level: AccessLevel;
  regulatory_exposure: RegulatoryExposure;
  regulatory_breach_notification: boolean;
  ai_involvement: AiInvolvement;
  ai_autonomy: AiAutonomy;
  hosting_model: HostingModel;
  fourth_party_exposure: FourthPartyExposure;
};

export type InherentV2Factor = {
  dimension: InherentV2Dimension;
  level: string;
  raw: number;
  weight: number;
  contribution: number;
  explanation: string;
};

export type InherentRiskV2Basis = MethodologyBasis<"vendor_inherent_v2", InherentV2Factor>;

export type InherentRiskV2Result = {
  score: number;
  band: RiskBand;
  arithmetic_band: RiskBand;
  basis: InherentRiskV2Basis;
  // Deliberately NO tier (see criticality.ts).
};

type Rule = { rule_id: string; floor: RiskBand; applies: (i: InherentRiskV2Input) => boolean; explanation: string };

/** E1, E2, E3 — unchanged from v1. E1b and E4 live in assessmentTier.ts. */
export const INHERENT_V2_ESCALATION_RULES: Rule[] = [
  {
    rule_id: "E1",
    floor: "High",
    applies: (i) =>
      i.data_sensitivity === "restricted" && (i.access_level === "admin" || i.access_level === "network_access"),
    explanation: "Restricted data combined with administrative or network-level access.",
  },
  {
    rule_id: "E2",
    floor: "High",
    applies: (i) => i.ai_involvement !== "none" && i.ai_autonomy === "autonomous_consequential",
    explanation: "AI acting autonomously with consequential effect and no human in or on the loop.",
  },
  {
    rule_id: "E3",
    floor: "High",
    applies: (i) =>
      i.regulatory_breach_notification &&
      (i.data_sensitivity === "confidential" || i.data_sensitivity === "restricted"),
    explanation: "A breach-notification duty attaches to confidential or restricted data in scope.",
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeVendorInherentRiskV2(input: InherentRiskV2Input): InherentRiskV2Result {
  const factors: InherentV2Factor[] = [];
  const push = (dimension: InherentV2Dimension, level: string, raw: number, explanation: string): void => {
    const weight = INHERENT_V2_WEIGHTS[dimension];
    factors.push({ dimension, level, raw: round2(raw), weight, contribution: round2(raw * weight), explanation });
  };

  push(
    "data_exposure",
    `${input.data_sensitivity} / ${input.data_volume} volume`,
    DATA_SENSITIVITY_SCORE[input.data_sensitivity] * DATA_VOLUME_MULTIPLIER[input.data_volume],
    `Handles ${input.data_sensitivity} data at ${input.data_volume} volume.`
  );
  push(
    "access_exposure",
    input.access_level,
    ACCESS_SCORE[input.access_level],
    `Access to your systems: ${input.access_level.replace(/_/g, " ")}.`
  );
  push(
    "regulatory_exposure",
    input.regulatory_exposure,
    REGULATORY_EXPOSURE_SCORE[input.regulatory_exposure],
    input.regulatory_breach_notification
      ? `Regulatory exposure is ${input.regulatory_exposure}, including a breach-notification duty.`
      : `Regulatory exposure is ${input.regulatory_exposure}.`
  );
  const aiRaw =
    input.ai_involvement === "none" ? 0 : AI_INVOLVEMENT_SCORE[input.ai_involvement] * AI_AUTONOMY_MULTIPLIER[input.ai_autonomy];
  push(
    "ai_exposure",
    input.ai_involvement === "none" ? "none" : `${input.ai_involvement} / ${input.ai_autonomy}`,
    aiRaw,
    input.ai_involvement === "none"
      ? "No AI involvement declared."
      : `AI is ${input.ai_involvement} to the service, operating ${input.ai_autonomy.replace(/_/g, " ")}.`
  );
  push("hosting_model", input.hosting_model, HOSTING_SCORE[input.hosting_model], `Delivered as ${input.hosting_model.replace(/_/g, " ")}.`);
  push(
    "fourth_party_exposure",
    input.fourth_party_exposure,
    FOURTH_PARTY_SCORE[input.fourth_party_exposure],
    `Reliance on their own sub-processors is ${input.fourth_party_exposure}.`
  );

  const score = clampScore(factors.reduce((s, f) => s + f.contribution, 0));
  const arithmeticBand = bandForScore(score);
  const adjustments: MethodologyAdjustment[] = [];
  let band = arithmeticBand;
  for (const rule of INHERENT_V2_ESCALATION_RULES) {
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
    basis: { method: "vendor_inherent_v2", version: 1, methodology_version: INHERENT_METHODOLOGY_VERSION_V2, factors, adjustments },
  };
}
