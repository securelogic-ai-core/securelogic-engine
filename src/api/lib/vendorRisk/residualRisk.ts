/**
 * residualRisk.ts — inherent risk as reduced by controls that actually work.
 *
 * The third deterministic model, and the one carrying the most ratified
 * constraints. Read them before changing anything here.
 *
 * ── The shape ────────────────────────────────────────────────────────────────
 *   residual = inherent × (1 − effectiveness × MAX_REDUCTION)
 *
 * Both inherent and residual are 0–100 HIGHER = WORSE. Effectiveness is 0–100
 * HIGHER = BETTER. That polarity flip is the single most dangerous thing in this
 * file — it is also unavoidable, because "how bad is the exposure" and "how good
 * are the controls" genuinely run in opposite directions. Every crossing is
 * marked in the code.
 *
 * ── RATIFIED: controls never reduce risk to zero ─────────────────────────────
 * MAX_REDUCTION caps how much of the inherent exposure controls may remove.
 * Perfect controls do not make a vendor holding your entire patient database
 * risk-free; they make it a well-managed serious risk. A model that lets
 * effectiveness 100 produce residual 0 would tell a board that a critical vendor
 * is no risk at all, which is false and would be believed.
 *
 * ── RATIFIED: risk acceptance MUST NOT reduce residual ───────────────────────
 * There is no acceptance input to this function and there must never be one.
 * Residual is a MEASUREMENT. Acceptance is a TREATMENT DECISION — it changes who
 * is answerable, not how exposed the organisation is. "Residual: High, accepted
 * by the CFO on 12 August" is the truth. "Accepted Risk: Moderate" is a lie that
 * survives into a board pack, and the person who accepted it is the only one who
 * knows it was ever High.
 *
 * ── RATIFIED: preserve `inherent_understated` ────────────────────────────────
 * The arithmetic can produce residual > inherent when a floor rule fires on a
 * control environment so weak it reveals the inherent assessment was optimistic.
 * The instruction is explicit: do NOT silently normalise this away. It is
 * surfaced as a named flag, because it is one of the most informative signals the
 * methodology can produce — it means the intake answers understated the exposure,
 * and that is worth a human's attention.
 *
 * ── LLM independence ─────────────────────────────────────────────────────────
 * Pure arithmetic over the two prior models. No model call, no network, no I/O.
 */

import { bandForScore, clampScore, type RiskBand } from "./riskBands.js";
import type { MethodologyAdjustment, MethodologyBasis } from "./methodologyVersion.js";
import { METHODOLOGY_VERSION } from "./methodologyVersion.js";

/**
 * The most of the inherent exposure that controls may remove: 70%.
 *
 * A vendor with a perfect control environment retains 30% of its inherent risk,
 * which is the honest statement that controls fail, are bypassed, and are
 * assessed at a point in time. A Critical-inherent vendor (say 85) with flawless
 * controls lands at 26 — the bottom of Moderate. That is the intended shape:
 * excellent controls move a critical vendor a long way, and never all the way.
 * They cannot make it Low, and a board that reads "Moderate" for a vendor holding
 * the crown jewels is being told something true.
 */
export const MAX_REDUCTION = 0.7;

/**
 * Below this effectiveness, controls are treated as providing NO reduction.
 *
 * A vendor scoring 12 has not earned a 8% discount on their inherent risk; they
 * have demonstrated an absent control environment. Granting proportional credit
 * at the bottom of the range rewards the appearance of a programme.
 */
export const MIN_CREDIBLE_EFFECTIVENESS = 20;

/**
 * Floors: control environments so weak that residual cannot be reported as
 * comfortable regardless of how modest the inherent exposure was.
 */
export const RESIDUAL_FLOORS = {
  /** A failed mandatory control keeps residual at least Moderate. */
  MANDATORY_FAILURE: 25,
  /** An unevidenced questionnaire is an unverified one. */
  NO_ASSURANCE: 40,
} as const;

export type ResidualFactor = {
  label: string;
  /** The value that entered the arithmetic. */
  value: number;
  /** Plain-language statement of what this term did. Customer-visible. */
  detail: string;
};

export type ResidualRiskBasis = MethodologyBasis<"vendor_residual_v1", ResidualFactor>;

export type ResidualRiskInput = {
  /** 0–100, HIGHER = WORSE. */
  inherentScore: number;
  /** The rating a human set, if they overrode the arithmetic. Authority, not input. */
  inherentRating?: RiskBand;
  /** 0–100, HIGHER = BETTER. */
  effectivenessScore: number;
  failedMandatoryCount: number;
  /** True when NOTHING in the questionnaire rose above self-assertion. */
  noEvidenceAtAll: boolean;
};

export type ResidualRiskResult = {
  /** 0–100, HIGHER = WORSE. */
  score: number;
  rating: RiskBand;
  /** Before floors. Exposed so a reviewer sees what the arithmetic alone said. */
  arithmetic_score: number;
  arithmetic_rating: RiskBand;
  /**
   * The exceptional condition: the methodology produced residual ABOVE inherent.
   * Ratified — surfaced, never normalised away. It means the intake answers
   * understated the exposure.
   */
  inherent_understated: boolean;
  /** How much of the inherent exposure the controls actually removed, 0–1. */
  reduction_applied: number;
  basis: ResidualRiskBasis;
};

export function computeResidualRisk(input: ResidualRiskInput): ResidualRiskResult {
  const inherent = clampScore(input.inherentScore);
  const effectiveness = clampScore(input.effectivenessScore);

  const factors: ResidualFactor[] = [];
  const adjustments: MethodologyAdjustment[] = [];

  factors.push({
    label: "Inherent risk",
    value: inherent,
    detail: `The exposure this vendor represents before any consideration of their controls (${inherent}/100, higher is worse).`,
  });

  // ── The polarity crossing. Effectiveness is higher-is-better; everything
  //    downstream is higher-is-worse. This is the only place they meet.
  const credible = effectiveness >= MIN_CREDIBLE_EFFECTIVENESS;
  const reduction = credible ? (effectiveness / 100) * MAX_REDUCTION : 0;

  factors.push({
    label: "Control effectiveness",
    value: effectiveness,
    detail: credible
      ? `Controls scored ${effectiveness}/100 (higher is better), removing ${Math.round(reduction * 100)}% of the inherent exposure. Controls can never remove more than ${Math.round(MAX_REDUCTION * 100)}%.`
      : `Controls scored ${effectiveness}/100, below the ${MIN_CREDIBLE_EFFECTIVENESS} threshold at which a control environment is considered to provide measurable reduction. No reduction applied.`,
  });

  if (!credible && effectiveness > 0) {
    adjustments.push({
      rule_id: "R0",
      explanation: `Control effectiveness of ${effectiveness} is below the credibility threshold of ${MIN_CREDIBLE_EFFECTIVENESS}. Partial credit at this level would reward the appearance of a control programme rather than its operation, so no reduction was applied.`,
    });
  }

  const arithmetic = clampScore(Math.round(inherent * (1 - reduction)));
  let score = arithmetic;

  // ── Floors. Each raises the score; none may lower it.
  if (input.failedMandatoryCount > 0 && score < RESIDUAL_FLOORS.MANDATORY_FAILURE) {
    adjustments.push({
      rule_id: "R1",
      explanation: `${input.failedMandatoryCount} mandatory control(s) failed. Residual risk is held at a minimum of ${RESIDUAL_FLOORS.MANDATORY_FAILURE} — a required control that does not work cannot produce a low residual rating, however limited the inherent exposure.`,
      points: RESIDUAL_FLOORS.MANDATORY_FAILURE - score,
    });
    score = RESIDUAL_FLOORS.MANDATORY_FAILURE;
  }

  if (input.noEvidenceAtAll && score < RESIDUAL_FLOORS.NO_ASSURANCE) {
    adjustments.push({
      rule_id: "R2",
      explanation: `No control response was supported by evidence — the entire questionnaire rests on the vendor's own assertions. Residual risk is held at a minimum of ${RESIDUAL_FLOORS.NO_ASSURANCE}, because an unverified control environment is an unknown one rather than a working one.`,
      points: RESIDUAL_FLOORS.NO_ASSURANCE - score,
    });
    score = RESIDUAL_FLOORS.NO_ASSURANCE;
  }

  // ── The exceptional condition, preserved rather than normalised.
  const inherentUnderstated = score > inherent;
  if (inherentUnderstated) {
    adjustments.push({
      rule_id: "R_UNDERSTATED",
      explanation: `Residual risk (${score}) exceeds inherent risk (${inherent}). This is not an error: the control environment is weak enough that a floor rule applied above the inherent assessment. It indicates the intake answers UNDERSTATED this vendor's exposure, and the inherent assessment should be revisited.`,
    });
  }

  // ── Rating authority: divergence is SURFACED, never silently applied.
  //
  // A reviewer who overrode inherent to Critical against mild arithmetic made a
  // judgement about exposure, and that judgement must not vanish. But it must
  // also not silently force the residual band, for two reasons. Controls SHOULD
  // be able to move a Critical vendor down — that is the entire purpose of
  // assessing them, and a residual that can never fall below the inherent
  // override makes the assessment decorative. And an override that
  // automatically propagates is exactly the hidden authority the methodology
  // rules out, merely with a human as the hidden authority instead of a model.
  //
  // So this records the divergence for the reviewer and leaves the computed band
  // intact — the same treatment `scoreBand()` already gives rating/score
  // divergence elsewhere in the platform.
  const arithmeticRating = bandForScore(arithmetic);
  const rating = bandForScore(score);

  if (input.inherentRating) {
    const inherentArithmeticBand = bandForScore(inherent);
    if (input.inherentRating !== inherentArithmeticBand) {
      adjustments.push({
        rule_id: "R_RATING_DIVERGENCE",
        explanation: `The inherent rating was set to ${input.inherentRating} by a reviewer, against a calculated band of ${inherentArithmeticBand}. The residual rating below (${rating}) is computed from the inherent SCORE and the control effectiveness. Where a reviewer's judgement of exposure differs from the arithmetic, the residual rating should be reviewed rather than accepted automatically.`,
      });
    }
  }

  return {
    score,
    rating,
    arithmetic_score: arithmetic,
    arithmetic_rating: arithmeticRating,
    inherent_understated: inherentUnderstated,
    reduction_applied: Math.round(reduction * 1000) / 1000,
    basis: {
      method: "vendor_residual_v1",
      version: 1,
      methodology_version: METHODOLOGY_VERSION,
      factors,
      adjustments,
    },
  };
}
