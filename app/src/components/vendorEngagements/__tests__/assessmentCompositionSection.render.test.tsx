/**
 * AssessmentCompositionSection — the customer sees what SecureLogic selected
 * and why before anything is sent (goal §G).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssessmentCompositionSection from "../AssessmentCompositionSection";
import type { VendorEngagementComposition } from "@/lib/api";

const base: VendorEngagementComposition = {
  id: "snap-1",
  hash: "a".repeat(64),
  snapshot_version: "composition-snapshot-1.0",
  scope_rule_version: "1.2.0",
  tier: "tier_2_high",
  core_assurance_version: "1.0",
  resolved_at: "2026-09-04T10:00:00.000Z",
  summary: {
    asked: 18, asked_full: 17, asked_confirm: 0, asked_attest: 1, evidence_satisfied: 1,
    core_applicable: 14, core_not_applicable: 2, core_missing: 0, additional_asked: 5, excluded_by_rules: 30,
    truncated: null, nominal_target: 120, mandatory_overage: 0, no_questionnaire_required: false,
  },
  domains: [
    { domain: "security", asked: 15, evidence_satisfied: 1 },
    { domain: "resilience", asked: 3, evidence_satisfied: 0 },
  ],
  core_assurance: {
    version: "1.0",
    framework_key: "securelogic-core-assurance",
    objectives: [
      {
        reference: "CAS-06", title: "Access authorized on business need and least privilege", requirement_id: "r-6",
        outcome: "asked", depth: "full", domain: "security", rule_id: "S1.core.cas_06",
        rationale: "The vendor holds your information or reaches your systems, so how access to it is authorized is assessed.",
        basis: { signals: { handles_data: true } }, evidence: null,
        reasons: [{ rule_id: "S1.core.cas_06", rule_family: "S1", rationale: "…" }],
      },
      {
        reference: "CAS-11", title: "Identification and management of material subcontractors, sub-processors and fourth parties", requirement_id: "r-11",
        outcome: "not_applicable", depth: null, domain: null, rule_id: "S1.core.cas_11",
        rationale: "No material subcontractors, sub-processors or third-party models are declared for this service, so fourth-party management is not assessed.",
        basis: { signals: { fourth_parties: false } }, evidence: null, reasons: [],
      },
      {
        reference: "CAS-14", title: "Protection of customer and sensitive information in transit and at rest", requirement_id: "r-14",
        outcome: "evidence_satisfied", depth: "confirm", domain: "security", rule_id: "S1.core.cas_14",
        rationale: "The vendor handles your information, so how it is protected in transit and at rest is assessed.",
        basis: null, evidence: { determination_id: "d-1", valid_until: "2027-01-31" },
        reasons: [{ rule_id: "S4.assurance", rule_family: "S4", rationale: "Covered by an approved report." }],
      },
    ],
  },
  additional: [
    {
      requirement_id: "r-cc61", reference: "CC6.1", title: "Logical access security", framework: "SOC 2 Type II", framework_key: "soc2",
      domain: "security", depth: "full", outcome: "asked", evidence: null,
      reasons: [{ rule_id: "S2.access", rule_family: "S2", rationale: "The vendor can change data in your systems, so access control is in scope." }],
    },
  ],
  dropped: [],
  coverage: { computed: true, applied: true, version: "assurance-coverage-1.1", as_of: "2026-09-04", covered_count: 1, gap_count: 0 },
};

describe("AssessmentCompositionSection", () => {
  it("shows the headline, domains, every core objective with its outcome and reason, and the added requirements", () => {
    render(<AssessmentCompositionSection composition={base} loadFailed={false} state="scoped" />);
    expect(screen.getByText("Assessment composition")).toBeTruthy();
    expect(screen.getByText("Questions").nextSibling?.textContent).toBe("18");
    expect(screen.getAllByText("Satisfied by evidence", { selector: "span" })[0]!.nextSibling?.textContent).toBe("1");
    expect(screen.getByText(/Applicable domains:/).textContent).toContain("Security 15");
    expect(screen.getByText(/Applicable domains:/).textContent).toContain("Resilience 3");
    expect(screen.getByText(/14 of 3 apply/)).toBeTruthy();
    expect(screen.getByText(/how access to it is authorized is assessed/)).toBeTruthy();
    expect(screen.getAllByText("Not applicable", { selector: "span" }).length).toBeGreaterThan(1);
    expect(screen.getByText(/fourth-party management is not assessed/)).toBeTruthy();
    expect(screen.getAllByText("Satisfied by evidence").length).toBeGreaterThan(1);
    expect(screen.getByText(/evidence valid until 2027-01-31/)).toBeTruthy();
    expect(screen.getByText(/already covered by approved, in-validity independent assurance/)).toBeTruthy();
    expect(screen.getByText(/Added for this relationship · 1/)).toBeTruthy();
    expect(screen.getByText(/CC6.1 · Logical access security/)).toBeTruthy();
    expect(screen.getByText(/access control is in scope/)).toBeTruthy();
    // no scoring machinery leaks
    expect(document.body.textContent).not.toMatch(/weight|contribution/i);
  });

  it("renders the honest 'no formal questionnaire' result with every objective explained", () => {
    const nominal: VendorEngagementComposition = {
      ...base,
      summary: { ...base.summary, asked: 0, asked_full: 0, asked_attest: 0, evidence_satisfied: 0, core_applicable: 0, core_not_applicable: 16, additional_asked: 0, no_questionnaire_required: true },
      domains: [],
      additional: [],
      core_assurance: { ...base.core_assurance!, objectives: base.core_assurance!.objectives.map((o) => ({ ...o, outcome: "not_applicable", depth: null })) },
    };
    render(<AssessmentCompositionSection composition={nominal} loadFailed={false} state="scoped" />);
    expect(screen.getByText("No formal questionnaire is required for this relationship.")).toBeTruthy();
    // three objective chips (+ the headline stat is absent in the no-questionnaire layout)
    expect(screen.getAllByText("Not applicable", { selector: "span" })).toHaveLength(3);
  });

  it("WA-2: shows what was NOT asked — coverage, rule exclusions, and the dropped list", () => {
    // All three were carried by the snapshot and rendered nowhere before WA-2.
    // A composition that only shows what it kept cannot be defended.
    render(
      <AssessmentCompositionSection
        composition={{
          ...base,
          summary: { ...base.summary, truncated: { cap: 20, dropped: 2 } },
          dropped: [
            { requirement_id: "r-90", reference: "CC7.2", title: "Monitoring of system components", framework: "SOC 2" },
            { requirement_id: "r-91", reference: "A.8.16", title: "Monitoring activities", framework: "ISO 27001" },
          ],
          coverage: { computed: true, applied: true, version: "assurance-coverage-1.1", as_of: "2026-09-04", covered_count: 3, gap_count: 2 },
        }}
        loadFailed={false}
        state="scoped"
      />
    );
    expect(screen.getByText(/Independent assurance coverage/)).toBeTruthy();
    expect(screen.getByText(/3 covered/)).toBeTruthy();
    expect(screen.getByText(/2 gaps/)).toBeTruthy();
    expect(screen.getByText(/30 requirements in the library were excluded/)).toBeTruthy();
    // The tier cap says HOW MANY; the disclosure says WHICH.
    expect(screen.getByText(/2 lower-priority requirements exceeded/)).toBeTruthy();
    expect(screen.getByText(/CC7.2 · Monitoring of system components/)).toBeTruthy();
    expect(screen.getByText(/A.8.16 · Monitoring activities/)).toBeTruthy();
  });

  it("WA-2: says nothing about coverage that was never computed", () => {
    render(
      <AssessmentCompositionSection
        composition={{
          ...base,
          summary: { ...base.summary, excluded_by_rules: 0 },
          coverage: { computed: false, applied: false, version: null, as_of: null, covered_count: 0, gap_count: 0 },
        }}
        loadFailed={false}
        state="scoped"
      />
    );
    // "0 covered, 0 gaps" would read as a clean result rather than as an
    // absent one — the same distinction analysisCoverageCopy exists to keep.
    expect(screen.queryByText(/Independent assurance coverage/)).toBeNull();
    expect(screen.queryByText(/excluded because no rule/)).toBeNull();
  });

  it("explains the not-yet-composed and load-failed states", () => {
    const { unmount } = render(<AssessmentCompositionSection composition={null} loadFailed={false} state="draft" />);
    expect(screen.getByText(/Compose the assessment to see what SecureLogic selects/)).toBeTruthy();
    unmount();
    render(<AssessmentCompositionSection composition={null} loadFailed={true} state="draft" />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });
});
