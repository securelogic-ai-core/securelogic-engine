import { describe, it, expect, afterEach } from "vitest";

import {
  vendorNameSimilarity,
  fuzzyVendorMatchEnabled,
  FUZZY_VENDOR_MIN_SCORE
} from "../lib/vendorFuzzyMatch.js";

// ---------------------------------------------------------------------------
// vendorNameSimilarity — token-set Jaccard, scaled to [0,100]
// ---------------------------------------------------------------------------

describe("vendorNameSimilarity", () => {
  it("scores token-count variants the exact branch misses (the recall target)", () => {
    // NVD "palo alto networks" vs customer "Palo Alto": {palo,alto,networks} ∩ {palo,alto} = 2 / union 3
    expect(vendorNameSimilarity("palo alto networks", "palo alto")).toBe(67);
    // EDGAR "sensata technologies" vs "sensata": 1/2
    expect(vendorNameSimilarity("sensata technologies", "sensata")).toBe(50);
  });

  it("penalizes a shared common token (Jaccard, not containment — the danger case)", () => {
    // Containment would score 1.0 here; Jaccard keeps it low so the threshold rejects it.
    expect(vendorNameSimilarity("oracle", "oracle health")).toBe(50);
    expect(vendorNameSimilarity("oracle health", "oracle bank")).toBe(33); // {oracle} / {oracle,health,bank}
  });

  it("returns 100 for identical token sets (incl. word-order variants)", () => {
    expect(vendorNameSimilarity("microsoft", "microsoft")).toBe(100);
    expect(vendorNameSimilarity("palo alto", "alto palo")).toBe(100); // word-order — exact misses, fuzzy catches
  });

  it("returns 0 for disjoint names or empty input", () => {
    expect(vendorNameSimilarity("cloudflare", "akamai")).toBe(0);
    expect(vendorNameSimilarity("", "anything")).toBe(0);
    expect(vendorNameSimilarity("anything", "")).toBe(0);
  });

  it("the documented threshold accepts the real wins and rejects the common-word case", () => {
    expect(vendorNameSimilarity("palo alto networks", "palo alto")).toBeGreaterThanOrEqual(FUZZY_VENDOR_MIN_SCORE);
    expect(vendorNameSimilarity("oracle", "oracle health")).toBeLessThan(FUZZY_VENDOR_MIN_SCORE);
  });
});

// ---------------------------------------------------------------------------
// fuzzyVendorMatchEnabled — OFF by default, ON only for exactly "true"
// ---------------------------------------------------------------------------

describe("fuzzyVendorMatchEnabled", () => {
  const KEY = "SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED";
  afterEach(() => { delete process.env[KEY]; });

  it("is OFF when the env var is unset (default everywhere, incl. non-prod)", () => {
    expect(fuzzyVendorMatchEnabled({})).toBe(false);
  });

  it("is ON only for the exact string 'true'", () => {
    expect(fuzzyVendorMatchEnabled({ [KEY]: "true" })).toBe(true);
    expect(fuzzyVendorMatchEnabled({ [KEY]: "false" })).toBe(false);
    expect(fuzzyVendorMatchEnabled({ [KEY]: "1" })).toBe(false);
    expect(fuzzyVendorMatchEnabled({ [KEY]: "TRUE" })).toBe(false);
  });

  it("defaults to reading process.env", () => {
    expect(fuzzyVendorMatchEnabled()).toBe(false);
    process.env[KEY] = "true";
    expect(fuzzyVendorMatchEnabled()).toBe(true);
  });
});
