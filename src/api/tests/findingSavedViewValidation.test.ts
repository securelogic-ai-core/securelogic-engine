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
      // Queue-controls browse keys (EG2 slice 4) — same whitelist, same rules.
      q: "backup",
      governance: "needs_review",
      operational: "in_progress",
      due: "overdue",
      mine: "1",
      has_action: "1",
      has_evidence: "1",
      created_from: "2026-01-01",
      created_to: "2026-06-30",
      sort: "severity",
    });
    expect(out).toEqual({
      status: "open",
      severity: "Critical",
      source_type: "cyber_signal",
      domain: "Vendor Risk",
      priority: "immediate",
      q: "backup",
      governance: "needs_review",
      operational: "in_progress",
      due: "overdue",
      mine: "1",
      has_action: "1",
      has_evidence: "1",
      created_from: "2026-01-01",
      created_to: "2026-06-30",
      sort: "severity",
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
