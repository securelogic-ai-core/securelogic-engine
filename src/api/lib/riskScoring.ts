/**
 * riskScoring.ts — Pure risk-scoring function for signal_match_suggestions.
 *
 * No I/O. No DB access. Fully unit-testable. Deterministic — same input
 * produces the same output across invocations.
 *
 * FORMULA
 * -------
 *   score = round( severity_w * entity_w * obligation_w * 100 )
 *
 *   severity_w     ∈ (0, 1]   from weights.severity_weights[signal.severity]
 *                              with KEV override → 1.0 when signal.source === 'cisa-kev'
 *   entity_w       ∈ (0, 1]   from weights.entity_criticality_weights[entity.criticality]
 *                              for vendor / ai_system / control / obligation entity types
 *   obligation_w   ∈ (0, 1]   from weights.obligation_priority_weights[entity.priority]
 *                              ONLY when entity.type === 'obligation'; for vendor /
 *                              ai_system / control entity types this dimension is fixed
 *                              at 1.0 (no obligation discount)
 *
 *   score is integer-valued in [0, 100]. Output is clamped to that range
 *   defensively; with weights validated to (0, 1] and the multiplier of
 *   100, normal inputs always produce a value in [1, 100] before rounding.
 *
 * MULTIPLICATION SEMANTICS — "ZERO ON ANY ZERO IS INTENTIONAL"
 * ------------------------------------------------------------
 * Weights are validated at the boundary to (0, 1] (exclusive of zero), so
 * a configured zero weight cannot occur. But if an upstream change ever
 * relaxed validation, a single zero-weight dimension would zero out the
 * whole score by construction. That behavior is intentional — a customer
 * who deliberately weights one dimension at zero is saying "don't surface
 * this at all" — and is surfaced via breakdown.explanation when it
 * happens. Callers should NOT add a min-floor or summation fallback.
 *
 * KEV OVERRIDE
 * ------------
 * When signal.source === 'cisa-kev' (the canonical KEV adapter source
 * string in this codebase, established in
 * 20260501_intelligence_brief_pipeline.sql), severity_w is fixed to 1.0
 * regardless of stored severity. Rationale: KEV listing is operational
 * evidence of in-the-wild exploitation; whatever band the upstream
 * adapter assigned, it should score at the maximum severity weight. The
 * override is documented in the explanation when applied.
 *
 * TWO-VOCABULARY DESIGN — IMPORTANT
 * ---------------------------------
 * Severity and entity criticality both have four conceptual bands but use
 * DIFFERENT lexical vocabularies because they are stored that way:
 *   - severity (cyber_signals.severity):     PascalCase, MIDDLE = 'Moderate'
 *   - entity criticality (vendors / ai_systems): lowercase, MIDDLE = 'medium'
 *   - obligation priority (obligations.priority): lowercase snake_case,
 *                                              {'immediate','near_term','planned','watch'}
 *
 * The function does NOT canonicalize. It looks up each dimension in its
 * own map using the value as stored. This is deliberate: collapsing the
 * vocabularies would invite "Moderate"="medium" bugs and silently mask
 * upstream data corruption. If a future migration normalizes the stored
 * vocabularies, this function gets simpler — but until then, we honor
 * the data as it sits.
 *
 * ENTITY-DIMENSION ASYMMETRY (IMPORTANT — read before changing)
 * -------------------------------------------------------------
 * The entity dimension is interpreted differently per target_type:
 *
 *   - vendor / ai_system: looks up entity.criticality in
 *     weights.entity_criticality_weights. NULL or unrecognized falls
 *     back to MISSING_DATA_DEFAULT (0.5) with an explanation flag —
 *     this is a genuine data gap the customer can fix by setting
 *     vendor / ai_system criticality.
 *
 *   - control: ALWAYS defaults to MISSING_DATA_DEFAULT (0.5) with an
 *     explanation flag noting that controls have no criticality column.
 *     This is a data-shape gap the customer cannot fix today; a future
 *     column-addition package will improve recall without invalidating
 *     existing scores.
 *
 *   - obligation: FIXED at 1.0 as a multiplicative-neutral element,
 *     NOT as a data default. NO explanation flag. The entity dimension
 *     does not apply to obligations by design — obligations carry
 *     priority, not criticality, and the obligation dimension below is
 *     where their per-row weight is captured. Defaulting obligations
 *     to 0.5 here would systematically cap obligation scores at 50,
 *     which inverts the package's stated purpose. Treat obligations
 *     as "the entity dimension does not apply" and use 1.0 (neutral
 *     multiplier), the same way the obligation dimension uses 1.0 for
 *     non-obligation entity types.
 *
 * MISSING-DATA POLICY
 * -------------------
 * Severity null / unknown → 0.5 with explanation flag.
 * Vendor / ai_system criticality null / unknown → 0.5 with explanation flag.
 * Obligation priority null / unknown → 0.5 with explanation flag.
 * (See the entity-dimension asymmetry above for why control and
 * obligation entity-dimension behavior differs.)
 */

const ENTITY_CRITICALITY_KEYS = [
  "critical",
  "high",
  "medium",
  "low"
] as const;

const OBLIGATION_PRIORITY_KEYS = [
  "immediate",
  "near_term",
  "planned",
  "watch"
] as const;

const SEVERITY_KEYS = ["Critical", "High", "Moderate", "Low"] as const;

export type EntityCriticalityKey = (typeof ENTITY_CRITICALITY_KEYS)[number];
export type ObligationPriorityKey = (typeof OBLIGATION_PRIORITY_KEYS)[number];
export type SeverityKey = (typeof SEVERITY_KEYS)[number];

export type EntityCriticalityWeights = Record<EntityCriticalityKey, number>;
export type ObligationPriorityWeights = Record<ObligationPriorityKey, number>;
export type SeverityWeights = Record<SeverityKey, number>;

export type RiskScoringWeights = {
  entity_criticality_weights: EntityCriticalityWeights;
  obligation_priority_weights: ObligationPriorityWeights;
  severity_weights: SeverityWeights;
};

/**
 * Documented defaults — applied when no risk_scoring_weights row exists
 * for the org. Customer-configurable via PUT /api/risk-scoring-weights.
 */
export const DEFAULT_WEIGHTS: RiskScoringWeights = {
  entity_criticality_weights: {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25
  },
  obligation_priority_weights: {
    immediate: 1.0,
    near_term: 0.75,
    planned: 0.5,
    watch: 0.25
  },
  severity_weights: {
    Critical: 1.0,
    High: 0.75,
    Moderate: 0.5,
    Low: 0.25
  }
};

/**
 * The canonical KEV source string in this codebase, established in
 * 20260501_intelligence_brief_pipeline.sql line 126. Centralized as a
 * constant so the override condition is searchable and the magic string
 * is documented in one place.
 */
export const KEV_SOURCE = "cisa-kev";

/**
 * Default weight applied when a dimension's lookup key is missing or
 * unrecognized. Matches the conceptual middle of the band; an
 * explanation flag is added so the score is not mistaken for a real
 * measurement.
 */
export const MISSING_DATA_DEFAULT = 0.5;

export type ScoringSignal = {
  /**
   * One of the SEVERITY_KEYS, or null if missing. Use the value as
   * stored on cyber_signals.severity (PascalCase). Unknown / missing /
   * mis-cased values fall back to MISSING_DATA_DEFAULT with an
   * explanation flag.
   */
  severity: string | null;
  /**
   * The cyber_signals.source string. When equal to KEV_SOURCE, the
   * severity dimension is overridden to 1.0 regardless of stored
   * severity.
   */
  source: string;
};

export type ScoringEntity = {
  type: "vendor" | "ai_system" | "control" | "obligation";
  /**
   * For vendor / ai_system: the stored criticality (lowercase) or null.
   * For control: ALWAYS null — controls have no criticality column.
   *              Surfaced in explanation as the default-applied case.
   * For obligation: criticality is unused; pass null.
   */
  criticality: string | null;
  /**
   * For obligation only: the stored priority (lowercase snake_case) or
   * null. Ignored for non-obligation entity types (which fix the
   * obligation dimension at 1.0).
   */
  priority?: string | null;
};

export type ScoringInput = {
  signal: ScoringSignal;
  entity: ScoringEntity;
  weights: RiskScoringWeights;
};

export type ScoringResult = {
  /** Integer in [0, 100]. */
  score: number;
  breakdown: {
    severity: number;
    entity: number;
    obligation: number;
  };
  /**
   * Human-readable explanation listing which dimensions were resolved
   * from configured weights, which fell back to MISSING_DATA_DEFAULT,
   * and whether KEV override applied. Suitable for surfacing in the
   * suggestion-queue UI as a per-row "why is this score X?" tooltip.
   */
  explanation: string;
};

function clampInteger(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n);
}

function isEntityCriticalityKey(v: unknown): v is EntityCriticalityKey {
  return (
    typeof v === "string" &&
    (ENTITY_CRITICALITY_KEYS as readonly string[]).includes(v)
  );
}

function isObligationPriorityKey(v: unknown): v is ObligationPriorityKey {
  return (
    typeof v === "string" &&
    (OBLIGATION_PRIORITY_KEYS as readonly string[]).includes(v)
  );
}

function isSeverityKey(v: unknown): v is SeverityKey {
  return typeof v === "string" && (SEVERITY_KEYS as readonly string[]).includes(v);
}

/**
 * Compute the risk score for a (signal, entity) pair given a configured
 * weights map. Deterministic and side-effect-free. See module-level JSDoc
 * for formula, missing-data policy, and KEV override semantics.
 */
export function computeRiskScore(input: ScoringInput): ScoringResult {
  const { signal, entity, weights } = input;
  const explanationParts: string[] = [];

  // ---- severity dimension ----
  let severityWeight: number;
  const isKev = signal.source === KEV_SOURCE;
  if (isKev) {
    severityWeight = 1.0;
    explanationParts.push(
      `severity: KEV override applied (source='${KEV_SOURCE}') → weight=1.0 regardless of stored severity='${signal.severity ?? "null"}'`
    );
  } else if (isSeverityKey(signal.severity)) {
    severityWeight = weights.severity_weights[signal.severity];
    explanationParts.push(
      `severity: '${signal.severity}' → weight=${severityWeight}`
    );
  } else {
    severityWeight = MISSING_DATA_DEFAULT;
    explanationParts.push(
      `severity: defaulted (signal.severity='${signal.severity ?? "null"}' not a recognized severity key) → weight=${MISSING_DATA_DEFAULT}`
    );
  }

  // ---- entity-criticality dimension ----
  // See ENTITY-DIMENSION ASYMMETRY in module-level JSDoc for the rationale
  // behind the per-target_type branching here.
  let entityWeight: number;
  if (entity.type === "obligation") {
    // Obligation-typed entities use 1.0 as a multiplicative-neutral
    // element by design — the entity dimension does not apply to
    // obligations (their per-row weight is the priority dimension below).
    // No explanation flag: this is type-by-design, not a data gap.
    entityWeight = 1.0;
  } else if (entity.type === "control") {
    // Controls have no criticality column today. Always default; surface
    // that fact explicitly so callers know the score reflects a default,
    // not a measurement. A future column-addition package will enable
    // real criticality without invalidating existing scores.
    entityWeight = MISSING_DATA_DEFAULT;
    explanationParts.push(
      `entity: defaulted (controls have no criticality column; defaulted to ${MISSING_DATA_DEFAULT})`
    );
  } else if (isEntityCriticalityKey(entity.criticality)) {
    // vendor / ai_system with valid criticality.
    entityWeight = weights.entity_criticality_weights[entity.criticality];
    explanationParts.push(
      `entity: ${entity.type} criticality='${entity.criticality}' → weight=${entityWeight}`
    );
  } else {
    // vendor / ai_system with NULL or unrecognized criticality — genuine
    // data gap the customer can fix.
    entityWeight = MISSING_DATA_DEFAULT;
    explanationParts.push(
      `entity: defaulted (${entity.type} criticality='${entity.criticality ?? "null"}' not a recognized key) → weight=${MISSING_DATA_DEFAULT}`
    );
  }

  // ---- obligation-priority dimension ----
  let obligationWeight: number;
  if (entity.type !== "obligation") {
    obligationWeight = 1.0;
    explanationParts.push(
      `obligation: not applicable (entity.type='${entity.type}') → weight=1.0`
    );
  } else if (isObligationPriorityKey(entity.priority)) {
    obligationWeight = weights.obligation_priority_weights[entity.priority];
    explanationParts.push(
      `obligation: priority='${entity.priority}' → weight=${obligationWeight}`
    );
  } else {
    obligationWeight = MISSING_DATA_DEFAULT;
    explanationParts.push(
      `obligation: defaulted (priority='${entity.priority ?? "null"}' not a recognized key) → weight=${MISSING_DATA_DEFAULT}`
    );
  }

  // ---- multiplication + clamp + round ----
  const product = severityWeight * entityWeight * obligationWeight * 100;
  const score = clampInteger(product, 0, 100);

  // Surface zero-on-zero behavior when it occurs. Validation forbids
  // configured zero, but defensive surfacing makes the formula honest
  // in case some future code path supplies a zero weight.
  if (product === 0) {
    explanationParts.push(
      "score zeroed: at least one dimension weighted 0; multiplication zero-on-any-zero is intentional"
    );
  }

  return {
    score,
    breakdown: {
      severity: severityWeight,
      entity: entityWeight,
      obligation: obligationWeight
    },
    explanation: explanationParts.join("; ")
  };
}

export {
  ENTITY_CRITICALITY_KEYS,
  OBLIGATION_PRIORITY_KEYS,
  SEVERITY_KEYS
};
