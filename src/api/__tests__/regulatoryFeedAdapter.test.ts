/**
 * regulatoryFeedAdapter.test.ts — Unit tests for regulatory feed adapter.
 *
 * All tests are pure — no I/O, no network, no DB.
 * Tests cover: relevance filtering (irrelevant items skipped), severity
 * derivation, summary building, and the full mapRegulatoryItemToSignal pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  isRegulatoryItemRelevant,
  deriveRegulatorySeverity,
  buildRegulatoryNormalizedSummary,
  mapRegulatoryItemToSignal,
  RELEVANCE_KEYWORDS,
  type RegulatoryFeedItem
} from "../lib/regulatoryFeedAdapter.js";

// ---------------------------------------------------------------------------
// isRegulatoryItemRelevant
// ---------------------------------------------------------------------------

describe("isRegulatoryItemRelevant", () => {
  it("returns true when title contains 'cybersecurity'", () => {
    expect(isRegulatoryItemRelevant("NIST Releases Cybersecurity Framework 2.0", null)).toBe(true);
  });

  it("returns true when title contains 'data'", () => {
    expect(isRegulatoryItemRelevant("FTC Updates Data Protection Requirements", null)).toBe(true);
  });

  it("returns true when title contains 'privacy'", () => {
    expect(isRegulatoryItemRelevant("New Privacy Rule for Health Information Exchange", null)).toBe(true);
  });

  it("returns true when title contains 'breach'", () => {
    expect(isRegulatoryItemRelevant("FTC Enforcement Action Following Major Breach", null)).toBe(true);
  });

  it("returns true when title contains 'security'", () => {
    expect(isRegulatoryItemRelevant("Security Standards Update for Financial Institutions", null)).toBe(true);
  });

  it("returns true when title contains 'cyber'", () => {
    expect(isRegulatoryItemRelevant("White House Cyber Strategy Released", null)).toBe(true);
  });

  it("returns true when title contains 'ransomware'", () => {
    expect(isRegulatoryItemRelevant("FTC Issues Ransomware Guidance for Businesses", null)).toBe(true);
  });

  it("returns true when title contains 'risk'", () => {
    expect(isRegulatoryItemRelevant("NIST SP 800-30 Risk Assessment Framework Updated", null)).toBe(true);
  });

  it("returns true when title contains 'compliance'", () => {
    expect(isRegulatoryItemRelevant("New Compliance Requirements for AI Systems", null)).toBe(true);
  });

  it("returns false for completely irrelevant item", () => {
    expect(isRegulatoryItemRelevant("NIST Announces New Materials Science Research Grant", null)).toBe(false);
  });

  it("returns false for FTC consumer product recall (no keywords)", () => {
    expect(isRegulatoryItemRelevant("FTC Action Against Deceptive Marketing in Dietary Supplements", null)).toBe(false);
  });

  it("returns true when keyword is only in description (not title)", () => {
    expect(
      isRegulatoryItemRelevant(
        "NIST Publishes New Research Results",
        "This publication covers cybersecurity measurement approaches."
      )
    ).toBe(true);
  });

  it("returns false when neither title nor description contain keywords", () => {
    expect(
      isRegulatoryItemRelevant(
        "New Publication on Metrology Standards",
        "This covers measurement calibration procedures."
      )
    ).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isRegulatoryItemRelevant("CYBERSECURITY FRAMEWORK UPDATE", null)).toBe(true);
    expect(isRegulatoryItemRelevant("FTC DATA PROTECTION RULE", null)).toBe(true);
  });

  it("RELEVANCE_KEYWORDS contains expected keywords", () => {
    expect(RELEVANCE_KEYWORDS).toContain("cybersecurity");
    expect(RELEVANCE_KEYWORDS).toContain("privacy");
    expect(RELEVANCE_KEYWORDS).toContain("breach");
    expect(RELEVANCE_KEYWORDS).toContain("compliance");
    expect(RELEVANCE_KEYWORDS).toContain("ransomware");
  });
});

// ---------------------------------------------------------------------------
// deriveRegulatorySeverity
// ---------------------------------------------------------------------------

describe("deriveRegulatorySeverity", () => {
  it("returns High for 'final rule' in title", () => {
    expect(deriveRegulatorySeverity("FTC Issues Final Rule on Data Security for Financial Institutions")).toBe("High");
  });

  it("returns High for 'enforcement' in title", () => {
    expect(deriveRegulatorySeverity("FTC Enforcement Action Against Company for Security Failures")).toBe("High");
  });

  it("returns High for 'breach' in title", () => {
    expect(deriveRegulatorySeverity("New Mandatory Breach Notification Requirements for Healthcare")).toBe("High");
  });

  it("returns Moderate as default", () => {
    expect(deriveRegulatorySeverity("NIST Updates Cybersecurity Framework with AI Guidance")).toBe("Moderate");
  });

  it("returns Moderate for informational guidance", () => {
    expect(deriveRegulatorySeverity("NIST Publishes Draft SP 800-218A for Secure Software Development")).toBe("Moderate");
  });

  it("is case-insensitive", () => {
    expect(deriveRegulatorySeverity("FTC FINAL RULE ON DATA PROTECTION")).toBe("High");
    expect(deriveRegulatorySeverity("ENFORCEMENT ACTION AGAINST VIOLATOR")).toBe("High");
  });
});

// ---------------------------------------------------------------------------
// buildRegulatoryNormalizedSummary
// ---------------------------------------------------------------------------

describe("buildRegulatoryNormalizedSummary", () => {
  it("uses title only when description is null", () => {
    expect(buildRegulatoryNormalizedSummary("NIST CSF 2.0 Released", null)).toBe("NIST CSF 2.0 Released");
  });

  it("combines title and description", () => {
    const result = buildRegulatoryNormalizedSummary("NIST CSF 2.0", "Major update to the framework.");
    expect(result).toBe("NIST CSF 2.0 — Major update to the framework.");
  });

  it("truncates description to 300 chars", () => {
    const longDesc = "A".repeat(400);
    const result = buildRegulatoryNormalizedSummary("Title", longDesc);
    expect(result).toContain("A".repeat(300));
    expect(result).not.toContain("A".repeat(301));
  });

  it("caps total at 500 chars with ellipsis", () => {
    const title = "T".repeat(300);
    const desc = "D".repeat(300);
    const result = buildRegulatoryNormalizedSummary(title, desc);
    expect(result.length).toBe(500);
    expect(result.endsWith("...")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapRegulatoryItemToSignal
// ---------------------------------------------------------------------------

describe("mapRegulatoryItemToSignal", () => {
  const relevantNistItem: RegulatoryFeedItem = {
    title: "NIST Releases Cybersecurity Framework 2.0",
    description: "The National Institute of Standards and Technology has published version 2.0 of the Cybersecurity Framework, expanding guidance for organizations.",
    link: "https://www.nist.gov/news/csf-2",
    guid: "nist-csf-2-release",
    pubDate: "Wed, 26 Feb 2024 09:00:00 +0000"
  };

  const irrelevantItem: RegulatoryFeedItem = {
    title: "NIST Awards Research Grant for Quantum Computing Materials",
    description: "The award supports development of new superconducting qubit materials.",
    link: "https://www.nist.gov/news/quantum-grant",
    guid: "nist-quantum-grant",
    pubDate: "Tue, 13 Feb 2024 09:00:00 +0000"
  };

  it("maps relevant item to regulatory_change signal type", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.signal_type).toBe("regulatory_change");
  });

  it("uses the provided source slug", () => {
    const nistSignal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(nistSignal?.source).toBe("nist_news");

    const ftcItem: RegulatoryFeedItem = { ...relevantNistItem, title: "FTC Cybersecurity Enforcement Action" };
    const ftcSignal = mapRegulatoryItemToSignal(ftcItem, "ftc_news");
    expect(ftcSignal?.source).toBe("ftc_news");
  });

  it("sets affected_vendor to null (regulatory signals are org-wide)", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.affected_vendor).toBeNull();
  });

  it("sets affected_cve to null", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.affected_cve).toBeNull();
  });

  it("derives Moderate severity by default", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.severity).toBe("Moderate");
  });

  it("derives High severity for enforcement action", () => {
    const item: RegulatoryFeedItem = {
      ...relevantNistItem,
      title: "FTC Enforcement Action Against Company for Security Data Failures"
    };
    expect(mapRegulatoryItemToSignal(item, "ftc_news")?.severity).toBe("High");
  });

  it("derives High severity for final rule", () => {
    const item: RegulatoryFeedItem = {
      ...relevantNistItem,
      title: "FTC Publishes Final Rule on Data Security Requirements"
    };
    expect(mapRegulatoryItemToSignal(item, "ftc_news")?.severity).toBe("High");
  });

  it("returns null for irrelevant item (no keyword match)", () => {
    expect(mapRegulatoryItemToSignal(irrelevantItem, "nist_news")).toBeNull();
  });

  it("returns null when title is empty", () => {
    const item: RegulatoryFeedItem = { ...relevantNistItem, title: "" };
    expect(mapRegulatoryItemToSignal(item, "nist_news")).toBeNull();
  });

  it("includes link and guid in raw_payload", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.raw_payload.link).toBe(relevantNistItem.link);
    expect(signal?.raw_payload.guid).toBe(relevantNistItem.guid);
  });

  it("builds normalized_summary from title and description", () => {
    const signal = mapRegulatoryItemToSignal(relevantNistItem, "nist_news");
    expect(signal?.normalized_summary).toContain("NIST Releases Cybersecurity Framework 2.0");
    expect(signal?.normalized_summary).toContain("National Institute");
  });

  it("handles item where keyword only appears in description", () => {
    const item: RegulatoryFeedItem = {
      title: "FTC Publishes New Research on Online Markets",
      description: "The research covers cybersecurity implications of algorithmic pricing.",
      link: "https://www.ftc.gov/news/online-markets",
      guid: "ftc-online-markets",
      pubDate: null
    };
    // keyword 'cybersecurity' is in description only
    expect(mapRegulatoryItemToSignal(item, "ftc_news")).not.toBeNull();
    expect(mapRegulatoryItemToSignal(item, "ftc_news")?.signal_type).toBe("regulatory_change");
  });
});
