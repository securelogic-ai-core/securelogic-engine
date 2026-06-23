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
  it("Phase 2.x: down-weights generic tokens so the single-brand-token tail now clears threshold", () => {
    // "technologies"/"systems"/"networks" are generic → near-1.0 weighted similarity.
    expect(vendorNameSimilarity("sensata technologies", "sensata")).toBe(87); // 1.0 / 1.15
    expect(vendorNameSimilarity("cisco systems", "cisco")).toBe(87);
    expect(vendorNameSimilarity("palo alto networks", "palo alto")).toBe(93); // 2.0 / 2.15
  });

  it("keeps the common-word/industry-noun false positives OUT (distinctive tokens keep full weight)", () => {
    // 'health' is NOT generic → full weight → stays below threshold.
    expect(vendorNameSimilarity("oracle", "oracle health")).toBe(50);          // 1.0 / 2.0
    expect(vendorNameSimilarity("oracle health", "oracle bank")).toBe(33);     // 1 / 3
    expect(vendorNameSimilarity("american airlines", "american express")).toBe(33);
  });

  it("returns 100 for identical token sets (incl. word-order variants)", () => {
    expect(vendorNameSimilarity("microsoft", "microsoft")).toBe(100);
    expect(vendorNameSimilarity("palo alto", "alto palo")).toBe(100); // word-order — exact misses, fuzzy catches
  });

  it("two different companies sharing only a generic token do NOT match", () => {
    // shared {systems:0.15}; distinct acme/beta keep full weight → tiny score.
    expect(vendorNameSimilarity("acme systems", "beta systems")).toBeLessThan(FUZZY_VENDOR_MIN_SCORE);
  });

  it("returns 0 for disjoint names or empty input", () => {
    expect(vendorNameSimilarity("cloudflare", "akamai")).toBe(0);
    expect(vendorNameSimilarity("", "anything")).toBe(0);
    expect(vendorNameSimilarity("anything", "")).toBe(0);
  });

  it("the threshold accepts the real wins (incl. the recovered tail) and rejects the common-word case", () => {
    expect(vendorNameSimilarity("sensata technologies", "sensata")).toBeGreaterThanOrEqual(FUZZY_VENDOR_MIN_SCORE);
    expect(vendorNameSimilarity("cisco systems", "cisco")).toBeGreaterThanOrEqual(FUZZY_VENDOR_MIN_SCORE);
    expect(vendorNameSimilarity("oracle", "oracle health")).toBeLessThan(FUZZY_VENDOR_MIN_SCORE);
    expect(vendorNameSimilarity("american airlines", "american express")).toBeLessThan(FUZZY_VENDOR_MIN_SCORE);
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
