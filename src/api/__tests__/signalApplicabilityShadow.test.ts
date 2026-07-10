/**
 * signalApplicabilityShadow.test.ts — C3 pure shadow comparison + flag.
 * The shadow only MEASURES; these pin the convergence categories the report uses.
 */

import { describe, it, expect } from "vitest";
import {
  compareApplicabilityShadow,
  shadowTelemetry,
  type ShadowResolution,
} from "../lib/signalApplicabilityShadow.js";
import {
  signalApplicabilityEnabled,
  signalApplicabilityMode,
} from "../lib/signalApplicabilityFeatureFlag.js";

const resolved = (ids: string[]): ShadowResolution => ({
  status: ids.length === 1 ? "resolved" : "ambiguous",
  reason: "x",
  candidates: ids.map((asset_id) => ({ asset_id })),
});
const needsReview = (reason: string): ShadowResolution => ({ status: "needs_review", reason, candidates: [] });
const noMatch = (): ShadowResolution => ({ status: "no_match", reason: "no_active_asset_matches_product", candidates: [] });

describe("compareApplicabilityShadow", () => {
  it("agree: identical non-empty sets", () => {
    const c = compareApplicabilityShadow(["a"], resolved(["a"]));
    expect(c.agreement).toBe("agree");
    expect(c.agreed).toEqual(["a"]);
    expect(c.legacy_only).toEqual([]);
    expect(c.shadow_only).toEqual([]);
  });

  it("both_empty: legacy none + shadow no_match", () => {
    expect(compareApplicabilityShadow([], noMatch()).agreement).toBe("both_empty");
  });

  it("legacy_only (false-NEGATIVE candidates): legacy matched, shadow resolved none", () => {
    // resolved([]) is impossible; model legacy-only as shadow no_match with legacy hits.
    const c = compareApplicabilityShadow(["a", "b"], noMatch());
    expect(c.agreement).toBe("legacy_only");
    expect(c.legacy_only).toEqual(["a", "b"]);
  });

  it("shadow_only (false-POSITIVE candidates): shadow resolved, legacy none", () => {
    const c = compareApplicabilityShadow([], resolved(["z"]));
    expect(c.agreement).toBe("shadow_only");
    expect(c.shadow_only).toEqual(["z"]);
  });

  it("partial: overlap but sets differ (legacy multi, shadow single confident)", () => {
    // The resolver only ever yields a SINGLE confident asset (>1 → ambiguous →
    // unresolved), so 'partial' arises when legacy matched several and the shadow
    // confidently resolves one of them.
    const c = compareApplicabilityShadow(["a", "b"], resolved(["a"]));
    expect(c.agreement).toBe("partial");
    expect(c.agreed).toEqual(["a"]);
    expect(c.legacy_only).toEqual(["b"]);
    expect(c.shadow_only).toEqual([]);
  });

  it("shadow_unresolved: needs_review / ambiguous never asserts a set", () => {
    const c = compareApplicabilityShadow(["a"], needsReview("no_product_name_for_asset_match"));
    expect(c.agreement).toBe("shadow_unresolved");
    expect(c.unresolved_ambiguity).toBe(true);
    expect(c.shadow_asset_ids).toEqual([]); // ambiguous/needs_review contributes no asset set
    expect(c.legacy_only).toEqual(["a"]);   // still a false-negative candidate for the new path
  });

  it("telemetry carries counts only (no tenant asset ids)", () => {
    const t = shadowTelemetry(compareApplicabilityShadow(["a", "b"], resolved(["a"])));
    expect(t.legacy_count).toBe(2);
    expect(t.shadow_count).toBe(1);
    expect(t.agreed_count).toBe(1);
    expect(t.legacy_only_count).toBe(1);
    expect(t.shadow_only_count).toBe(0);
    expect(Object.values(t).some((v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v))).toBe(false);
  });
});

describe("signal applicability flag", () => {
  it("defaults OFF and requires strict 'true'", () => {
    expect(signalApplicabilityEnabled({})).toBe(false);
    expect(signalApplicabilityEnabled({ SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED: "1" })).toBe(false);
    expect(signalApplicabilityEnabled({ SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED: "true" })).toBe(true);
  });
  it("mode defaults to shadow; 'surface' only on explicit opt-in", () => {
    expect(signalApplicabilityMode({})).toBe("shadow");
    expect(signalApplicabilityMode({ SECURELOGIC_SIGNAL_APPLICABILITY_MODE: "surface" })).toBe("surface");
    expect(signalApplicabilityMode({ SECURELOGIC_SIGNAL_APPLICABILITY_MODE: "x" })).toBe("shadow");
  });
});
