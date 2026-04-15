/**
 * cisaAlertsAdapter.test.ts — Unit tests for CISA Alerts RSS adapter.
 *
 * All tests are pure — no I/O, no network, no DB.
 * Tests cover: signal_type derivation, severity derivation, CVE extraction,
 * vendor extraction, normalizedSummary building, and the full mapAlertItemToSignal
 * pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  deriveAlertSignalType,
  deriveAlertSeverity,
  extractCveFromText,
  extractVendorFromTitle,
  buildAlertNormalizedSummary,
  mapAlertItemToSignal,
  extractRssItems,
  extractXmlField,
  type CisaAlertItem
} from "../lib/cisaAlertsAdapter.js";

// ---------------------------------------------------------------------------
// deriveAlertSignalType
// ---------------------------------------------------------------------------

describe("deriveAlertSignalType", () => {
  it("returns threat_actor for ransomware in title", () => {
    expect(deriveAlertSignalType("CISA Warns of LockBit Ransomware Campaign")).toBe("threat_actor");
  });

  it("returns threat_actor for nation keyword", () => {
    expect(deriveAlertSignalType("Nation-State Actors Target Critical Infrastructure")).toBe("threat_actor");
  });

  it("returns threat_actor for apt keyword", () => {
    expect(deriveAlertSignalType("CISA Releases Advisory on APT Techniques")).toBe("threat_actor");
  });

  it("returns threat_actor for state-sponsored keyword", () => {
    expect(deriveAlertSignalType("State-Sponsored Group Exploits Ivanti VPN")).toBe("threat_actor");
  });

  it("returns patch_advisory for advisory keyword", () => {
    expect(deriveAlertSignalType("Cisco Advisory: Remote Code Execution in IOS XE")).toBe("patch_advisory");
  });

  it("returns patch_advisory for alert keyword", () => {
    expect(deriveAlertSignalType("CISA Alert: Exploitation of Fortinet Vulnerability")).toBe("patch_advisory");
  });

  it("returns patch_advisory as default", () => {
    expect(deriveAlertSignalType("Multiple Vulnerabilities in Industrial Control Systems")).toBe("patch_advisory");
  });

  it("is case-insensitive", () => {
    expect(deriveAlertSignalType("NEW RANSOMWARE VARIANT DETECTED")).toBe("threat_actor");
    expect(deriveAlertSignalType("CISCO ADVISORY")).toBe("patch_advisory");
  });
});

// ---------------------------------------------------------------------------
// deriveAlertSeverity
// ---------------------------------------------------------------------------

describe("deriveAlertSeverity", () => {
  it("returns Critical when title contains 'critical'", () => {
    expect(deriveAlertSeverity("Critical Vulnerability in Palo Alto GlobalProtect")).toBe("Critical");
  });

  it("returns Critical when title contains 'actively exploited'", () => {
    expect(deriveAlertSeverity("CISA Adds Actively Exploited Ivanti Zero-Day to KEV")).toBe("Critical");
  });

  it("returns High as default", () => {
    expect(deriveAlertSeverity("Cisco Releases Security Advisory for IOS Software")).toBe("High");
  });

  it("returns High for ransomware title (not critical/actively exploited)", () => {
    expect(deriveAlertSeverity("Ransomware Group Targets Healthcare Sector")).toBe("High");
  });

  it("is case-insensitive", () => {
    expect(deriveAlertSeverity("CRITICAL REMOTE CODE EXECUTION FLAW")).toBe("Critical");
    expect(deriveAlertSeverity("ACTIVELY EXPLOITED ZERO-DAY")).toBe("Critical");
  });
});

// ---------------------------------------------------------------------------
// extractCveFromText
// ---------------------------------------------------------------------------

describe("extractCveFromText", () => {
  it("extracts CVE ID from description text", () => {
    expect(extractCveFromText("This advisory covers CVE-2024-21762 in Fortinet.")).toBe("CVE-2024-21762");
  });

  it("normalizes to uppercase", () => {
    expect(extractCveFromText("cve-2023-44487 http/2 rapid reset")).toBe("CVE-2023-44487");
  });

  it("returns null when no CVE is present", () => {
    expect(extractCveFromText("No specific vulnerability identifier provided.")).toBeNull();
  });

  it("extracts the first CVE when multiple are present", () => {
    expect(extractCveFromText("Affecting CVE-2024-1234 and CVE-2024-5678")).toBe("CVE-2024-1234");
  });

  it("handles CVE IDs with 5+ digit suffixes", () => {
    expect(extractCveFromText("CVE-2021-44228 Log4Shell")).toBe("CVE-2021-44228");
  });

  it("returns null for empty string", () => {
    expect(extractCveFromText("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractVendorFromTitle
// ---------------------------------------------------------------------------

describe("extractVendorFromTitle", () => {
  it("matches Cisco in title", () => {
    expect(extractVendorFromTitle("Cisco IOS XE Vulnerability Allows Remote Code Execution")).toBe("Cisco");
  });

  it("matches Fortinet in title", () => {
    expect(extractVendorFromTitle("Fortinet FortiOS Authentication Bypass")).toBe("Fortinet");
  });

  it("matches Palo Alto in title", () => {
    expect(extractVendorFromTitle("Palo Alto Networks GlobalProtect VPN Zero-Day")).toBe("Palo Alto");
  });

  it("matches Ivanti in title", () => {
    expect(extractVendorFromTitle("Ivanti Connect Secure Actively Exploited")).toBe("Ivanti");
  });

  it("returns null when no known vendor found", () => {
    expect(extractVendorFromTitle("Multiple Vulnerabilities in Unspecified Web Server")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractVendorFromTitle("CISCO ADVISORY")).toBe("Cisco");
    expect(extractVendorFromTitle("fortinet product line update")).toBe("Fortinet");
  });

  it("returns first match when multiple vendors appear", () => {
    // Microsoft appears before Cisco alphabetically in our list
    const result = extractVendorFromTitle("Microsoft Azure and Cisco Intersect on CVE");
    expect(["Microsoft", "Cisco"]).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// buildAlertNormalizedSummary
// ---------------------------------------------------------------------------

describe("buildAlertNormalizedSummary", () => {
  it("uses title only when description is null", () => {
    expect(buildAlertNormalizedSummary("Cisco Advisory", null)).toBe("Cisco Advisory");
  });

  it("combines title and description", () => {
    const summary = buildAlertNormalizedSummary("Cisco Advisory", "This is a description.");
    expect(summary).toBe("Cisco Advisory — This is a description.");
  });

  it("truncates description to 300 chars", () => {
    const longDesc = "A".repeat(400);
    const summary = buildAlertNormalizedSummary("Title", longDesc);
    // description should be capped at 300
    expect(summary).toContain("Title — " + "A".repeat(300));
  });

  it("caps total summary at 500 chars and appends ellipsis", () => {
    const longTitle = "T".repeat(300);
    const longDesc = "D".repeat(300);
    const summary = buildAlertNormalizedSummary(longTitle, longDesc);
    expect(summary.length).toBe(500);
    expect(summary.endsWith("...")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapAlertItemToSignal
// ---------------------------------------------------------------------------

describe("mapAlertItemToSignal", () => {
  const baseItem: CisaAlertItem = {
    title: "CISA Advisory: Cisco IOS XE Web UI Vulnerability",
    description: "CISA has issued an advisory regarding CVE-2023-20198 in Cisco IOS XE.",
    link: "https://www.cisa.gov/advisories/aa23-001",
    guid: "aa23-001"
  };

  it("returns a signal with correct source", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.source).toBe("cisa_alerts");
  });

  it("derives patch_advisory signal_type for advisory title", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.signal_type).toBe("patch_advisory");
  });

  it("derives threat_actor for ransomware title", () => {
    const item: CisaAlertItem = {
      ...baseItem,
      title: "CISA Warns of LockBit Ransomware Targeting Healthcare"
    };
    expect(mapAlertItemToSignal(item)?.signal_type).toBe("threat_actor");
  });

  it("derives High severity by default", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.severity).toBe("High");
  });

  it("derives Critical severity for 'critical' in title", () => {
    const item: CisaAlertItem = {
      ...baseItem,
      title: "Critical Authentication Bypass in Cisco IOS XE"
    };
    expect(mapAlertItemToSignal(item)?.severity).toBe("Critical");
  });

  it("extracts CVE from description", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.affected_cve).toBe("CVE-2023-20198");
  });

  it("extracts CVE from title when not in description", () => {
    const item: CisaAlertItem = {
      ...baseItem,
      title: "CVE-2024-9999 Exploited in the Wild",
      description: "No CVE in this description."
    };
    expect(mapAlertItemToSignal(item)?.affected_cve).toBe("CVE-2024-9999");
  });

  it("extracts vendor from title", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.affected_vendor).toBe("Cisco");
  });

  it("returns null when title is empty", () => {
    const item: CisaAlertItem = { ...baseItem, title: "" };
    expect(mapAlertItemToSignal(item)).toBeNull();
  });

  it("sets affected_cve to null when no CVE in title or description", () => {
    const item: CisaAlertItem = {
      ...baseItem,
      title: "ICS Advisory: Multiple Vulnerabilities in SCADA Systems",
      description: "General advisory with no specific CVE identifier."
    };
    expect(mapAlertItemToSignal(item)?.affected_cve).toBeNull();
  });

  it("includes link and guid in raw_payload", () => {
    const signal = mapAlertItemToSignal(baseItem);
    expect(signal?.raw_payload.link).toBe("https://www.cisa.gov/advisories/aa23-001");
    expect(signal?.raw_payload.guid).toBe("aa23-001");
  });
});

// ---------------------------------------------------------------------------
// extractRssItems (XML parsing)
// ---------------------------------------------------------------------------

describe("extractRssItems", () => {
  it("extracts items from RSS XML", () => {
    const xml = `
      <rss><channel>
        <item><title>First</title></item>
        <item><title>Second</title></item>
      </channel></rss>
    `;
    expect(extractRssItems(xml)).toHaveLength(2);
  });

  it("returns empty array for XML with no items", () => {
    expect(extractRssItems("<rss><channel></channel></rss>")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractXmlField
// ---------------------------------------------------------------------------

describe("extractXmlField", () => {
  it("extracts plain text content", () => {
    expect(extractXmlField("<title>Cisco Advisory</title>", "title")).toBe("Cisco Advisory");
  });

  it("extracts CDATA content", () => {
    expect(
      extractXmlField("<description><![CDATA[Contains <html> markup]]></description>", "description")
    ).toBe("Contains <html> markup");
  });

  it("returns null when tag is absent", () => {
    expect(extractXmlField("<title>Test</title>", "description")).toBeNull();
  });

  it("handles nested tags by returning inner text up to closing tag", () => {
    const result = extractXmlField("<link>https://example.com</link>", "link");
    expect(result).toBe("https://example.com");
  });
});
