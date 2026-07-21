/**
 * briefingLayoutValidation.test.ts — the B2 layout-envelope validation matrix.
 * Pure/DB-free. The accept path proves the envelope is rebuilt (normalized),
 * the reject paths pin every stable error code the app keys off.
 */

import { describe, it, expect } from "vitest";
import {
  validateBriefingLayoutEnvelope,
  BRIEFING_LAYOUT_MAX_MODULES,
} from "../lib/briefingLayoutValidation.js";
import { BRIEFING_MODULE_MANIFEST } from "../lib/briefingModuleManifest.generated.js";

const knownIds = BRIEFING_MODULE_MANIFEST.modules.map((m) => m.id);

function entry(id: string) {
  return { moduleId: id, instanceKey: id, config: {} };
}

function envelope(ids: string[]) {
  return { version: 1, modules: ids.map(entry) };
}

describe("validateBriefingLayoutEnvelope", () => {
  it("accepts a full canonical layout and returns a normalized rebuild", () => {
    const raw = envelope(knownIds);
    const result = validateBriefingLayoutEnvelope(raw);
    expect("input" in result).toBe(true);
    if (!("input" in result)) return;
    expect(result.input.version).toBe(1);
    expect(result.input.modules.map((m) => m.moduleId)).toEqual(knownIds);
    // Normalized rebuild — never the raw payload by reference.
    expect(result.input).not.toBe(raw);
    expect(result.input.modules[0]).not.toBe(raw.modules[0]);
  });

  it("accepts a single-module layout (minimum size)", () => {
    const result = validateBriefingLayoutEnvelope(envelope([knownIds[0]]));
    expect("input" in result).toBe(true);
  });

  it("preserves the requested order (a layout IS an ordering)", () => {
    const reversed = [...knownIds].reverse();
    const result = validateBriefingLayoutEnvelope(envelope(reversed));
    if (!("input" in result)) throw new Error("expected accept");
    expect(result.input.modules.map((m) => m.moduleId)).toEqual(reversed);
  });

  it("rejects non-object envelopes", () => {
    for (const bad of [null, undefined, [], "x", 42]) {
      const result = validateBriefingLayoutEnvelope(bad);
      expect(result).toEqual({ error: "layout_must_be_object" });
    }
  });

  it("rejects an unsupported version", () => {
    const result = validateBriefingLayoutEnvelope({ version: 2, modules: [entry(knownIds[0])] });
    expect("error" in result && result.error).toBe("layout_version_unsupported");
  });

  it("rejects missing/non-array modules", () => {
    expect(validateBriefingLayoutEnvelope({ version: 1 })).toEqual({
      error: "layout_modules_must_be_array",
    });
    expect(validateBriefingLayoutEnvelope({ version: 1, modules: {} })).toEqual({
      error: "layout_modules_must_be_array",
    });
  });

  it("rejects an empty layout", () => {
    expect(validateBriefingLayoutEnvelope({ version: 1, modules: [] })).toEqual({
      error: "layout_requires_at_least_one_module",
    });
  });

  it("rejects oversized layouts (defense-in-depth cap)", () => {
    const ids = Array.from(
      { length: BRIEFING_LAYOUT_MAX_MODULES + 1 },
      () => knownIds[0]
    );
    const result = validateBriefingLayoutEnvelope(envelope(ids));
    expect("error" in result && result.error).toBe("layout_too_many_modules");
  });

  it("rejects module ids not in the ENGINE manifest (never trusts the client catalog)", () => {
    const result = validateBriefingLayoutEnvelope(envelope(["not_a_module"]));
    expect("error" in result && result.error).toBe("layout_module_id_unknown");
  });

  it("rejects legacy tile ids — the legacy vocabulary is not the module vocabulary", () => {
    for (const legacy of ["risk_heatmap", "findings_donut", "actions_ring"]) {
      const result = validateBriefingLayoutEnvelope(envelope([legacy]));
      // posture_score exists in BOTH vocabularies (same id) — excluded above.
      expect("error" in result && result.error).toBe("layout_module_id_unknown");
    }
  });

  it("rejects instanceKey !== moduleId (B2 single-instance rule)", () => {
    const result = validateBriefingLayoutEnvelope({
      version: 1,
      modules: [{ moduleId: knownIds[0], instanceKey: "other", config: {} }],
    });
    expect("error" in result && result.error).toBe("layout_instance_key_invalid");
  });

  it("rejects non-empty config (B2 empty-config rule)", () => {
    const result = validateBriefingLayoutEnvelope({
      version: 1,
      modules: [{ moduleId: knownIds[0], instanceKey: knownIds[0], config: { a: 1 } }],
    });
    expect("error" in result && result.error).toBe("layout_module_config_must_be_empty");
    const missing = validateBriefingLayoutEnvelope({
      version: 1,
      modules: [{ moduleId: knownIds[0], instanceKey: knownIds[0] }],
    });
    expect("error" in missing && missing.error).toBe("layout_module_config_must_be_empty");
  });

  it("rejects duplicate module ids", () => {
    const result = validateBriefingLayoutEnvelope(envelope([knownIds[0], knownIds[0]]));
    expect("error" in result && result.error).toBe("layout_duplicate_module");
  });

  it("rejects malformed entries", () => {
    for (const bad of [null, "x", 3, []]) {
      const result = validateBriefingLayoutEnvelope({ version: 1, modules: [bad] });
      expect("error" in result && result.error).toBe("layout_module_entry_invalid");
    }
  });

  it("accepts a known-but-possibly-ineligible module id (C4: eligibility is render-time)", () => {
    // my_pending_reviews requires the independent_review flag at RENDER time;
    // the write path accepts it regardless — a stored layout never grants access.
    const flagged = BRIEFING_MODULE_MANIFEST.modules.find((m) => m.requiredFlag);
    if (!flagged) return; // manifest has no flagged module — nothing to pin
    const result = validateBriefingLayoutEnvelope(envelope([flagged.id]));
    expect("input" in result).toBe(true);
  });
});
