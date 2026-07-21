import { describe, it, expect } from "vitest";
import {
  describeMatchReason,
  confidenceBand,
  signalHeadline,
} from "../reviewLanguage";

describe("describeMatchReason", () => {
  it("never returns the raw code and never mentions the matcher internals", () => {
    for (const code of ["vendor_name_ilike", "vendor_fuzzy_match", "obligation_domain_match", "cve_match", null, ""]) {
      const out = describeMatchReason(code, "vendor");
      expect(out).not.toContain("_");            // no snake_case code leaked
      expect(out.toLowerCase()).not.toContain("ilike");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("explains name matches in business language", () => {
    expect(describeMatchReason("vendor_name_ilike", "vendor")).toBe(
      "SecureLogic found this vendor's name in the intelligence signal.",
    );
  });

  it("explains fuzzy, cve, and domain matches", () => {
    expect(describeMatchReason("vendor_fuzzy_match", "vendor")).toBe(
      "The signal closely matches this vendor's name.",
    );
    expect(describeMatchReason("cve_match", "control")).toBe(
      "The signal references a CVE associated with this control.",
    );
    expect(describeMatchReason("obligation_domain_match", "obligation")).toBe(
      "The signal affects this obligation's regulatory domain.",
    );
  });

  it("uses the correct business noun per target type", () => {
    expect(describeMatchReason("ai_system_name_ilike", "ai_system")).toContain("AI system");
  });

  it("degrades to an honest generic sentence for unknown/empty codes", () => {
    expect(describeMatchReason(null, "vendor")).toBe("SecureLogic linked this signal to this vendor.");
    expect(describeMatchReason("something_new", "vendor")).toBe(
      "SecureLogic linked this signal to this vendor.",
    );
  });
});

describe("confidenceBand", () => {
  it("maps scores to bands", () => {
    expect(confidenceBand(85)).toEqual({ label: "High confidence", tone: "high" });
    expect(confidenceBand(70)).toEqual({ label: "High confidence", tone: "high" });
    expect(confidenceBand(55)).toEqual({ label: "Medium confidence", tone: "medium" });
    expect(confidenceBand(40)).toEqual({ label: "Medium confidence", tone: "medium" });
    expect(confidenceBand(20)).toEqual({ label: "Low confidence", tone: "low" });
    expect(confidenceBand(0)).toEqual({ label: "Low confidence", tone: "low" });
  });

  it("returns null for unknown scores (never invents a level)", () => {
    expect(confidenceBand(null)).toBeNull();
    expect(confidenceBand(undefined)).toBeNull();
    expect(confidenceBand(NaN)).toBeNull();
  });
});

describe("signalHeadline", () => {
  it("uses the intelligence event title when present", () => {
    expect(signalHeadline("Critical RCE in Acme Gateway")).toBe("Critical RCE in Acme Gateway");
  });

  it("never exposes a raw UUID — falls back to a neutral label when the title is missing", () => {
    expect(signalHeadline(null)).toBe("External intelligence signal");
    expect(signalHeadline(undefined)).toBe("External intelligence signal");
    expect(signalHeadline("   ")).toBe("External intelligence signal");
  });
});
