/**
 * postureDisplay — the canonical posture presentation mapper (walkthrough
 * items 1+2 ruling): customers see HEALTH-style scores (higher = better);
 * the engine stays risk-style; the inversion happens exactly once, here.
 */
import { describe, it, expect } from "vitest";
import {
  toDisplayScore,
  toDisplayPosture,
  toDisplayDomain,
  toDisplayTrend,
} from "../lib/postureDisplay.js";

describe("toDisplayScore — display = 100 − risk", () => {
  it("inverts the walkthrough's exact numbers", () => {
    // Overall risk 96 (Critical) → display 4: a LOW number beside a Critical
    // badge is coherent; "96 + Critical" read as a contradiction.
    expect(toDisplayScore(96)).toBe(4);
    // Domain risk 100 (max) → display 0.
    expect(toDisplayScore(100)).toBe(0);
    expect(toDisplayScore(0)).toBe(100);
  });

  it("null/undefined/NaN stay null — absence is never a fabricated score", () => {
    expect(toDisplayScore(null)).toBeNull();
    expect(toDisplayScore(undefined)).toBeNull();
    expect(toDisplayScore(Number.NaN)).toBeNull();
  });

  it("clamps out-of-range inputs", () => {
    expect(toDisplayScore(140)).toBe(0);
    expect(toDisplayScore(-5)).toBe(100);
  });
});

describe("row helpers — severity labels pass through untouched", () => {
  it("toDisplayPosture converts the score, keeps the severity fact", () => {
    const row = { overall_score: 96, overall_severity: "Critical", snapshot_date: "2026-07-15" };
    expect(toDisplayPosture(row)).toEqual({
      overall_score: 4,
      overall_severity: "Critical",
      snapshot_date: "2026-07-15",
    });
  });

  it("toDisplayDomain converts domain rows", () => {
    expect(toDisplayDomain({ domain: "Access Control", score: 100, severity: "Critical" })).toEqual({
      domain: "Access Control",
      score: 0,
      severity: "Critical",
    });
  });

  it("toDisplayTrend converts the whole series through the same mapping", () => {
    const series = [
      { snapshot_date: "2026-07-01", overall_score: 80 },
      { snapshot_date: "2026-07-08", overall_score: 60 },
      { snapshot_date: "2026-07-15", overall_score: null },
    ];
    expect(toDisplayTrend(series).map((r) => r.overall_score)).toEqual([20, 40, null]);
  });
});
