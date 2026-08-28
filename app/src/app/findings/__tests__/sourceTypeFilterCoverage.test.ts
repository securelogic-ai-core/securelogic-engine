/**
 * sourceTypeFilterCoverage.test.ts — a source type nobody can filter to is a
 * capability nobody can find.
 *
 * REPORT-1 discovered that the findings filter vocabulary is a hand-maintained
 * subset of the engine's FINDING_SOURCE_TYPES, and that it had silently fallen
 * behind by two packages: `vulnerability` (SL-VULN-1) and `pen_test`
 * (SL-PENTEST-IN) were ingestible, SLA-governed, Risk-Register-linkable — and
 * unreachable in the UI. Nothing failed; the pills simply were not there.
 *
 * This test does not demand that every engine source type appear in the filter.
 * Several are engine-written provenance types a customer should not filter by,
 * and one (`vendor_engagement`) is deliberately withheld until its workflow
 * completes. It asserts the SPECIFIC customer-creatable types we have committed
 * to surfacing, so the next package that adds one has to make a decision rather
 * than forget.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "../page.tsx"), "utf8");

function filterValues(): string[] {
  const block = PAGE.slice(
    PAGE.indexOf("const SOURCE_TYPE_VALUES"),
    PAGE.indexOf("];", PAGE.indexOf("const SOURCE_TYPE_VALUES")),
  );
  return [...block.matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("the findings filter surfaces the domains we ship", () => {
  it("includes vulnerability — the SL-VULN-1 domain", () => {
    expect(filterValues()).toContain("vulnerability");
  });

  it("includes pen_test — the SL-PENTEST-IN domain", () => {
    expect(filterValues()).toContain("pen_test");
  });

  it("keeps the previously surfaced types", () => {
    const v = filterValues();
    for (const t of ["vendor_review", "control_test", "obligation_review",
                     "ai_review", "ai_governance_review", "manual"]) {
      expect(v).toContain(t);
    }
  });

  it("has no duplicate values", () => {
    const v = filterValues();
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("workflows that are not complete are not surfaced", () => {
  it("offers vendor_engagement now that the workflow completes (VA-10)", () => {
    // The inverse assertion lived here while the engagement→findings path was
    // incomplete, with the instruction that only the Vendor Assurance
    // completion package may delete it. VA-10 is that package: promotion,
    // vendor-page linkage, supersede-on-pass visibility, and Finding→
    // engagement back-navigation all ride the same held train as this pill.
    expect(filterValues()).toContain("vendor_engagement");
  });

  it("does NOT offer engine-written provenance types", () => {
    // cyber_signal / applicability_assessment / asset_assessment /
    // intelligence_event are pipeline provenance, not things a customer files.
    const v = filterValues();
    for (const t of ["cyber_signal", "applicability_assessment",
                     "asset_assessment", "intelligence_event"]) {
      expect(v).not.toContain(t);
    }
  });
});
