import { describe, it, expect } from "vitest";
import { buildSignalPrompt, GENERIC_QUALITY_GATE_PHRASES } from "../llmClient.js";

// ---------------------------------------------------------------------------
// buildSignalPrompt — content excerpt length
// ---------------------------------------------------------------------------

describe("buildSignalPrompt — content truncation", () => {
  it("includes up to 3000 characters of content", () => {
    const longContent = "X".repeat(5000);
    const prompt = buildSignalPrompt("Test signal", longContent, "SECURITY_INCIDENT", "test-source");
    // The excerpt in the prompt must not exceed 3000 chars of the original content
    expect(prompt).toContain("X".repeat(3000));
    expect(prompt).not.toContain("X".repeat(3001));
  });

  it("includes full content when under 3000 characters", () => {
    const shortContent = "A".repeat(800);
    const prompt = buildSignalPrompt("Test signal", shortContent, "SECURITY_INCIDENT", "test-source");
    expect(prompt).toContain("A".repeat(800));
  });
});

// ---------------------------------------------------------------------------
// buildSignalPrompt — riskLevel urgency injection
// ---------------------------------------------------------------------------

describe("buildSignalPrompt — riskLevel urgency", () => {
  it("injects urgency instruction for CRITICAL signals", () => {
    const prompt = buildSignalPrompt(
      "Zero-day in Cisco IOS",
      "Active exploitation confirmed",
      "SECURITY_INCIDENT",
      "CISA",
      null,
      "Cisco",
      "critical"
    );
    expect(prompt).toContain("CRITICAL");
    expect(prompt.toLowerCase()).toContain("do not qualify");
  });

  it("injects urgency instruction for HIGH signals", () => {
    const prompt = buildSignalPrompt(
      "Fortinet RCE CVE-2025-99999",
      "Unauthenticated RCE in FortiOS",
      "SECURITY_INCIDENT",
      "fortinet-psirt",
      "CVE-2025-99999",
      "Fortinet",
      "high"
    );
    expect(prompt).toContain("HIGH");
    expect(prompt.toLowerCase()).toContain("do not qualify");
  });

  it("does NOT inject urgency for MEDIUM signals", () => {
    const prompt = buildSignalPrompt(
      "AI Act compliance deadline",
      "EU AI Act enforcement guidance released",
      "REGULATION",
      "eu-commission",
      null,
      null,
      "medium"
    );
    expect(prompt).not.toMatch(/do not qualify|do not soften/i);
  });

  it("does NOT inject urgency when riskLevel is absent", () => {
    const prompt = buildSignalPrompt(
      "Generic signal",
      "Some content",
      "GENERAL",
      "unknown-source"
    );
    expect(prompt).not.toMatch(/do not qualify|do not soften/i);
  });
});

// ---------------------------------------------------------------------------
// buildSignalPrompt — authoritative source note
// ---------------------------------------------------------------------------

describe("buildSignalPrompt — authoritative source", () => {
  it("includes source authority note for CISA", () => {
    const prompt = buildSignalPrompt(
      "CISA KEV entry",
      "Known exploited vulnerability added to catalog",
      "SECURITY_INCIDENT",
      "cisa-kev"
    );
    expect(prompt.toLowerCase()).toContain("authoritative");
    expect(prompt).toContain("cisa-kev");
  });

  it("includes source authority note for NVD", () => {
    const prompt = buildSignalPrompt(
      "NVD CVE entry",
      "CVE-2025-12345 published",
      "SECURITY_INCIDENT",
      "nvd.nist.gov",
      "CVE-2025-12345"
    );
    expect(prompt.toLowerCase()).toContain("authoritative");
  });

  it("does NOT include authority note for non-authoritative sources", () => {
    const prompt = buildSignalPrompt(
      "Bleeping Computer article",
      "Ransomware campaign reported",
      "SECURITY_INCIDENT",
      "bleeping-computer"
    );
    expect(prompt.toLowerCase()).not.toContain("authoritative");
  });
});

// ---------------------------------------------------------------------------
// GENERIC_QUALITY_GATE_PHRASES — coverage of new additions
// ---------------------------------------------------------------------------

describe("GENERIC_QUALITY_GATE_PHRASES", () => {
  const newPhrases = [
    "organizations should be aware",
    "this development may",
    "this development reflects",
    "may affect enterprise",
    "highlights the need",
    "highlights the importance",
    "demonstrates the importance",
    "could potentially",
    "security teams should review",
    "organizations should review",
    "should consider reviewing",
    "underscores the importance",
    "serves as a reminder"
  ];

  for (const phrase of newPhrases) {
    it(`blocks generic phrase: "${phrase}"`, () => {
      expect(GENERIC_QUALITY_GATE_PHRASES).toContain(phrase);
    });
  }

  it("retains the original blocking phrases", () => {
    expect(GENERIC_QUALITY_GATE_PHRASES).toContain("validate applicability");
    expect(GENERIC_QUALITY_GATE_PHRASES).toContain("review your controls");
    expect(GENERIC_QUALITY_GATE_PHRASES).toContain("risk posture and should be evaluated");
  });
});
