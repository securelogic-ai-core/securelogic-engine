/**
 * vendorResidualRisk.test.ts
 *
 * Most of this suite guards RATIFIED constraints rather than arithmetic. Those
 * cases are marked, because they are not refactorable: changing them requires a
 * methodology decision, not a code review.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_REDUCTION,
  MIN_CREDIBLE_EFFECTIVENESS,
  RESIDUAL_FLOORS,
  computeResidualRisk,
} from "../lib/vendorRisk/residualRisk.js";
import { bandForScore } from "../lib/vendorRisk/riskBands.js";

const CLEAN = { failedMandatoryCount: 0, noEvidenceAtAll: false };

describe("RATIFIED — controls never reduce risk to zero", () => {
  it("a perfect control environment leaves 30% of the inherent exposure", () => {
    const result = computeResidualRisk({ inherentScore: 100, effectivenessScore: 100, ...CLEAN });
    expect(result.score).toBe(30);
    expect(result.reduction_applied).toBe(MAX_REDUCTION);
  });

  it("no inherent score can be driven to zero by any effectiveness", () => {
    for (let inherent = 10; inherent <= 100; inherent += 10) {
      const result = computeResidualRisk({ inherentScore: inherent, effectivenessScore: 100, ...CLEAN });
      expect(result.score, `inherent ${inherent}`).toBeGreaterThan(0);
    }
  });

  it("a Critical vendor with flawless controls lands high in Low, not at zero", () => {
    // The intended shape: excellent controls move a critical vendor a long way,
    // and never all the way.
    const result = computeResidualRisk({ inherentScore: 85, effectivenessScore: 100, ...CLEAN });
    expect(result.score).toBe(26);
    expect(result.rating).toBe("Moderate");
  });
});

describe("RATIFIED — risk acceptance is not an input here", () => {
  it("the function signature has no acceptance parameter", () => {
    // Structural, and deliberately so. Residual is a MEASUREMENT; acceptance is
    // a TREATMENT decision. "Residual: High, accepted by the CFO" is the truth;
    // "Accepted Risk: Moderate" is a lie that survives into a board pack.
    const keys = Object.keys({
      inherentScore: 0,
      inherentRating: undefined,
      effectivenessScore: 0,
      failedMandatoryCount: 0,
      noEvidenceAtAll: false,
    });
    for (const forbidden of ["accepted", "acceptance", "riskAccepted", "treatment", "decision"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("identical measurements produce identical residuals regardless of context", () => {
    // Nothing about how the organisation intends to RESPOND can enter the model,
    // because there is no channel for it to enter through.
    const a = computeResidualRisk({ inherentScore: 70, effectivenessScore: 60, ...CLEAN });
    const b = computeResidualRisk({ inherentScore: 70, effectivenessScore: 60, ...CLEAN });
    expect(a.score).toBe(b.score);
    expect(a.rating).toBe(b.rating);
  });
});

describe("RATIFIED — inherent_understated is preserved, never normalised", () => {
  it("surfaces the exceptional residual > inherent condition", () => {
    // A mild inherent exposure with a wholly unevidenced questionnaire: the
    // no-assurance floor lands above the inherent score.
    const result = computeResidualRisk({
      inherentScore: 20,
      effectivenessScore: 0,
      failedMandatoryCount: 0,
      noEvidenceAtAll: true,
    });

    expect(result.score).toBe(RESIDUAL_FLOORS.NO_ASSURANCE);
    expect(result.score).toBeGreaterThan(20);
    expect(result.inherent_understated).toBe(true);
  });

  it("explains what the flag MEANS rather than just raising it", () => {
    const result = computeResidualRisk({
      inherentScore: 20,
      effectivenessScore: 0,
      failedMandatoryCount: 0,
      noEvidenceAtAll: true,
    });
    const adj = result.basis.adjustments.find((a) => a.rule_id === "R_UNDERSTATED");
    expect(adj).toBeTruthy();
    expect(adj!.explanation).toMatch(/not an error/i);
    expect(adj!.explanation).toMatch(/UNDERSTATED/);
  });

  it("is false in the ordinary case", () => {
    const result = computeResidualRisk({ inherentScore: 80, effectivenessScore: 50, ...CLEAN });
    expect(result.inherent_understated).toBe(false);
    expect(result.score).toBeLessThan(80);
  });

  it("the score is NOT clamped down to inherent to make the flag go away", () => {
    // The tempting "fix" that the ratified instruction forbids.
    const result = computeResidualRisk({
      inherentScore: 5,
      effectivenessScore: 0,
      failedMandatoryCount: 1,
      noEvidenceAtAll: true,
    });
    expect(result.score).toBe(RESIDUAL_FLOORS.NO_ASSURANCE);
    expect(result.score).not.toBe(5);
    expect(result.inherent_understated).toBe(true);
  });
});

describe("the credibility threshold", () => {
  it("grants no reduction to a control environment below the threshold", () => {
    const result = computeResidualRisk({
      inherentScore: 80,
      effectivenessScore: MIN_CREDIBLE_EFFECTIVENESS - 1,
      ...CLEAN,
    });
    expect(result.reduction_applied).toBe(0);
    expect(result.score).toBe(80);
    expect(result.basis.adjustments.map((a) => a.rule_id)).toContain("R0");
  });

  it("grants reduction at exactly the threshold", () => {
    const result = computeResidualRisk({
      inherentScore: 80,
      effectivenessScore: MIN_CREDIBLE_EFFECTIVENESS,
      ...CLEAN,
    });
    expect(result.reduction_applied).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(80);
  });

  it("does not raise R0 when there were no controls at all", () => {
    // Effectiveness 0 with nothing assessed is an absence, not a failed
    // credibility test — R2 covers it, and two explanations for one situation
    // would read as two problems.
    const result = computeResidualRisk({ inherentScore: 50, effectivenessScore: 0, ...CLEAN });
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("R0");
  });
});

describe("floors raise, and only raise", () => {
  it("a failed mandatory control holds residual at Moderate", () => {
    const result = computeResidualRisk({
      inherentScore: 20,
      effectivenessScore: 90,
      failedMandatoryCount: 1,
      noEvidenceAtAll: false,
    });
    expect(result.score).toBe(RESIDUAL_FLOORS.MANDATORY_FAILURE);
    expect(bandForScore(result.score)).toBe("Moderate");
  });

  it("a floor never LOWERS an already-higher score", () => {
    const result = computeResidualRisk({
      inherentScore: 95,
      effectivenessScore: 0,
      failedMandatoryCount: 1,
      noEvidenceAtAll: true,
    });
    expect(result.score).toBe(95);
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("R1");
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("R2");
  });

  it("the arithmetic result survives every floor", () => {
    const result = computeResidualRisk({
      inherentScore: 10,
      effectivenessScore: 95,
      failedMandatoryCount: 1,
      noEvidenceAtAll: false,
    });
    expect(result.arithmetic_score).toBeLessThan(result.score);
    expect(result.arithmetic_rating).toBe("Low");
    const adj = result.basis.adjustments.find((a) => a.rule_id === "R1")!;
    expect(adj.points).toBe(RESIDUAL_FLOORS.MANDATORY_FAILURE - result.arithmetic_score);
  });
});

describe("polarity — the one place the two directions meet", () => {
  it("higher effectiveness always produces LOWER or equal residual", () => {
    // The inversion bug this codebase already carries elsewhere
    // (vendors.current_risk_score) must never reach the methodology.
    let previous = Infinity;
    for (let eff = 0; eff <= 100; eff += 5) {
      const result = computeResidualRisk({ inherentScore: 75, effectivenessScore: eff, ...CLEAN });
      expect(result.score, `effectiveness ${eff}`).toBeLessThanOrEqual(previous);
      previous = result.score;
    }
  });

  it("higher inherent always produces HIGHER or equal residual", () => {
    let previous = -1;
    for (let inh = 0; inh <= 100; inh += 5) {
      const result = computeResidualRisk({ inherentScore: inh, effectivenessScore: 70, ...CLEAN });
      expect(result.score, `inherent ${inh}`).toBeGreaterThanOrEqual(previous);
      previous = result.score;
    }
  });

  it("clamps out-of-range inputs rather than producing a nonsense score", () => {
    const high = computeResidualRisk({ inherentScore: 500, effectivenessScore: 50, ...CLEAN });
    expect(high.score).toBeLessThanOrEqual(100);
    const negative = computeResidualRisk({ inherentScore: -20, effectivenessScore: -5, ...CLEAN });
    expect(negative.score).toBeGreaterThanOrEqual(0);
  });
});

describe("rating divergence is surfaced, not applied", () => {
  it("records a reviewer override that disagrees with the arithmetic", () => {
    const result = computeResidualRisk({
      inherentScore: 30,
      inherentRating: "Critical",
      effectivenessScore: 80,
      ...CLEAN,
    });
    const adj = result.basis.adjustments.find((a) => a.rule_id === "R_RATING_DIVERGENCE");
    expect(adj).toBeTruthy();
    expect(adj!.explanation).toMatch(/reviewed rather than accepted automatically/i);
  });

  it("does NOT force the residual band to the override", () => {
    // Controls must be able to move a Critical vendor down — otherwise assessing
    // them is decorative. And an override that propagates automatically is the
    // same hidden authority the methodology rules out, with a human in the role.
    const result = computeResidualRisk({
      inherentScore: 30,
      inherentRating: "Critical",
      effectivenessScore: 80,
      ...CLEAN,
    });
    expect(result.rating).not.toBe("Critical");
    expect(result.rating).toBe(bandForScore(result.score));
  });

  it("stays silent when the override agrees with the arithmetic", () => {
    const result = computeResidualRisk({
      inherentScore: 80,
      inherentRating: "Critical",
      effectivenessScore: 50,
      ...CLEAN,
    });
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("R_RATING_DIVERGENCE");
  });
});

describe("the basis explains the number", () => {
  it("names both inputs with their polarity spelled out", () => {
    const result = computeResidualRisk({ inherentScore: 70, effectivenessScore: 60, ...CLEAN });
    const labels = result.basis.factors.map((f) => f.label);
    expect(labels).toContain("Inherent risk");
    expect(labels).toContain("Control effectiveness");
    // A reader must never have to re-derive anything, and the two scores run in
    // OPPOSITE directions — so each one says which way it runs.
    expect(result.basis.factors[0]!.detail).toMatch(/higher is worse/i);
    expect(result.basis.factors[1]!.detail).toMatch(/higher is better/i);
  });

  it("states the reduction cap in the customer-facing text", () => {
    const result = computeResidualRisk({ inherentScore: 70, effectivenessScore: 90, ...CLEAN });
    expect(result.basis.factors[1]!.detail).toMatch(/never remove more than 70%/i);
  });

  it("stamps the methodology version", () => {
    const result = computeResidualRisk({ inherentScore: 50, effectivenessScore: 50, ...CLEAN });
    expect(result.basis.method).toBe("vendor_residual_v1");
    expect(result.basis.methodology_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
