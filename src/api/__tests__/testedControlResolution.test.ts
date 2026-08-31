/**
 * testedControlResolution.test.ts — VA-S4-4C-2, the pure core.
 *
 * The three rules under test are the ones the package exists to hold: the
 * GOVERNED EFFECTIVE value wins over the raw extraction, nothing is dropped
 * silently, and there is no inference from a criterion to a control other than
 * a published mapping.
 */

import { describe, expect, it } from "vitest";

import {
  computeEffectiveTestedControls,
  resolutionFrameworkForDocumentType,
  resolveTestedControls,
  type CrosswalkMapping,
} from "../lib/vendorAssurance/testedControlResolution.js";

const ctrl = (id: string | null, extra: Record<string, unknown> = {}) => ({
  control_id: id,
  description: `Tested control ${id ?? "(none)"}`,
  test_procedure: "Inspected and reperformed.",
  result: "No exceptions noted.",
  ...extra,
});

const mapping = (ref: string, control: string, id = `x-${ref}-${control}`): CrosswalkMapping => ({
  id,
  requirement_reference: ref,
  canonical_control_id: control,
  mapping_version: "2026.08.1",
  mapping_source: "securelogic",
});

describe("the framework a document may be resolved against is explicit and closed", () => {
  it("resolves SOC 2 type I and II against soc2/2017", () => {
    expect(resolutionFrameworkForDocumentType("soc2_type2")).toEqual({ key: "soc2", version: "2017" });
    expect(resolutionFrameworkForDocumentType("soc2_type1")).toEqual({ key: "soc2", version: "2017" });
  });

  it("REFUSES a SOC 1 report — its identifiers look like TSC criteria and are not", () => {
    expect(resolutionFrameworkForDocumentType("soc1")).toBeNull();
  });

  it("refuses an unknown or absent hint rather than guessing", () => {
    expect(resolutionFrameworkForDocumentType(null)).toBeNull();
    expect(resolutionFrameworkForDocumentType("iso27001")).toBeNull();
  });
});

describe("the effective value is the governed one", () => {
  it("with no override, effective IS the extraction, and says so structurally", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1"), ctrl("A1.2")],
      liveOverride: null,
    });
    expect(set.controls.map((c) => c.element_key)).toEqual(["CC6.1", "A1.2"]);
    expect(set.controls.every((c) => c.effective_source === "extraction")).toBe(true);
    expect(set.controls.every((c) => c.override_id === null)).toBe(true);
    expect(set.controls[0]!.effective_control).toEqual(set.controls[0]!.original_control);
  });

  it("an accepted override REPLACES the effective value, and the original is still preserved", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1", { result: "No exceptions noted." })],
      liveOverride: {
        id: "ovr-1",
        override_value: [ctrl("CC6.1", { result: "Exceptions noted — corrected by reviewer." })],
      },
    });
    expect(set.controls).toHaveLength(1);
    const c = set.controls[0]!;
    expect(c.effective_source).toBe("field_override");
    expect(c.override_id).toBe("ovr-1");
    expect((c.effective_control as Record<string, unknown>)["result"]).toMatch(/corrected by reviewer/);
    // The immutable original is NOT lost and NOT rewritten.
    expect((c.original_control as Record<string, unknown>)["result"]).toBe("No exceptions noted.");
  });

  it("a control the override INTRODUCED has no original — and does not fabricate one", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1")],
      liveOverride: { id: "ovr-1", override_value: [ctrl("CC6.1"), ctrl("CC7.2")] },
    });
    const introduced = set.controls.find((c) => c.element_key === "CC7.2")!;
    expect(introduced.original_control).toBeNull();
    expect(introduced.effective_source).toBe("field_override");
  });

  it("a control the override REMOVED is not effective any more, and is reported as removed", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1"), ctrl("A1.2")],
      liveOverride: { id: "ovr-1", override_value: [ctrl("CC6.1")] },
    });
    expect(set.controls.map((c) => c.element_key)).toEqual(["CC6.1"]);
    expect(set.removed_by_override).toEqual(["A1.2"]);
  });

  it("pairs by IDENTIFIER, not by array position — reordering does not re-point anything", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1", { result: "first" }), ctrl("A1.2", { result: "second" })],
      liveOverride: {
        id: "ovr-1",
        override_value: [ctrl("A1.2", { result: "second, edited" }), ctrl("CC6.1", { result: "first, edited" })],
      },
    });
    const a12 = set.controls.find((c) => c.element_key === "A1.2")!;
    expect((a12.original_control as Record<string, unknown>)["result"]).toBe("second");
    expect((a12.effective_control as Record<string, unknown>)["result"]).toBe("second, edited");
  });

  it("counts controls with no identifier instead of dropping them", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("CC6.1"), ctrl(null), ctrl("   ")],
      liveOverride: null,
    });
    expect(set.controls.map((c) => c.element_key)).toEqual(["CC6.1"]);
    expect(set.unidentified_count).toBe(2);
  });
});

describe("resolution is by published mapping only", () => {
  const effective = (keys: string[]) =>
    computeEffectiveTestedControls({
      extractionControls: keys.map((k) => ctrl(k)),
      liveOverride: null,
    }).controls;

  it("a criterion with a published mapping resolves, carrying the mapping's provenance", () => {
    const out = resolveTestedControls(effective(["CC6.1"]), [mapping("CC6.1", "ctl-encryption", "cw-1")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      resolution_state: "resolved",
      canonical_control_id: "ctl-encryption",
      crosswalk_id: "cw-1",
      mapping_version: "2026.08.1",
      mapping_source: "securelogic",
      unmapped_reason: null,
    });
  });

  it("FAN-OUT is many resolved rows, not an unresolved identity", () => {
    const out = resolveTestedControls(effective(["CC6.1"]), [
      mapping("CC6.1", "ctl-a"),
      mapping("CC6.1", "ctl-b"),
      mapping("CC6.1", "ctl-c"),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.resolution_state === "resolved")).toBe(true);
    expect(new Set(out.map((r) => r.element_key))).toEqual(new Set(["CC6.1"]));
  });

  it("an identity with NO published mapping is unmapped with a reason — never dropped", () => {
    const out = resolveTestedControls(effective(["CC6.1", "C1.1"]), [mapping("CC6.1", "ctl-a")]);
    expect(out).toHaveLength(2);
    const c11 = out.find((r) => r.element_key === "C1.1")!;
    expect(c11.resolution_state).toBe("unmapped");
    expect(c11.unmapped_reason).toBe("no_published_crosswalk_mapping");
    expect(c11.canonical_control_id).toBeNull();
    expect(c11.crosswalk_id).toBeNull();
  });

  it("does NOT infer from a near-match — no prefix, family or similarity fallback", () => {
    const out = resolveTestedControls(effective(["CC6.10", "C1.2"]), [
      mapping("CC6.1", "ctl-a"),
      mapping("C1.1", "ctl-b"),
    ]);
    expect(out.every((r) => r.resolution_state === "unmapped")).toBe(true);
  });

  it("resolves the EFFECTIVE control, so an override changes what gets resolved", () => {
    const set = computeEffectiveTestedControls({
      extractionControls: [ctrl("C1.1")],
      liveOverride: { id: "ovr-1", override_value: [ctrl("CC6.1")] },
    });
    const out = resolveTestedControls(set.controls, [mapping("CC6.1", "ctl-a")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.resolution_state).toBe("resolved");
    expect(out[0]!.element_key).toBe("CC6.1");
    expect(out[0]!.effective_source).toBe("field_override");
  });

  it("every effective control produces at least one row — nothing is silently absent", () => {
    const keys = ["CC6.1", "CC6.2", "C1.1", "A1.2"];
    const out = resolveTestedControls(effective(keys), [mapping("CC6.1", "ctl-a"), mapping("CC6.1", "ctl-b")]);
    expect(new Set(out.map((r) => r.element_key))).toEqual(new Set(keys));
  });
});
