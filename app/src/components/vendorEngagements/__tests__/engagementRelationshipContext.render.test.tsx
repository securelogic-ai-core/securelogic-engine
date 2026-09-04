/**
 * EngagementRelationshipContext — VO-11 render contract: a customer can read
 * which relationship an engagement assesses and the classification it was
 * opened at, from stored values; a pre-2.0 engagement says it is unlinked.
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
  it("a pre-2.0 engagement is honestly unlinked — no rating is invented", () => {
    render(<EngagementRelationshipContext vendorId="v-1" vendorName="Old Vendor" relationship={null} methodologyVersion="1.0.0" domains={null} />);
    expect(screen.getByText(/opened before Vendor Onboarding 2.0/)).toBeTruthy();
    expect(screen.getByText(/methodology 1.0.0/)).toBeTruthy();
    expect(screen.queryByText(/Tier \d/)).toBeNull();
  });
});
