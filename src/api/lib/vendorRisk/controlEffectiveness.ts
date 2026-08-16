/**
 * controlEffectiveness.ts — how well the vendor's controls actually work.
 *
 * The second of the three deterministic models. Inherent risk asks "how much
 * damage could this vendor do to us"; this asks "how much of that do their
 * controls actually stop"; residual combines them.
 *
 * ── The ladder ───────────────────────────────────────────────────────────────
 * A control's effectiveness is NOT the vendor's answer. It is the vendor's
 * answer AS QUALIFIED BY what backs it up. The rungs, weakest to strongest:
 *
 *   0  not_assessed   nobody looked. Scores zero, and is NOT the same as N/A.
 *   1  asserted       the vendor said yes. No evidence at all.
 *   2  documented     the vendor attached something. Nobody has read it.
 *   3  evidenced      a human or an analyzer confirmed the document supports it.
 *   4  attested       an independent auditor attests it (SOC 2, ISO cert).
 *
 * A vendor claiming `pass` with nothing behind it therefore lands at `asserted`,
 * not at "effective" — which is the single most important property of this
 * model. Self-attestation is the weakest form of assurance in every framework
 * that discusses assurance at all, and a methodology that treats an unevidenced
 * "yes" as a working control produces exactly the false comfort third-party risk
 * management exists to prevent.
 *
 * ── Why not_applicable is EXCLUDED, not scored zero ──────────────────────────
 * These two are constantly conflated and they are opposites:
 *
 *   not_assessed    we asked, nobody answered. That is a GAP. Scores 0.
 *   not_applicable  we asked, and the control genuinely does not apply to this
 *                   service. That is not a gap; it is a question that should not
 *                   have been asked. It leaves the DENOMINATOR entirely.
 *
 * Scoring N/A as zero punishes a vendor for the breadth of our own questionnaire
 * and makes a narrow, well-run SaaS look worse than a sprawling one. Counting it
 * as a pass inflates every score. Excluding it is the only defensible option, and
 * the count is reported so a reviewer can see how much of the questionnaire
 * dropped out — a scope where most items are N/A is a scoping defect, and this
 * is where it becomes visible.
 *
 * ── Why mandatory failures are not just "some more zeros" ────────────────────
 * A weighted mean is a poor model of assurance: twenty passing trivia can bury
 * one failed encryption control. Mandatory items therefore carry a FLOOR — a
 * failed mandatory control caps overall effectiveness regardless of the average,
 * and the cap is recorded as an adjustment rather than folded silently into the
 * number.
 *
 * ── LLM independence ────────────────────────────────────────────────────────
 * Nothing here calls a model. `evidenced` is reachable by a HUMAN reviewer
 * confirming a document, and an analyzer may also produce it — but the analyzer
 * is an accelerator, never a precondition. With every AI flag off, an engagement
 * still reaches a defensible effectiveness score; it just takes a person longer.
 */

import type { MethodologyAdjustment, MethodologyBasis } from "./methodologyVersion.js";
import type { ScopeDepth } from "./scopeResolver.js";
import { METHODOLOGY_VERSION } from "./methodologyVersion.js";

/* ────────────────────────────────────────────────────────────────────────────
   The vendor's structured answer. Matches the shipped requirement_responses
   status CHECK exactly — this is the deterministic input the portal collects,
   and the reason a free-text-only questionnaire was rejected.
   ──────────────────────────────────────────────────────────────────────────── */

export const RESPONSE_STATUSES = ["pass", "partial", "fail", "not_assessed", "not_applicable"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/* ────────────────────────────────────────────────────────────────────────────
   The assurance ladder — what BACKS the answer.
   ──────────────────────────────────────────────────────────────────────────── */

export const ASSURANCE_LEVELS = [
  "not_assessed",
  "asserted",
  "documented",
  "evidenced",
  "attested",
] as const;
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

/**
 * The multiplier each rung applies to a claimed answer.
 *
 * These are deliberately steep at the bottom. The gap between "the vendor says
 * so" (0.5) and "somebody checked" (0.9) is the entire value proposition of a
 * vendor assurance programme; a shallow curve would let a vendor talk their way
 * to a good score.
 *
 * `attested` exceeds `evidenced` only slightly (1.0 vs 0.9). An independent
 * auditor's opinion is the strongest assurance available, but it is periodic and
 * scoped — a clean SOC 2 is not a guarantee about today, and modelling it as
 * meaningfully better than a reviewer who read the actual evidence would
 * overstate what a report is.
 */
export const ASSURANCE_MULTIPLIERS: Record<AssuranceLevel, number> = {
  not_assessed: 0,
  asserted: 0.5,
  documented: 0.7,
  evidenced: 0.9,
  attested: 1.0,
};

/**
 * The credit a claimed answer earns before assurance is applied.
 *
 * `partial` at 0.5 is a judgement: a partially implemented control provides
 * real but incomplete protection, and modelling it as either full credit or none
 * loses the distinction the answer exists to capture.
 */
export const STATUS_CREDIT: Record<ResponseStatus, number> = {
  pass: 1.0,
  partial: 0.5,
  fail: 0,
  not_assessed: 0,
  not_applicable: 0, // never reaches the arithmetic — excluded from the denominator
};

/**
 * How much a single control counts, by the depth at which it was asked.
 *
 * The keys are the SHIPPED `ScopeDepth` vocabulary — `full | confirm | attest` —
 * and are typed to it so the two cannot drift. They did drift once: an earlier
 * draft of this file used `standard` and `attestation`, which meant every
 * `confirm` and `attest` control fell through to a single default weight and the
 * depth distinction the scope resolver computes was silently discarded. Typing
 * the record makes that a compile error rather than a quiet mis-weighting.
 *
 * `attest` at 0.5 reflects what the ask actually was: "confirm you hold an
 * attestation", not "demonstrate the control". A vendor who clears a shallow ask
 * has told us less, so it counts for less — in both directions.
 */
export const DEPTH_WEIGHTS: Record<ScopeDepth, number> = {
  full: 1.0,
  confirm: 0.8,
  attest: 0.5,
};

/** The weight used when a depth is absent or unrecognised — the middle rung. */
export const DEFAULT_DEPTH_WEIGHT = DEPTH_WEIGHTS.confirm;

/* ────────────────────────────────────────────────────────────────────────────
   Input and output
   ──────────────────────────────────────────────────────────────────────────── */

export type ControlResponse = {
  requirement_id: string;
  /** For the customer-facing panel; never used in arithmetic. */
  reference?: string;
  status: ResponseStatus;
  /** What backs the answer. Derived by `assuranceFor`, not taken from the vendor. */
  assurance: AssuranceLevel;
  mandatory: boolean;
  /** The shipped ScopeDepth. Absent or unrecognised weights as `confirm`. */
  depth?: string;
};

export type EffectivenessFactor = {
  requirement_id: string;
  reference?: string;
  status: ResponseStatus;
  assurance: AssuranceLevel;
  mandatory: boolean;
  weight: number;
  /** credit × multiplier × weight — this control's contribution to the numerator. */
  contribution: number;
};

export type EffectivenessBasis = MethodologyBasis<"vendor_effectiveness_v1", EffectivenessFactor>;

export type EffectivenessResult = {
  /** 0–100, HIGHER = BETTER. The one score in this module with that polarity. */
  score: number;
  /** Before mandatory floors and coverage caps. Exposed, never hidden. */
  arithmetic_score: number;
  /** Items that left the denominator because they do not apply. */
  not_applicable_count: number;
  /** Items nobody answered. A GAP, and counted as such. */
  not_assessed_count: number;
  /** Items in scope, excluding not_applicable. */
  assessed_count: number;
  /** Mandatory items that failed outright. */
  failed_mandatory_count: number;
  /** assessed − not_assessed, over assessed. 1.0 means the vendor answered everything. */
  response_coverage: number;
  basis: EffectivenessBasis;
};

/**
 * Derive the assurance rung from what actually exists.
 *
 * Deliberately NOT a vendor-supplied field. A vendor asked to self-report how
 * well-evidenced their answer is will report generously, and the whole ladder
 * would collapse into a second opinion column. This function takes only
 * observable facts: did they attach a file, did somebody confirm it, is there an
 * independent attestation on record.
 */
export function assuranceFor(args: {
  status: ResponseStatus;
  evidenceCount: number;
  /** A human reviewer or an analyzer confirmed the evidence supports the claim. */
  evidenceConfirmed: boolean;
  /** An independent auditor's report covers this control. */
  independentlyAttested: boolean;
}): AssuranceLevel {
  // Nothing was claimed, so there is nothing for evidence to support. This
  // ordering matters: a vendor who attaches a document and answers `fail` is
  // being honest, and must not be lifted up the ladder for it.
  if (args.status === "not_assessed") return "not_assessed";
  if (args.status === "fail") return "asserted";

  if (args.independentlyAttested) return "attested";
  if (args.evidenceConfirmed && args.evidenceCount > 0) return "evidenced";
  if (args.evidenceCount > 0) return "documented";
  return "asserted";
}

/* ────────────────────────────────────────────────────────────────────────────
   Adjustment rules. Named, so a customer panel can say WHICH rule fired.
   ──────────────────────────────────────────────────────────────────────────── */

/** A failed mandatory control caps effectiveness here, however good the average. */
export const MANDATORY_FAILURE_CAP = 40;

/** Two or more failed mandatory controls is a systemic finding, not a lapse. */
export const MANDATORY_MULTI_FAILURE_CAP = 25;

/**
 * Below this response coverage, the score is capped: a vendor who answered a
 * fifth of the questionnaire well has not demonstrated anything, and a high
 * average over a tiny sample is the most misleading output this model could
 * produce.
 */
export const MIN_CREDIBLE_COVERAGE = 0.6;
export const LOW_COVERAGE_CAP = 50;

export function computeControlEffectiveness(responses: ControlResponse[]): EffectivenessResult {
  const applicable = responses.filter((r) => r.status !== "not_applicable");
  const notApplicable = responses.length - applicable.length;

  const factors: EffectivenessFactor[] = [];
  const adjustments: MethodologyAdjustment[] = [];

  let numerator = 0;
  let denominator = 0;
  let notAssessed = 0;
  let failedMandatory = 0;

  for (const r of applicable) {
    const weight = DEPTH_WEIGHTS[r.depth as ScopeDepth] ?? DEFAULT_DEPTH_WEIGHT;
    const credit = STATUS_CREDIT[r.status];
    const multiplier = ASSURANCE_MULTIPLIERS[r.assurance];
    const contribution = credit * multiplier * weight;

    numerator += contribution;
    denominator += weight;

    if (r.status === "not_assessed") notAssessed += 1;
    if (r.mandatory && r.status === "fail") failedMandatory += 1;

    factors.push({
      requirement_id: r.requirement_id,
      ...(r.reference ? { reference: r.reference } : {}),
      status: r.status,
      assurance: r.assurance,
      mandatory: r.mandatory,
      weight,
      contribution: Math.round(contribution * 1000) / 1000,
    });
  }

  // An engagement with nothing applicable scores zero and says why. Returning a
  // neutral 50 would let an empty questionnaire read as a middling vendor.
  const arithmetic = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  let score = arithmetic;

  if (denominator === 0) {
    adjustments.push({
      rule_id: "EF0",
      explanation:
        "No applicable controls were assessed, so no effectiveness could be established. " +
        "This is an absence of evidence, not a finding of weakness.",
    });
  }

  const coverage = applicable.length > 0 ? (applicable.length - notAssessed) / applicable.length : 0;

  // ── Caps. Applied weakest-binding-last so the strongest constraint wins, and
  //    each one that FIRES is recorded even when a later cap binds harder.
  if (failedMandatory >= 2 && score > MANDATORY_MULTI_FAILURE_CAP) {
    adjustments.push({
      rule_id: "EF2",
      explanation: `${failedMandatory} mandatory controls failed. Multiple mandatory failures indicate a systemic control weakness, so overall effectiveness is capped at ${MANDATORY_MULTI_FAILURE_CAP} regardless of performance elsewhere.`,
      points: MANDATORY_MULTI_FAILURE_CAP - score,
    });
    score = MANDATORY_MULTI_FAILURE_CAP;
  } else if (failedMandatory === 1 && score > MANDATORY_FAILURE_CAP) {
    adjustments.push({
      rule_id: "EF1",
      explanation: `A mandatory control failed. Strong performance elsewhere does not compensate for a required control, so overall effectiveness is capped at ${MANDATORY_FAILURE_CAP}.`,
      points: MANDATORY_FAILURE_CAP - score,
    });
    score = MANDATORY_FAILURE_CAP;
  }

  if (applicable.length > 0 && coverage < MIN_CREDIBLE_COVERAGE && score > LOW_COVERAGE_CAP) {
    adjustments.push({
      rule_id: "EF3",
      explanation: `Only ${Math.round(coverage * 100)}% of applicable controls were answered. A high score over a small sample is not evidence of a strong control environment, so effectiveness is capped at ${LOW_COVERAGE_CAP} until the questionnaire is more complete.`,
      points: LOW_COVERAGE_CAP - score,
    });
    score = LOW_COVERAGE_CAP;
  }

  // Reported, not applied: a scope where most items dropped out is a SCOPING
  // defect, and the reviewer is the right place to catch it.
  if (notApplicable > 0 && notApplicable >= responses.length / 2) {
    adjustments.push({
      rule_id: "EF4",
      explanation: `${notApplicable} of ${responses.length} scoped controls were marked not applicable. This does not change the score — non-applicable controls are excluded from the calculation rather than penalised — but a scope that is largely inapplicable should be reviewed.`,
    });
  }

  return {
    score,
    arithmetic_score: arithmetic,
    not_applicable_count: notApplicable,
    not_assessed_count: notAssessed,
    assessed_count: applicable.length,
    failed_mandatory_count: failedMandatory,
    response_coverage: Math.round(coverage * 1000) / 1000,
    basis: {
      method: "vendor_effectiveness_v1",
      version: 1,
      methodology_version: METHODOLOGY_VERSION,
      factors,
      adjustments,
    },
  };
}
