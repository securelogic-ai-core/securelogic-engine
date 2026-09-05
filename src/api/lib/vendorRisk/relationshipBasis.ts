/**
 * relationshipBasis.ts — WA-3 / R8-3: is an engagement's relationship-derived
 * basis still what the relationship currently determines?
 *
 * ── Why this is DERIVED and not a column ────────────────────────────────────
 * Owner ruling R5, applied again: DERIVE the machine signal, PERSIST only the
 * human disposition. A `stale` boolean on `vendor_engagements` would be a
 * cached copy of a comparison between two rows that both already exist — it
 * would go stale itself the moment either side moved, and there is no honest
 * value to backfill it with. So staleness is computed fresh on every read, from
 * the engagement's own copied columns and the relationship's current
 * determination, and nothing writes it down.
 *
 * ── What participates, and what deliberately does NOT ───────────────────────
 * `createEngagement` copies NINETEEN relationship-derived values onto the
 * engagement. Seventeen of them constitute the determination basis and are
 * compared here. Two are copied but excluded, on purpose:
 *
 *   - `inherent_basis` — the explainability envelope for the score. It is
 *     DERIVED from the same thirteen facts that are already compared, so it
 *     carries no independent signal, and its JSON shape can legitimately change
 *     when the methodology's presentation changes. Diffing it would manufacture
 *     staleness out of a formatting difference.
 *   - `relationship_id` — identity, not basis. If it differed, this comparison
 *     would not be running at all.
 *
 * Nothing else about the vendor or the relationship participates: not the
 * relationship's name, service description, primary flag, status, policy
 * minimum tier, timestamps, nor anything on `vendors`. A rename must never make
 * an assessment look stale.
 */

import type { InherentRiskInput } from "./inherentRisk.js";
import type { AssessmentTier, RiskBand } from "./riskBands.js";

/**
 * The seventeen values that constitute an engagement's relationship-derived
 * determination basis: the thirteen v1 facts the resolver reads, plus the four
 * determination outputs the engagement froze at creation.
 */
export type RelationshipDerivedBasis = {
  // ── the thirteen facts (InherentRiskInput) ────────────────────────────────
  data_sensitivity: string;
  data_volume: string;
  access_level: string;
  operational_dependency: string;
  recoverability: string;
  business_criticality: string;
  regulatory_exposure: string;
  regulatory_breach_notification: boolean;
  ai_involvement: string;
  ai_autonomy: string;
  hosting_model: string;
  fourth_party_exposure: string;
  concentration: string;
  // ── the four determination outputs ────────────────────────────────────────
  assessment_tier: string;
  inherent_score: number;
  inherent_rating: string;
  inherent_arithmetic_rating: string;
};

/** Field order is stable so a changed-field list reads the same way every time. */
export const RELATIONSHIP_BASIS_FIELDS = [
  "data_sensitivity",
  "data_volume",
  "access_level",
  "operational_dependency",
  "recoverability",
  "business_criticality",
  "regulatory_exposure",
  "regulatory_breach_notification",
  "ai_involvement",
  "ai_autonomy",
  "hosting_model",
  "fourth_party_exposure",
  "concentration",
  "assessment_tier",
  "inherent_score",
  "inherent_rating",
  "inherent_arithmetic_rating",
] as const satisfies readonly (keyof RelationshipDerivedBasis)[];

export type RelationshipBasisField = (typeof RELATIONSHIP_BASIS_FIELDS)[number];

export type BasisFieldChange = {
  field: RelationshipBasisField;
  /** What the engagement froze when it was created. */
  engagement_value: unknown;
  /** What the relationship determines today. */
  relationship_value: unknown;
};

/**
 * The engagement's stored columns, whose names differ from the fact names in
 * two places (`data_volume_band`, `concentration_snapshot`). The mapping lives
 * here, once, so a reader can see that the comparison is against the same
 * values `createEngagement` wrote and not a re-derivation.
 */
export type EngagementBasisRow = {
  data_sensitivity: string | null;
  data_volume_band: string | null;
  access_level: string | null;
  operational_dependency: string | null;
  recoverability: string | null;
  business_criticality: string | null;
  regulatory_exposure: string | null;
  regulatory_breach_notification: boolean | null;
  ai_involvement: string | null;
  ai_autonomy: string | null;
  hosting_model: string | null;
  fourth_party_exposure: string | null;
  concentration_snapshot: string | null;
  assessment_tier: string | null;
  inherent_score: number | string | null;
  inherent_rating: string | null;
  inherent_arithmetic_rating: string | null;
};

/** `inherent_score` arrives as a string from pg for some numeric types. */
const num = (v: number | string | null): number => (v === null ? NaN : Number(v));
const str = (v: string | null): string => v ?? "";

export function basisFromEngagementRow(row: EngagementBasisRow): RelationshipDerivedBasis {
  return {
    data_sensitivity: str(row.data_sensitivity),
    data_volume: str(row.data_volume_band),
    access_level: str(row.access_level),
    operational_dependency: str(row.operational_dependency),
    recoverability: str(row.recoverability),
    business_criticality: str(row.business_criticality),
    regulatory_exposure: str(row.regulatory_exposure),
    regulatory_breach_notification: row.regulatory_breach_notification === true,
    ai_involvement: str(row.ai_involvement),
    ai_autonomy: str(row.ai_autonomy),
    hosting_model: str(row.hosting_model),
    fourth_party_exposure: str(row.fourth_party_exposure),
    concentration: str(row.concentration_snapshot),
    assessment_tier: str(row.assessment_tier),
    inherent_score: num(row.inherent_score),
    inherent_rating: str(row.inherent_rating),
    inherent_arithmetic_rating: str(row.inherent_arithmetic_rating),
  };
}

/** The same seventeen values, read off what `seedFromRelationship` returns. */
export function basisFromSeed(seed: {
  facts: InherentRiskInput;
  inherent: { score: number; band: RiskBand; arithmetic_band: RiskBand };
  tier: AssessmentTier;
}): RelationshipDerivedBasis {
  const f = seed.facts as unknown as Record<string, unknown>;
  return {
    data_sensitivity: String(f["data_sensitivity"] ?? ""),
    data_volume: String(f["data_volume"] ?? ""),
    access_level: String(f["access_level"] ?? ""),
    operational_dependency: String(f["operational_dependency"] ?? ""),
    recoverability: String(f["recoverability"] ?? ""),
    business_criticality: String(f["business_criticality"] ?? ""),
    regulatory_exposure: String(f["regulatory_exposure"] ?? ""),
    regulatory_breach_notification: f["regulatory_breach_notification"] === true,
    ai_involvement: String(f["ai_involvement"] ?? ""),
    ai_autonomy: String(f["ai_autonomy"] ?? ""),
    hosting_model: String(f["hosting_model"] ?? ""),
    fourth_party_exposure: String(f["fourth_party_exposure"] ?? ""),
    concentration: String(f["concentration"] ?? ""),
    assessment_tier: String(seed.tier),
    inherent_score: Number(seed.inherent.score),
    inherent_rating: String(seed.inherent.band),
    inherent_arithmetic_rating: String(seed.inherent.arithmetic_band),
  };
}

/**
 * The seventeen-field diff. Strict equality on primitives only — every compared
 * value is a closed-vocabulary string, a boolean or a number, so there is no
 * deep comparison to get wrong and no JSON whose key order could fake a change.
 */
export function compareRelationshipBasis(
  engagement: RelationshipDerivedBasis,
  relationship: RelationshipDerivedBasis
): BasisFieldChange[] {
  const changes: BasisFieldChange[] = [];
  for (const field of RELATIONSHIP_BASIS_FIELDS) {
    const a = engagement[field];
    const b = relationship[field];
    // NaN never equals itself; an engagement with no stored score and a
    // relationship with none either is not a change.
    const same =
      typeof a === "number" && typeof b === "number"
        ? a === b || (Number.isNaN(a) && Number.isNaN(b))
        : a === b;
    if (!same) changes.push({ field, engagement_value: a, relationship_value: b });
  }
  return changes;
}
