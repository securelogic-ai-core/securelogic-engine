import { describe, it, expect } from "vitest";
import {
  computeRiskScore,
  scoreBand,
  LIKELIHOOD_WEIGHTS,
  IMPACT_WEIGHTS
} from "../lib/riskScore.js";

/**
 * Pins the ratified Option-A scoring methodology:
 *   score = round(likelihood_weight × impact_weight × 100)
 *   likelihood: very_likely 1.0, likely 0.8, possible 0.6, unlikely 0.4, rare 0.2
 *   impact:     Critical 1.0,    High 0.75,  Moderate 0.5,  Low 0.25
 *   bands:      Critical ≥75, High ≥50, Moderate ≥25, Low <25
 * These tests are the contract — the migration backfill and the route compute
 * must agree with them.
 */
describe("computeRiskScore — deterministic register scoring", () => {
  it("scores the worst case at 100 (very_likely × Critical)", () => {
    expect(computeRiskScore("very_likely", "Critical")?.score).toBe(100);
  });

  it("scores the best case at 5 (rare × Low)", () => {
    // 0.2 × 0.25 × 100 = 5
    expect(computeRiskScore("rare", "Low")?.score).toBe(5);
  });

  it("matches round(lw×iw×100) for every likelihood × impact pair", () => {
    for (const [lk, lw] of Object.entries(LIKELIHOOD_WEIGHTS)) {
      for (const [im, iw] of Object.entries(IMPACT_WEIGHTS)) {
        const expected = Math.round(lw * iw * 100);
        const r = computeRiskScore(lk, im);
        expect(r?.score).toBe(expected);
        expect(r?.basis).toEqual({ likelihood_weight: lw, impact_weight: iw });
      }
    }
  });

  it("returns null when either axis is missing", () => {
    expect(computeRiskScore(null, "Critical")).toBeNull();
    expect(computeRiskScore("likely", null)).toBeNull();
    expect(computeRiskScore(undefined, undefined)).toBeNull();
    expect(computeRiskScore("", "")).toBeNull();
  });

  it("returns null for unrecognized axis values (no silent guessing)", () => {
    expect(computeRiskScore("almost_certain", "Critical")).toBeNull();
    expect(computeRiskScore("likely", "Catastrophic")).toBeNull();
  });

  it("always produces an integer in [0,100]", () => {
    for (const lk of Object.keys(LIKELIHOOD_WEIGHTS)) {
      for (const im of Object.keys(IMPACT_WEIGHTS)) {
        const s = computeRiskScore(lk, im)!.score;
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("scoreBand — thresholds mapped to rating strings", () => {
  it("bands at the ratified cut points", () => {
    expect(scoreBand(100)).toBe("Critical");
    expect(scoreBand(75)).toBe("Critical");
    expect(scoreBand(74)).toBe("High");
    expect(scoreBand(50)).toBe("High");
    expect(scoreBand(49)).toBe("Moderate");
    expect(scoreBand(25)).toBe("Moderate");
    expect(scoreBand(24)).toBe("Low");
    expect(scoreBand(0)).toBe("Low");
  });

  it("returns null for null/invalid score", () => {
    expect(scoreBand(null)).toBeNull();
    expect(scoreBand(undefined)).toBeNull();
    expect(scoreBand(Number.NaN)).toBeNull();
  });
});
