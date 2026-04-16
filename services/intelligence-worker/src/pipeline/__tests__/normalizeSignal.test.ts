import { describe, it, expect } from "vitest";
import { extractCve, extractVendor, normalizeSignal } from "../normalizeSignal.js";
import type { SignalIngestedEvent } from "../../types/events.js";

// ---------------------------------------------------------------------------
// extractCve
// ---------------------------------------------------------------------------

describe("extractCve", () => {
  it("extracts a standard CVE identifier", () => {
    expect(extractCve("Patch released for CVE-2025-12345 in OpenSSL")).toBe("CVE-2025-12345");
  });

  it("extracts CVE with 5-digit sequence", () => {
    expect(extractCve("Active exploitation of CVE-2024-99999 confirmed")).toBe("CVE-2024-99999");
  });

  it("is case-insensitive and normalises to upper case", () => {
    expect(extractCve("cve-2023-4567 affects multiple products")).toBe("CVE-2023-4567");
  });

  it("returns null when no CVE is present", () => {
    expect(extractCve("Microsoft releases patch for remote code execution vulnerability")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractCve("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractVendor
// ---------------------------------------------------------------------------

describe("extractVendor", () => {
  it("finds a known vendor in the text", () => {
    const result = extractVendor("Microsoft fixes zero-day in Windows kernel");
    expect(result).toBe("Microsoft");
  });

  it("finds a multi-word vendor", () => {
    const result = extractVendor("Palo Alto Networks issues advisory for PAN-OS");
    expect(result).toBe("Palo Alto");
  });

  it("returns null when no known vendor is present", () => {
    expect(extractVendor("Unknown startup ships new EDR product")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractVendor("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeSignal — summary truncation and field population
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<SignalIngestedEvent> = {}): SignalIngestedEvent {
  return {
    eventType: "signal.ingested",
    signalId: "sig-1",
    title: "Test signal",
    source: "test-source",
    url: "https://example.com",
    payload: "A".repeat(4000),
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

describe("normalizeSignal", () => {
  it("truncates summary to 2000 characters", () => {
    const event = makeEvent({ payload: "X".repeat(4000) });
    const signal = normalizeSignal(event);
    expect(signal.summary.length).toBe(2000);
  });

  it("preserves full raw content without truncation", () => {
    const content = "Y".repeat(4000);
    const event = makeEvent({ payload: content });
    const signal = normalizeSignal(event);
    expect(signal.rawContent.length).toBe(4000);
  });

  it("extracts CVE into affectedCve when present in payload", () => {
    const event = makeEvent({ payload: "Critical bug CVE-2025-99999 found in OpenSSL" });
    const signal = normalizeSignal(event);
    expect(signal.affectedCve).toBe("CVE-2025-99999");
  });

  it("sets affectedCve to null when no CVE is present", () => {
    const event = makeEvent({ payload: "No CVE in this signal" });
    const signal = normalizeSignal(event);
    expect(signal.affectedCve).toBeNull();
  });

  it("extracts vendor into affectedVendor when present in title", () => {
    const event = makeEvent({ title: "Cisco IOS vulnerability disclosed" });
    const signal = normalizeSignal(event);
    expect(signal.affectedVendor).toBe("Cisco");
  });

  it("sets affectedVendor to null when no known vendor is present", () => {
    const event = makeEvent({ title: "Unknown product ships security fix" });
    const signal = normalizeSignal(event);
    expect(signal.affectedVendor).toBeNull();
  });
});
