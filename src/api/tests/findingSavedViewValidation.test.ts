import { describe, it, expect } from "vitest";
import {
  normalizeSavedViewName,
  sanitizeSavedViewFilters,
  SAVED_VIEW_FILTER_KEYS,
  MAX_SAVED_VIEW_NAME,
} from "../lib/findingSavedViewValidation.js";

describe("normalizeSavedViewName", () => {
  it("trims and accepts a valid name", () => {
    expect(normalizeSavedViewName("  Critical & overdue  ")).toBe("Critical & overdue");
  });
  it("rejects empty, whitespace-only, over-length, and non-strings", () => {
    expect(normalizeSavedViewName("")).toBeNull();
    expect(normalizeSavedViewName("   ")).toBeNull();
    expect(normalizeSavedViewName("x".repeat(MAX_SAVED_VIEW_NAME + 1))).toBeNull();
    expect(normalizeSavedViewName(123 as unknown)).toBeNull();
    expect(normalizeSavedViewName(null)).toBeNull();
  });
});

describe("sanitizeSavedViewFilters", () => {
  it("keeps only whitelisted, non-empty string filter keys (trimmed)", () => {
    const out = sanitizeSavedViewFilters({
      status: "open",
      severity: " Critical ",
      source_type: "cyber_signal",
      domain: "Vendor Risk",
      priority: "immediate",
    });
    expect(out).toEqual({
      status: "open",
      severity: "Critical",
      source_type: "cyber_signal",
      domain: "Vendor Risk",
      priority: "immediate",
    });
    expect(Object.keys(out).sort()).toEqual([...SAVED_VIEW_FILTER_KEYS].sort());
  });
  it("drops unknown keys and non-string / empty values (never smuggles arbitrary JSON)", () => {
    const out = sanitizeSavedViewFilters({
      status: "open",
      evil: "<script>",
      nested: { a: 1 },
      severity: "",
      priority: 5,
    });
    expect(out).toEqual({ status: "open" });
  });
  it("degrades a non-object payload to an empty filter set (never throws)", () => {
    expect(sanitizeSavedViewFilters(null)).toEqual({});
    expect(sanitizeSavedViewFilters("nope")).toEqual({});
    expect(sanitizeSavedViewFilters(undefined)).toEqual({});
  });
});
