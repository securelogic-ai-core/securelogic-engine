/**
 * RR-5 — Validator unit tests for the org-level risk-settings PUT body.
 *
 * Mirrors the structural pattern from riskScoringWeights.test.ts:
 * pure-function tests on validateRiskSettingsPut, exercising every
 * documented rule in src/api/lib/riskSettingsValidation.ts.
 *
 * Rules covered:
 *   1. body must be an object (not null / array / scalar)
 *   2. cadence_by_rating key required (object)
 *   3. cadence_by_rating must contain ALL four rating keys
 *      (Critical, High, Moderate, Low) — partial maps rejected
 *   4. each value must be a number (not string)
 *   5. each value must be a finite integer (NaN, Infinity, 1.5 → reject)
 *   6. each value must be > 0 (zero/negative reject)
 *   7. each value must be ≤ MAX_DAYS (3650)
 *   8. unknown rating keys are rejected
 *   9. happy path returns input.cadence_by_rating with the same four keys
 *  10. extraneous top-level keys are dropped (input shape stays clean)
 */

import { describe, it, expect } from "vitest";
import { validateRiskSettingsPut } from "../lib/riskSettingsValidation.js";

function validBody() {
  return {
    cadence_by_rating: {
      Critical: 30,
      High:     60,
      Moderate: 90,
      Low:      180,
    },
  };
}

describe("validateRiskSettingsPut — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskSettingsPut(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskSettingsPut([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRiskSettingsPut("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects number body", () => {
    const r = validateRiskSettingsPut(42);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateRiskSettingsPut — cadence_by_rating presence", () => {
  it("rejects body without cadence_by_rating", () => {
    const r = validateRiskSettingsPut({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_required");
  });

  it("rejects cadence_by_rating that is not an object", () => {
    const r = validateRiskSettingsPut({ cadence_by_rating: "not-an-object" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_required");
  });

  it("rejects cadence_by_rating that is null", () => {
    const r = validateRiskSettingsPut({ cadence_by_rating: null });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_required");
  });

  it("rejects cadence_by_rating that is an array", () => {
    const r = validateRiskSettingsPut({ cadence_by_rating: [30, 60, 90, 180] });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_required");
  });
});

describe("validateRiskSettingsPut — all four rating keys required", () => {
  it("rejects when 'Critical' is missing", () => {
    const b = validBody();
    delete (b.cadence_by_rating as Record<string, unknown>).Critical;
    const r = validateRiskSettingsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_incomplete");
  });

  it("rejects when 'High' is missing", () => {
    const b = validBody();
    delete (b.cadence_by_rating as Record<string, unknown>).High;
    const r = validateRiskSettingsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_incomplete");
  });

  it("rejects when 'Moderate' is missing", () => {
    const b = validBody();
    delete (b.cadence_by_rating as Record<string, unknown>).Moderate;
    const r = validateRiskSettingsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_incomplete");
  });

  it("rejects when 'Low' is missing", () => {
    const b = validBody();
    delete (b.cadence_by_rating as Record<string, unknown>).Low;
    const r = validateRiskSettingsPut(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_incomplete");
  });
});

describe("validateRiskSettingsPut — value type checks", () => {
  it("rejects string value", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: "30", High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_integer");
  });

  it("rejects fractional value (1.5)", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: 30.5, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_integer");
  });

  it("rejects NaN", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: NaN, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_integer");
  });

  it("rejects Infinity", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: Number.POSITIVE_INFINITY, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_integer");
  });

  it("rejects boolean value", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: true as unknown as number, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_integer");
  });
});

describe("validateRiskSettingsPut — value range checks", () => {
  it("rejects zero (boundary: not positive)", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: 0, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_positive");
  });

  it("rejects negative", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: -5, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_must_be_positive");
  });

  it("rejects value > MAX_DAYS (3650)", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: 3651, High: 60, Moderate: 90, Low: 180 },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_value_too_large");
  });

  it("accepts boundary value MAX_DAYS = 3650", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: 3650, High: 60, Moderate: 90, Low: 180 },
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.cadence_by_rating.Critical).toBe(3650);
    }
  });

  it("accepts value 1 (positive lower bound)", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: { Critical: 1, High: 1, Moderate: 1, Low: 1 },
    });
    expect("input" in r).toBe(true);
  });
});

describe("validateRiskSettingsPut — unknown keys", () => {
  it("rejects unexpected rating keys (e.g. 'Medium')", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: {
        Critical: 30, High: 60, Moderate: 90, Low: 180, Medium: 45,
      },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_unknown_key");
  });

  it("rejects lowercase rating key drift (e.g. 'critical')", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: {
        Critical: 30, High: 60, Moderate: 90, Low: 180, critical: 45,
      },
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cadence_by_rating_unknown_key");
  });
});

describe("validateRiskSettingsPut — happy path + shape", () => {
  it("accepts the documented default body", () => {
    const r = validateRiskSettingsPut(validBody());
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.cadence_by_rating).toEqual({
        Critical: 30, High: 60, Moderate: 90, Low: 180,
      });
    }
  });

  it("ignores unrelated top-level keys (e.g. organization_id, foo)", () => {
    const r = validateRiskSettingsPut({
      cadence_by_rating: {
        Critical: 30, High: 60, Moderate: 90, Low: 180,
      },
      organization_id: "00000000-0000-0000-0000-000000000000",
      foo: "bar",
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(["cadence_by_rating"]);
    }
  });
});
