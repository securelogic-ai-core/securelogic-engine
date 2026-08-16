/**
 * vendorEngagementIntake — the transcribed mirror of the engine's intake enums
 * (src/api/lib/vendorRisk/inherentRisk.ts).
 *
 * The engine remains the enforcer (a drifted value 400s with the allowed list),
 * so these tests pin the SHAPE the create form depends on: twelve scored
 * fields, unique names, every option non-empty snake_case, and the exact field
 * set the engine's validateIntake requires (minus the boolean, which the form
 * handles separately).
 */
import { describe, it, expect } from "vitest";
import { INTAKE_FIELDS, ENGAGEMENT_TYPES } from "../vendorEngagementIntake";

describe("INTAKE_FIELDS", () => {
  it("covers exactly the engine's twelve enum intake fields", () => {
    expect(INTAKE_FIELDS.map((f) => f.name).sort()).toEqual(
      [
        "data_sensitivity",
        "data_volume",
        "access_level",
        "operational_dependency",
        "recoverability",
        "business_criticality",
        "regulatory_exposure",
        "ai_involvement",
        "ai_autonomy",
        "hosting_model",
        "fourth_party_exposure",
        "concentration",
      ].sort()
    );
  });

  it("every field offers at least two distinct options with labels and help", () => {
    for (const f of INTAKE_FIELDS) {
      expect(f.options.length, f.name).toBeGreaterThanOrEqual(2);
      expect(f.label.length, f.name).toBeGreaterThan(0);
      expect(f.help.length, f.name).toBeGreaterThan(0);
      const values = f.options.map((o) => o.value);
      expect(new Set(values).size, f.name).toBe(values.length);
      for (const v of values) {
        // Engine values are lower snake_case tokens; anything else is drift.
        expect(v, f.name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("pins the values that historically drifted (ai_autonomy is the NIST AI RMF shape)", () => {
    const autonomy = INTAKE_FIELDS.find((f) => f.name === "ai_autonomy");
    expect(autonomy?.options.map((o) => o.value)).toEqual([
      "none",
      "human_in_the_loop",
      "human_on_the_loop",
      "autonomous_consequential",
    ]);
  });
});

describe("ENGAGEMENT_TYPES", () => {
  it("offers the engine's four engagement types", () => {
    expect(ENGAGEMENT_TYPES.map((t) => t.value)).toEqual([
      "initial",
      "periodic",
      "targeted",
      "event_driven",
    ]);
  });
});
