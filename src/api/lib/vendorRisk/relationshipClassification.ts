/**
 * relationshipClassification.ts — the ONE place the three Onboarding 2.0
 * engines are composed for a relationship.
 *
 * PURE. Takes a factual intake row, returns criticality + inherent risk v2 +
 * assessment tier with their bases. Having exactly one composition point is how
 * the "no double-count" ruling is enforced structurally: the criticality
 * engine receives only dependency facts, the inherent engine only exposure
 * facts, and the tier engine receives the two BANDS plus the four RAW facts its
 * floors read — never a derived value fed back into a peer.
 */
import { computeVendorCriticality, type CriticalityInput, type CriticalityResult } from "./criticality.js";
import { computeVendorInherentRiskV2, type InherentRiskV2Input, type InherentRiskV2Result } from "./inherentRiskV2.js";
import { resolveAssessmentTier, type AssessmentTierResult } from "./assessmentTier.js";
import type { AssessmentTier } from "./riskBands.js";

/** Exactly the columns of vendor_relationship_intake that the engines read. */
export type RelationshipIntakeFacts = CriticalityInput & InherentRiskV2Input;

export type RelationshipClassification = {
  criticality: CriticalityResult;
  inherent: InherentRiskV2Result;
  tier: AssessmentTierResult;
};

export function classifyRelationship(
  facts: RelationshipIntakeFacts,
  policyMinimumTier: AssessmentTier | null
): RelationshipClassification {
  const criticality = computeVendorCriticality({
    max_tolerable_disruption: facts.max_tolerable_disruption,
    operational_dependency: facts.operational_dependency,
    business_reach: facts.business_reach,
    substitutability: facts.substitutability,
    process_coupling: facts.process_coupling,
    concentration: facts.concentration,
  });
  const inherent = computeVendorInherentRiskV2({
    data_sensitivity: facts.data_sensitivity,
    data_volume: facts.data_volume,
    access_level: facts.access_level,
    regulatory_exposure: facts.regulatory_exposure,
    regulatory_breach_notification: facts.regulatory_breach_notification,
    ai_involvement: facts.ai_involvement,
    ai_autonomy: facts.ai_autonomy,
    hosting_model: facts.hosting_model,
    fourth_party_exposure: facts.fourth_party_exposure,
  });
  const tier = resolveAssessmentTier({
    criticality_band: criticality.band,
    inherent_band: inherent.band,
    facts: {
      data_sensitivity: facts.data_sensitivity,
      access_level: facts.access_level,
      operational_dependency: facts.operational_dependency,
      concentration: facts.concentration,
    },
    policy_minimum_tier: policyMinimumTier,
  });
  return { criticality, inherent, tier };
}
