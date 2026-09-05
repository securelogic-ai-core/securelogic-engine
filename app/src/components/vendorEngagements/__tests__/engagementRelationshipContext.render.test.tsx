/**
 * EngagementRelationshipContext — VO-11 render contract: a customer can read
 * which relationship an engagement assesses and the classification it was
 * opened at, from stored values; a pre-2.0 engagement says it is unlinked.
 *
 * WA-2 adds the "Why this rating?" disclosure — the stored basis envelopes
 * rendered through the SAME component the vendor page uses, so an analyst can
 * defend a rating without leaving the engagement.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EngagementRelationshipContext from "../EngagementRelationshipContext";

const rel = {
  id: "rel-1", name: "Card processing", service_description: "Online card acquiring", is_primary: true, status: "active" as const,
  policy_minimum_tier: null,
  criticality_score: 90, criticality_band: "Critical" as const, criticality_arithmetic_band: "Critical" as const, criticality_methodology_version: "1.0.0",
  inherent_score: 70, inherent_band: "High" as const, inherent_arithmetic_band: "High" as const, inherent_methodology_version: "2.0.0",
  assessment_tier: "tier_1_critical" as const, tier_calculated_minimum: "tier_1_critical" as const, tier_methodology_version: "1.0.0",
  classification_computed_at: "2026-09-04T00:00:00Z",
  criticality_basis: {
    method: "vendor_criticality_v1", version: 1 as const, methodology_version: "1.0.0",
    factors: [
      { dimension: "max_tolerable_disruption", level: "lt_24_hours", raw: 100, weight: 0.26, contribution: 26,
        explanation: "The business could not operate acceptably for even 24 hours without it." },
    ],
    adjustments: [{ rule_id: "CR2", explanation: "Irreplaceable inside a 24-hour tolerance." }],
  },
  inherent_basis: {
    method: "vendor_inherent_v2", version: 1 as const, methodology_version: "2.0.0",
    factors: [
      { dimension: "data_exposure", level: "restricted", raw: 100, weight: 0.2857, contribution: 28.57,
        explanation: "Restricted data at large volume." },
    ],
    adjustments: [],
  },
  tier_basis: {
    method: "vendor_assessment_tier_v1", methodology_version: "1.0.0",
    criticality_band: "Critical" as const, inherent_band: "High" as const,
    adjustments: [],
  },
};
const domains = { security: 38, privacy: 16, ai: 4, resilience: 3, nth_party: 2, compliance: 0 };

describe("EngagementRelationshipContext", () => {
  it("names the relationship, the vendor, both peer ratings, the joint tier and the applicable domains", () => {
    render(<EngagementRelationshipContext vendorId="v-1" vendorName="Acme Payments" relationship={rel} methodologyVersion="2.0.0" domains={domains} />);
    expect(screen.getByText("Card processing")).toBeTruthy();
    expect(screen.getByText(/Acme Payments/)).toBeTruthy();
    expect(screen.getByText("PRIMARY")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText(/· 90/)).toBeTruthy();
    expect(screen.getByText(/· 70/)).toBeTruthy();
    expect(screen.getByText("Tier 1 — Critical")).toBeTruthy();
    expect(screen.getByText(/Security 38 · Privacy 16 · AI governance 4 · Resilience 3 · Fourth \/ Nth party 2/)).toBeTruthy();
    expect(screen.getByText(/criticality v1.0.0 · inherent v2.0.0/)).toBeTruthy();
  });
  it("shows a policy raise when the calculated minimum differs", () => {
    render(<EngagementRelationshipContext vendorId="v-1" vendorName="Acme" relationship={{ ...rel, assessment_tier: "tier_2_high", tier_calculated_minimum: "tier_4_low" }} methodologyVersion="2.0.0" domains={domains} />);
    expect(screen.getByText(/policy raised from Tier 4 — Low/)).toBeTruthy();
  });
  it("WA-2: renders the stored basis behind 'Why this rating?', without recomputing it", () => {
    render(<EngagementRelationshipContext vendorId="v-1" vendorName="Acme Payments" relationship={rel} methodologyVersion="2.0.0" domains={domains} />);
    expect(screen.getByText(/Why this rating\?/)).toBeTruthy();
    // The stored factor explanation, verbatim — not a sentence this component wrote.
    expect(screen.getByText(/could not operate acceptably for even 24 hours/)).toBeTruthy();
    // The named rule that fired, with its id, per the ratified explainability requirement.
    expect(screen.getByText(/CR2: Irreplaceable inside a 24-hour tolerance/)).toBeTruthy();
    // The joint function, in the tier envelope's own terms.
    expect(screen.getByText(/Criticality Critical × Inherent risk High on the approved matrix/)).toBeTruthy();
    // The methodology stamps travel with each envelope, so a v1 and a v2 rating
    // can never be silently compared.
    expect(screen.getByText(/vendor_inherent_v2 v2.0.0/)).toBeTruthy();
    // And the route back: ratings are corrected through the facts, never edited.
    expect(screen.getByText(/correct the facts and record the intake/)).toBeTruthy();
  });

  it("WA-2: says nothing about a rating it has no basis for", () => {
    // A classification stored before the basis envelopes existed must render as
    // silence, not as an empty panel that reads "assessed, with no reasons".
    render(
      <EngagementRelationshipContext
        vendorId="v-1"
        vendorName="Acme"
        relationship={{ ...rel, criticality_basis: null, inherent_basis: null, tier_basis: null }}
        methodologyVersion="2.0.0"
        domains={domains}
      />
    );
    expect(screen.queryByText(/Why this rating\?/)).toBeNull();
    // The bands it DOES have are still shown.
    expect(screen.getByText("Tier 1 — Critical")).toBeTruthy();
  });

  it("a pre-2.0 engagement is honestly unlinked — no rating is invented", () => {
    render(<EngagementRelationshipContext vendorId="v-1" vendorName="Old Vendor" relationship={null} methodologyVersion="1.0.0" domains={null} />);
    expect(screen.getByText(/opened before Vendor Onboarding 2.0/)).toBeTruthy();
    expect(screen.getByText(/methodology 1.0.0/)).toBeTruthy();
    expect(screen.queryByText(/Tier \d/)).toBeNull();
  });
});
