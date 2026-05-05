/**
 * riskScoringWeightsValidation.ts — Pure validation for the PUT body of
 * /api/risk-scoring-weights.
 *
 * No I/O. No DB access. Fully unit-testable.
 *
 * Each of the three weight maps must have EXACTLY its canonical key set
 * (no extras, none missing) and every value must be a number in (0, 1].
 * Two-vocabulary design is honored: severity_weights uses PascalCase
 * keys; entity_criticality_weights and obligation_priority_weights use
 * lowercase / lowercase-snake_case keys respectively. See riskScoring.ts
 * for the full design rationale.
 */

import {
  ENTITY_CRITICALITY_KEYS,
  OBLIGATION_PRIORITY_KEYS,
  SEVERITY_KEYS,
  type RiskScoringWeights
} from "./riskScoring.js";

export type RiskScoringWeightsPutResult =
  | { input: RiskScoringWeights }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate that `value` is a plain object whose key set equals
 * `expectedKeys` exactly (no extras, none missing) and every value is a
 * number in the open-on-zero / closed-on-one interval (0, 1].
 *
 * Returns null on success, or a structured error on failure. The error
 * codes are field-prefixed by the caller for clear surfacing.
 */
function validateWeightMap(
  value: unknown,
  expectedKeys: readonly string[],
  fieldName: string
): { error: string; detail?: string } | null {
  if (!isPlainObject(value)) {
    return {
      error: `${fieldName}_must_be_object`,
      detail: `${fieldName} must be a JSON object mapping keys to numbers`
    };
  }
  const actualKeys = Object.keys(value);
  const expected = new Set(expectedKeys);
  const actual = new Set(actualKeys);

  const missing = [...expected].filter((k) => !actual.has(k));
  if (missing.length > 0) {
    return {
      error: `${fieldName}_missing_keys`,
      detail: `${fieldName} is missing required key(s): ${missing.join(", ")}`
    };
  }

  const extra = [...actual].filter((k) => !expected.has(k));
  if (extra.length > 0) {
    return {
      error: `${fieldName}_unexpected_keys`,
      detail: `${fieldName} contains unexpected key(s): ${extra.join(", ")}. Allowed: ${expectedKeys.join(", ")}`
    };
  }

  for (const k of expectedKeys) {
    const v = value[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return {
        error: `${fieldName}_value_must_be_number`,
        detail: `${fieldName}.${k} must be a finite number`
      };
    }
    // Half-open interval: zero excluded (would zero out the score by
    // construction; if the customer wants that, they should configure
    // it via a different mechanism, not by sneaking it in as a weight).
    // One included.
    if (v <= 0 || v > 1) {
      return {
        error: `${fieldName}_value_out_of_range`,
        detail: `${fieldName}.${k}=${v} is out of range; weights must be in (0, 1]`
      };
    }
  }

  return null;
}

export function validateRiskScoringWeightsPut(
  body: unknown
): RiskScoringWeightsPutResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!("entity_criticality_weights" in b)) {
    return { error: "entity_criticality_weights_required" };
  }
  const entErr = validateWeightMap(
    b.entity_criticality_weights,
    ENTITY_CRITICALITY_KEYS,
    "entity_criticality_weights"
  );
  if (entErr) return entErr;

  if (!("obligation_priority_weights" in b)) {
    return { error: "obligation_priority_weights_required" };
  }
  const oblErr = validateWeightMap(
    b.obligation_priority_weights,
    OBLIGATION_PRIORITY_KEYS,
    "obligation_priority_weights"
  );
  if (oblErr) return oblErr;

  if (!("severity_weights" in b)) {
    return { error: "severity_weights_required" };
  }
  const sevErr = validateWeightMap(
    b.severity_weights,
    SEVERITY_KEYS,
    "severity_weights"
  );
  if (sevErr) return sevErr;

  return {
    input: {
      entity_criticality_weights: b.entity_criticality_weights as RiskScoringWeights["entity_criticality_weights"],
      obligation_priority_weights: b.obligation_priority_weights as RiskScoringWeights["obligation_priority_weights"],
      severity_weights: b.severity_weights as RiskScoringWeights["severity_weights"]
    }
  };
}
