/**
 * findingSlaPolicy.test.ts — pure policy parsing (migration 20260903).
 * Fail-safe rule: a malformed policy never sets a garbage date.
 */

import { describe, it, expect } from "vitest";

import { slaDaysFor } from "../lib/findingSlaPolicyRules.js";

const POLICY = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

describe("slaDaysFor", () => {
  it("maps severities to configured days (case-insensitive severity)", () => {
    expect(slaDaysFor(POLICY, "Critical")).toBe(7);
    expect(slaDaysFor(POLICY, "high")).toBe(14);
    expect(slaDaysFor(POLICY, "MODERATE")).toBe(30);
    expect(slaDaysFor(POLICY, "Low")).toBe(90);
  });

  it("returns null when no policy is configured (automation off)", () => {
    expect(slaDaysFor(null, "Critical")).toBe(null);
    expect(slaDaysFor(undefined, "Critical")).toBe(null);
  });

  it("returns null for unknown severities", () => {
    expect(slaDaysFor(POLICY, "Informational")).toBe(null);
    expect(slaDaysFor(POLICY, null)).toBe(null);
    expect(slaDaysFor(POLICY, "")).toBe(null);
  });

  it("fails safe on malformed policy values (never a garbage date)", () => {
    expect(slaDaysFor({ Critical: "7" }, "Critical")).toBe(null);
    expect(slaDaysFor({ Critical: 0 }, "Critical")).toBe(null);
    expect(slaDaysFor({ Critical: -3 }, "Critical")).toBe(null);
    expect(slaDaysFor({ Critical: 2.5 }, "Critical")).toBe(null);
    expect(slaDaysFor({ Critical: 99999 }, "Critical")).toBe(null);
    expect(slaDaysFor("not-an-object", "Critical")).toBe(null);
    expect(slaDaysFor([7], "Critical")).toBe(null);
  });

  it("a partial policy applies only to configured severities", () => {
    expect(slaDaysFor({ Critical: 7 }, "Critical")).toBe(7);
    expect(slaDaysFor({ Critical: 7 }, "Low")).toBe(null);
  });
});
