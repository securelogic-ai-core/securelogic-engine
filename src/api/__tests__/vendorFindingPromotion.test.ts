/**
 * vendorFindingPromotion.test.ts
 *
 * Severity is the output a reviewer acts on, and the failure mode is not
 * "slightly wrong number" — it is a queue they stop trusting. Two ways to get
 * there: inflate everything to Critical so triage is impossible, or flatten
 * everything to Moderate so the dangerous vendor does not stand out.
 */

import { describe, expect, it } from "vitest";

import {
  promoteFindings,
  severityFor,
  type PromotableControl,
} from "../lib/vendorRisk/findingPromotion.js";

function control(over: Partial<PromotableControl> = {}): PromotableControl {
  return {
    requirement_id: "r1",
    reference: "AC-1",
    title: "Access Control Policy",
    status: "fail",
    mandatory: true,
    ...over,
  };
}

describe("what promotes and what does not", () => {
  it("a passing control produces no finding", () => {
    expect(severityFor({ status: "pass", mandatory: true, inherentBand: "Critical" })).toBeNull();
  });

  it("not_applicable produces no finding", () => {
    // Not a gap. It is a question that should not have been asked.
    expect(
      severityFor({ status: "not_applicable", mandatory: true, inherentBand: "Critical" })
    ).toBeNull();
  });

  it("not_assessed DOES promote — an unanswered mandatory control is a gap", () => {
    // The distinction that runs through this whole subsystem. If only failures
    // promoted, a vendor could avoid every finding by answering nothing.
    const result = severityFor({ status: "not_assessed", mandatory: true, inherentBand: "High" });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("Moderate");
  });

  it("partial promotes, below an outright failure", () => {
    const partial = severityFor({ status: "partial", mandatory: true, inherentBand: "High" })!;
    const failed = severityFor({ status: "fail", mandatory: true, inherentBand: "High" })!;
    expect(partial.severity).toBe("Moderate");
    expect(failed.severity).toBe("High");
  });
});

describe("severity depends on the vendor, not only the answer", () => {
  it("the same failure is worse at a Critical-inherent vendor", () => {
    // "No encryption at rest" is Critical at a vendor holding restricted data at
    // mass scale and Moderate at one hosting a brochure site.
    const critical = severityFor({ status: "fail", mandatory: true, inherentBand: "Critical" })!;
    const low = severityFor({ status: "fail", mandatory: true, inherentBand: "Low" })!;
    expect(critical.severity).toBe("Critical");
    expect(low.severity).toBe("Moderate");
  });

  it("a Critical-inherent vendor does NOT have every gap inflated to Critical", () => {
    // The failure mode that makes a queue useless: everything Critical means
    // nothing is.
    const minor = severityFor({ status: "partial", mandatory: false, inherentBand: "Critical" })!;
    expect(minor.severity).toBe("Moderate");
    expect(minor.severity).not.toBe("Critical");
  });

  it("a Low-inherent vendor is capped below High", () => {
    // Their controls cannot expose the organisation to a High outcome, whatever
    // the questionnaire says.
    for (const status of ["fail", "partial", "not_assessed"] as const) {
      const result = severityFor({ status, mandatory: true, inherentBand: "Low" })!;
      expect(["Low", "Moderate"], `${status}`).toContain(result.severity);
    }
  });

  it("mandatory always outranks optional at the same band", () => {
    for (const band of ["Critical", "High", "Moderate", "Low"] as const) {
      const mandatory = severityFor({ status: "fail", mandatory: true, inherentBand: band })!;
      const optional = severityFor({ status: "fail", mandatory: false, inherentBand: band })!;
      const order = ["Low", "Moderate", "High", "Critical"];
      expect(
        order.indexOf(mandatory.severity),
        `${band}: mandatory must be >= optional`
      ).toBeGreaterThanOrEqual(order.indexOf(optional.severity));
    }
  });
});

describe("the rationale explains the severity", () => {
  it("names the lift when the inherent band raised it", () => {
    const result = severityFor({ status: "fail", mandatory: true, inherentBand: "Critical" })!;
    expect(result.rationale).toMatch(/raised to critical/i);
    expect(result.rationale).toMatch(/inherent risk is Critical/);
  });

  it("names the cap when the inherent band lowered it", () => {
    const result = severityFor({ status: "fail", mandatory: true, inherentBand: "Low" })!;
    expect(result.rationale).toMatch(/capped at/i);
    expect(result.rationale).toMatch(/cannot expose the organisation/i);
  });

  it("states the base rating in every case", () => {
    for (const band of ["Critical", "High", "Moderate", "Low"] as const) {
      const result = severityFor({ status: "fail", mandatory: true, inherentBand: band })!;
      expect(result.rationale, band).toMatch(/which rates/i);
      expect(result.rationale, band).not.toMatch(/undefined|\[object/);
    }
  });
});

describe("promoteFindings", () => {
  const controls: PromotableControl[] = [
    control({ requirement_id: "a", reference: "AC-1", status: "pass" }),
    control({ requirement_id: "b", reference: "SC-13", status: "fail", mandatory: true }),
    control({ requirement_id: "c", reference: "CP-9", status: "partial", mandatory: false }),
    control({ requirement_id: "d", reference: "IR-4", status: "not_assessed", mandatory: true }),
    control({ requirement_id: "e", reference: "SC-4", status: "not_applicable" }),
  ];

  it("promotes exactly the controls that represent a gap", () => {
    const findings = promoteFindings({ controls, inherentBand: "High", vendorName: "Acme" });
    expect(findings.map((f) => f.reference).sort()).toEqual(["CP-9", "IR-4", "SC-13"]);
  });

  it("orders most severe first, then by reference for stability", () => {
    // An unstable order makes a re-promotion diff unreadable.
    const first = promoteFindings({ controls, inherentBand: "High", vendorName: "Acme" });
    const second = promoteFindings({ controls, inherentBand: "High", vendorName: "Acme" });
    expect(first).toEqual(second);
    expect(first[0]!.severity).toBe("High");
  });

  it("titles identify the vendor and the control without opening the finding", () => {
    const findings = promoteFindings({ controls, inherentBand: "High", vendorName: "Acme" });
    expect(findings[0]!.title).toContain("Acme");
    expect(findings[0]!.title).toContain(findings[0]!.reference);
  });

  it("quotes the vendor's own words when they gave any", () => {
    const findings = promoteFindings({
      controls: [control({ notes: "Planned for Q3 with our new KMS." })],
      inherentBand: "High",
      vendorName: "Acme",
    });
    expect(findings[0]!.description).toContain("Planned for Q3");
  });

  it("gives an unanswered control a recommendation about ANSWERING it", () => {
    // A generic "remediate this control" would be wrong: nobody has established
    // that the control is missing, only that nobody said.
    const findings = promoteFindings({
      controls: [control({ status: "not_assessed" })],
      inherentBand: "High",
      vendorName: "Acme",
    });
    expect(findings[0]!.recommendation).toMatch(/ask the vendor to answer/i);
  });

  it("every finding carries an actionable recommendation", () => {
    const findings = promoteFindings({ controls, inherentBand: "Critical", vendorName: "Acme" });
    for (const f of findings) {
      expect(f.recommendation.length, f.reference).toBeGreaterThan(20);
      expect(f.severity_rationale).toMatch(/methodology \d+\.\d+\.\d+/);
    }
  });

  it("produces nothing from a fully passing questionnaire", () => {
    const findings = promoteFindings({
      controls: [control({ status: "pass" }), control({ requirement_id: "z", status: "pass" })],
      inherentBand: "Critical",
      vendorName: "Acme",
    });
    expect(findings).toEqual([]);
  });

  it("is a pure function of its inputs", () => {
    const run = () => promoteFindings({ controls, inherentBand: "Critical", vendorName: "Acme" });
    const first = run();
    for (let i = 0; i < 10; i++) expect(run()).toEqual(first);
  });
});
