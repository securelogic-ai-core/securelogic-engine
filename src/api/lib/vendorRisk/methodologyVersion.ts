/**
 * methodologyVersion.ts — the versioned identity of the Vendor Assurance risk
 * methodology.
 *
 * Ratified requirement (methodology decision 1, and the versioning section):
 * SecureLogic must be able to answer, years later,
 *
 *     "this assessment received this rating because methodology version X and
 *      requirement-set version Y were active at the time"
 *
 * and an existing engagement's stored rating must NEVER silently change when the
 * methodology is revised.
 *
 * Three artifacts version INDEPENDENTLY, because they change for different
 * reasons and at different rates:
 *
 *   - METHODOLOGY_VERSION   the inherent / effectiveness / evidence / residual
 *                           models and their weight + level tables.
 *   - SCOPE_RULE_VERSION    the applicability rule corpus (S1–S4).
 *   - requirement-set       a content hash of the frameworks + requirements +
 *                           scope_tags actually in effect for an org. Computed
 *                           per engagement at scoping time, not a constant —
 *                           org A and org B legitimately differ.
 *
 * All three are STAMPED on the engagement when it is created and are never
 * rewritten. Recompute reads the stamped values, not the current ones. A
 * methodology upgrade therefore applies only to engagements created after it;
 * an existing engagement may be OFFERED a re-evaluation, which writes an
 * additional basis record rather than mutating the historical one.
 *
 * Weights are FIXED, not customer-configurable (ratified decision 1). They live
 * in code and are pinned by version here; a future governed "methodology
 * profile" is a new version row plus an org binding, not a mutable per-org
 * weight map.
 */

/** Semantic version of the scoring models. Bump on ANY weight/level/rule change. */
export const METHODOLOGY_VERSION = "1.0.0" as const;

/** Semantic version of the questionnaire-scoping rule corpus. */
export const SCOPE_RULE_VERSION = "1.0.0" as const;

/**
 * The shared, versioned explainability envelope.
 *
 * Extends the shipped RiskScoreBasis shape (`{ method, version, ... }`,
 * src/api/lib/riskScore.ts) along its documented forward seam: a new `method`
 * tag with additional fields, no JSONB reshape and no backfill of existing rows.
 *
 * `factors` is the by-value term list — the same explainability substrate the
 * applicability engine uses for its ReasoningStep corpus. It is what the UI
 * renders to answer "why is this vendor High?", so it must be self-contained:
 * a reader must never have to re-derive anything to understand the number.
 *
 * NOTE: this envelope is TENANT-VISIBLE. Anything added to it must be safe to
 * show the customer.
 */
export type MethodologyBasis<TMethod extends string, TFactor> = {
  method: TMethod;
  version: 1;
  /** Stamped at engagement creation; recompute uses these, never the current constants. */
  methodology_version: string;
  /** Ordered, by-value contributing terms. */
  factors: TFactor[];
  /** Named rules that fired and changed the outcome (floors, escalations, caps). */
  adjustments: MethodologyAdjustment[];
};

/**
 * A named rule that altered the arithmetic result. Recorded rather than applied
 * silently — the ratified requirement is that if arithmetic produces Low and a
 * floor raises it to High, the system must expose the arithmetic result, the
 * rule, the reason it fired, the adjustment, and the final rating.
 */
export type MethodologyAdjustment = {
  /** Stable rule identifier, e.g. 'E1', 'F2', 'CAP_AT_INHERENT'. */
  rule_id: string;
  /** What the rule concluded, in plain language, for the customer-facing panel. */
  explanation: string;
  /** Points added/removed, when the rule moved the score. Absent for band-only rules. */
  points?: number;
};
