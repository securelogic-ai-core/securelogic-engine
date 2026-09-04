/**
 * relationshipEngagementBridge.ts — Vendor Onboarding 2.0 VO-7: how an
 * engagement opened FROM a classified relationship populates the engagement
 * spine's v1-vocabulary fact columns.
 *
 * ── Why a bridge exists at all ──────────────────────────────────────────────
 *
 * The shipped scope resolver reads the engagement's facts through the FactSet
 * in the v1 vocabulary: S5.resilience.dependency fires on
 * `core.operational_dependency >= "high"`, S5.resilience.recoverability on
 * `core.recoverability >= "weeks"`, S5.resilience.criticality on
 * `core.business_criticality >= "high"`. Those columns are mirrored from the
 * engagement row at scoping time (mirrorSubjectFacts). Onboarding 2.0 collects
 * the same information in its own vocabulary, so a VO2 engagement must carry
 * v1-vocabulary values in those columns for the existing scoper to behave —
 * and it must NOT be rescored by the v1 inherent engine.
 *
 * This is a SCOPING bridge, not a scoring input. The engagement's inherent
 * score/band/basis and assessment_tier are COPIED from the relationship's v2
 * classification, stamped methodology_version "2.0.0". Nothing here feeds a
 * peer engine. In particular, business_criticality below is populated from the
 * DERIVED criticality band so that assessment DEPTH follows the derived
 * classification — which is the point of Onboarding 2.0 — while inherent risk
 * v2 never sees it.
 *
 * ── The mappings, by MEANING and by rank ────────────────────────────────────
 *
 *   operational_dependency  v2 incidental/supporting/significant/essential
 *                        -> v1 low/moderate/high/critical          (rank 1:1)
 *
 *   business_criticality    <- derived criticality BAND
 *                           Low/Moderate/High/Critical
 *                        -> v1 low/medium/high/critical            (rank 1:1;
 *                           note v1 spells the second level "medium")
 *
 *   recoverability          <- max_tolerable_disruption. v1 recoverability is
 *                           "how long to recover" (hours best .. none worst);
 *                           MTD is "how long we can tolerate" (>1 month best
 *                           .. <24h worst). Different facts, same axis of
 *                           resilience concern, so they are aligned by RANK:
 *                           gt_1_month->hours, 1_week_to_1_month->days,
 *                           1_to_7_days->weeks, lt_24_hours->none. The
 *                           consequence for scoping is exactly the intended
 *                           one: S5.resilience.recoverability (>= weeks) opens
 *                           for any relationship with <= 7 days of tolerance.
 *
 *   concentration           same closed set on both sides.
 *   everything else         identical vocabulary on both sides.
 *
 * PURE. Pinned by relationshipEngagementBridge.test.ts.
 */
import type { InherentRiskInput } from "./inherentRisk.js";
import type { RelationshipIntakeFacts } from "./relationshipClassification.js";
import type { RiskBand } from "./riskBands.js";

const DEPENDENCY_V1: Record<RelationshipIntakeFacts["operational_dependency"], InherentRiskInput["operational_dependency"]> = {
  incidental: "low",
  supporting: "moderate",
  significant: "high",
  essential: "critical",
};

const CRITICALITY_BAND_V1: Record<RiskBand, InherentRiskInput["business_criticality"]> = {
  Low: "low",
  Moderate: "medium",
  High: "high",
  Critical: "critical",
};

const MTD_V1: Record<RelationshipIntakeFacts["max_tolerable_disruption"], InherentRiskInput["recoverability"]> = {
  gt_1_month: "hours",
  "1_week_to_1_month": "days",
  "1_to_7_days": "weeks",
  lt_24_hours: "none",
};

export function v1FactsFromRelationship(
  intake: RelationshipIntakeFacts,
  criticalityBand: RiskBand
): InherentRiskInput {
  return {
    data_sensitivity: intake.data_sensitivity,
    data_volume: intake.data_volume,
    access_level: intake.access_level,
    operational_dependency: DEPENDENCY_V1[intake.operational_dependency],
    recoverability: MTD_V1[intake.max_tolerable_disruption],
    business_criticality: CRITICALITY_BAND_V1[criticalityBand],
    regulatory_exposure: intake.regulatory_exposure,
    regulatory_breach_notification: intake.regulatory_breach_notification,
    ai_involvement: intake.ai_involvement,
    ai_autonomy: intake.ai_autonomy,
    hosting_model: intake.hosting_model,
    fourth_party_exposure: intake.fourth_party_exposure,
    concentration: intake.concentration,
  };
}
