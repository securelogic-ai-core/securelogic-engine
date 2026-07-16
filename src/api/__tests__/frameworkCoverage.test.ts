/**
 * frameworkCoverage — the framework coverage rule (walkthrough item 7 ruling):
 * satisfied-only score (partial earns NO credit) + the explicit caption, both
 * defined once and shared by every surface.
 */
import { describe, it, expect } from "vitest";
import {
  readinessScore,
  coverageCaption,
  assessmentProgress,
} from "../lib/frameworkCoverage.js";

describe("readinessScore — satisfied-only, partial earns no credit", () => {
  it("scores the walkthrough's exact case: 0 satisfied, 3 partial → 0%", () => {
    // The ruling's whole point: work-in-progress is visible in the caption,
    // never in the score.
    expect(readinessScore(0, 3)).toBe(0);
  });

  it("counts only fully satisfied requirements", () => {
    expect(readinessScore(11, 20)).toBe(55);
    expect(readinessScore(20, 20)).toBe(100);
  });

  it("returns 0 for an empty framework instead of dividing by zero", () => {
    expect(readinessScore(0, 0)).toBe(0);
  });

  it("rounds to an integer percentage", () => {
    expect(readinessScore(1, 3)).toBe(33);
    expect(readinessScore(2, 3)).toBe(67);
  });
});

describe("coverageCaption — the explicit breakdown, satisfied always present", () => {
  it("renders the ruling's exemplar: '0 fully satisfied · 3 partial'", () => {
    expect(coverageCaption({ satisfied: 0, partial: 3, unmapped: 0 })).toBe(
      "0 fully satisfied · 3 partial",
    );
  });

  it("NEVER drops the satisfied part, even at zero — that omission was the defect", () => {
    expect(coverageCaption({ satisfied: 0, partial: 2, unmapped: 5 })).toMatch(
      /^0 fully satisfied/,
    );
  });

  it("includes partial and unmapped only when non-zero", () => {
    expect(coverageCaption({ satisfied: 11, partial: 4, unmapped: 5 })).toBe(
      "11 fully satisfied · 4 partial · 5 unmapped",
    );
    expect(coverageCaption({ satisfied: 5, partial: 0, unmapped: 0 })).toBe(
      "5 fully satisfied",
    );
    expect(coverageCaption({ satisfied: 0, partial: 0, unmapped: 0 })).toBe(
      "0 fully satisfied",
    );
  });
});

describe("assessmentProgress — completion only, a separate metric from readiness (O-5)", () => {
  it("counts any completed response — pass, partial, AND fail — as progress", () => {
    // 1 pass + 1 partial + 1 fail out of 4 = 75% assessed. The old blended
    // formula would have called this (1 + 0.5)/4 = 37.5% "readiness".
    expect(assessmentProgress(3, 4)).toBe(75);
  });

  it("a fully answered questionnaire is 100% progress even if every answer failed", () => {
    expect(assessmentProgress(5, 5)).toBe(100);
  });

  it("O-5 exemplar: responses alone → readiness 0, progress > 0", () => {
    // A framework with 10 answered requirements but zero satisfied control
    // mappings: full progress, zero readiness. The two must never converge.
    expect(readinessScore(0, 10)).toBe(0);
    expect(assessmentProgress(10, 10)).toBe(100);
  });

  it("returns 0 for an empty framework instead of dividing by zero", () => {
    expect(assessmentProgress(0, 0)).toBe(0);
  });

  it("rounds to an integer percentage", () => {
    expect(assessmentProgress(1, 3)).toBe(33);
    expect(assessmentProgress(2, 3)).toBe(67);
  });
});
