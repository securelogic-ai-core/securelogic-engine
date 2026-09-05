/**
 * vendorFacingReasons.test.ts — WA-3 ruling 1.
 *
 * The vendor is told WHY a question is asked, and is not shown SecureLogic's
 * internal scope-rule identifiers. The identifiers keep existing — they are
 * provenance for composition, analyst explainability and historical
 * reconstruction — they are simply not part of what the portal ships.
 */
import { describe, it, expect } from "vitest";
import { vendorFacingReasons } from "../lib/vendorPortal/vendorFacingReasons.js";

const stored = [
  { rule_id: "S1.core.cas_06", rule_family: "S1", rationale: "Least privilege is a Core Assurance objective." },
  { rule_id: "S3.privacy", rule_family: "S3", rationale: "A privacy obligation is active." },
];

describe("WA-3 ruling 1 — the vendor gets the reason, never the rule id", () => {
  it("keeps every rationale, in order", () => {
    expect(vendorFacingReasons(stored)).toEqual([
      { rationale: "Least privilege is a Core Assurance objective." },
      { rationale: "A privacy obligation is active." },
    ]);
  });

  it("ships NO internal identifier — asserted on the serialised payload, not the shape", () => {
    const wire = JSON.stringify(vendorFacingReasons(stored));
    expect(wire).not.toContain("S1.core.cas_06");
    expect(wire).not.toContain("rule_id");
    expect(wire).not.toContain("rule_family");
    // The part the vendor is actually owed survives.
    expect(wire).toContain("Least privilege is a Core Assurance objective.");
  });

  it("does not mutate the stored reason it projects from", () => {
    const before = JSON.stringify(stored);
    vendorFacingReasons(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("is null-safe at the JSONB boundary", () => {
    expect(vendorFacingReasons(null)).toBeNull();
    expect(vendorFacingReasons(undefined)).toBeNull();
    expect(vendorFacingReasons("not-an-array")).toBeNull();
    expect(vendorFacingReasons([])).toEqual([]);
  });

  it("drops entries that carry no usable sentence rather than rendering an empty bullet", () => {
    expect(vendorFacingReasons([
      { rule_id: "S1", rule_family: "S1" },
      { rule_id: "S2", rule_family: "S2", rationale: "   " },
      { rule_id: "S3", rule_family: "S3", rationale: 42 },
      null,
      "nonsense",
      { rule_id: "S4", rule_family: "S4", rationale: "  Kept, trimmed.  " },
    ])).toEqual([{ rationale: "Kept, trimmed." }]);
  });
});
