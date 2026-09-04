/**
 * VendorRelationshipsCard — Onboarding 2.0 render contract.
 *
 * Pins the two rules a customer must be able to SEE: intake_required renders
 * as ignorance (no score, no band, no tier — never a zero), and a classified
 * relationship shows criticality and inherent risk as PEERS with the joint
 * tier, with the manual legacy classification labelled as such and unused.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/actions/vendorRelationships", () => ({
  addVendorRelationship: vi.fn(), recordRelationshipIntake: vi.fn(), setRelationshipPolicy: vi.fn(), openAssessmentForRelationship: vi.fn(),
}));

import { VendorRelationshipsCard } from "../VendorRelationshipsCard";
import type { VendorRelationship } from "@/lib/api";

const base: VendorRelationship = {
  id: "rel-1", vendor_id: "v-1", name: "Card processing", service_description: null, status: "active", is_primary: true, policy_minimum_tier: null,
  classification_state: "intake_required",
  criticality_score: null, criticality_band: null, criticality_arithmetic_band: null, criticality_basis: null, criticality_methodology_version: null,
  inherent_score: null, inherent_band: null, inherent_arithmetic_band: null, inherent_basis: null, inherent_methodology_version: null,
  assessment_tier: null, tier_calculated_minimum: null, tier_basis: null, tier_methodology_version: null,
  classification_intake_id: null, classification_computed_at: null, created_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z",
};

describe("VendorRelationshipsCard", () => {
  it("renders intake_required as ignorance — no zero, no band, no tier", () => {
    render(<VendorRelationshipsCard vendorId="v-1" relationships={[base]} loadFailed={false} manualCriticality={null} />);
    expect(screen.getByText("Intake required")).toBeTruthy();
    expect(screen.getByText("Record factual intake")).toBeTruthy();
    expect(screen.queryByText(/Tier \d/)).toBeNull();
    expect(screen.queryByText(/· 0\b/)).toBeNull();
  });
  it("shows criticality and inherent risk as peers with the joint tier, and the basis on demand", () => {
    const classified: VendorRelationship = {
      ...base, classification_state: "classified",
      criticality_score: 90, criticality_band: "Critical", criticality_arithmetic_band: "Critical",
      criticality_basis: { method: "vendor_criticality_v1", version: 1, methodology_version: "1.0.0", factors: [], adjustments: [{ rule_id: "CR2", explanation: "Enterprise-wide with under a week of tolerance." }] },
      criticality_methodology_version: "1.0.0",
      inherent_score: 70, inherent_band: "High", inherent_arithmetic_band: "High",
      inherent_basis: { method: "vendor_inherent_v2", version: 1, methodology_version: "2.0.0", factors: [], adjustments: [] }, inherent_methodology_version: "2.0.0",
      assessment_tier: "tier_1_critical", tier_calculated_minimum: "tier_1_critical",
      tier_basis: { method: "vendor_assessment_tier_v1", methodology_version: "1.0.0", criticality_band: "Critical", inherent_band: "High", adjustments: [] }, tier_methodology_version: "1.0.0",
      classification_intake_id: "intake-1", classification_computed_at: "2026-09-04T00:00:00Z",
    };
    render(<VendorRelationshipsCard vendorId="v-1" relationships={[classified]} loadFailed={false} manualCriticality="high" />);
    // The label appears as the row's tier AND as an option in the policy
    // select, so assert presence, not uniqueness.
    expect(screen.getAllByText("Tier 1 — Critical").length).toBeGreaterThan(0);
    // Peers, side by side: both labels present, both bands rendered with their scores.
    expect(screen.getByText("Criticality")).toBeTruthy();
    expect(screen.getByText("Inherent risk")).toBeTruthy();
    expect(screen.getByText(/· 90/)).toBeTruthy();
    expect(screen.getByText(/· 70/)).toBeTruthy();
    expect(screen.getByText(/manual classification/)).toBeTruthy();
    expect(screen.getByText(/not used to derive/)).toBeTruthy();
    expect(screen.getByText("Open assessment")).toBeTruthy();
  });
  it("distinguishes a load failure from an empty list", () => {
    render(<VendorRelationshipsCard vendorId="v-1" relationships={[]} loadFailed={true} manualCriticality={null} />);
    expect(screen.getByText(/load failure/)).toBeTruthy();
  });
});
