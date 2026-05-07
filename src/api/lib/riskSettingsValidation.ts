/**
 * riskSettingsValidation.ts — Pure validation for the risk_settings PUT body.
 *
 * Body shape:
 *   {
 *     cadence_by_rating: {
 *       Critical: number,   // positive integer, days
 *       High:     number,
 *       Moderate: number,
 *       Low:      number
 *     }
 *   }
 *
 * Partial maps are NOT accepted on PUT — the caller must send all four
 * keys. The route's GET endpoint surfaces the merged "effective policy"
 * (configured + defaults) so the client always knows the four current
 * values when building a PUT body.
 */

import { VALID_RATINGS } from "./riskCadence.js";

const MAX_DAYS = 3650; // 10 years — defensive upper bound

export type RiskSettingsPutInput = {
  cadence_by_rating: Record<string, number>;
};

export type RiskSettingsPutResult =
  | { input: RiskSettingsPutInput }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function validateRiskSettingsPut(body: unknown): RiskSettingsPutResult {
  if (!isPlainObject(body)) {
    return { error: "request_body_required" };
  }

  const cbr = body["cadence_by_rating"];
  if (!isPlainObject(cbr)) {
    return { error: "cadence_by_rating_required" };
  }

  const result: Record<string, number> = {};
  for (const rating of VALID_RATINGS) {
    if (!(rating in cbr)) {
      return {
        error: "cadence_by_rating_incomplete",
        detail: `Missing key '${rating}'. All four ratings must be supplied.`
      };
    }
    const v = cbr[rating];
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
      return {
        error: "cadence_value_must_be_integer",
        detail: `cadence_by_rating.${rating} must be an integer.`
      };
    }
    if (v <= 0) {
      return {
        error: "cadence_value_must_be_positive",
        detail: `cadence_by_rating.${rating} must be > 0.`
      };
    }
    if (v > MAX_DAYS) {
      return {
        error: "cadence_value_too_large",
        detail: `cadence_by_rating.${rating} must be ≤ ${MAX_DAYS}.`
      };
    }
    result[rating] = v;
  }

  // Reject any unexpected keys to surface client-side typos / drift early.
  for (const k of Object.keys(cbr)) {
    if (!(VALID_RATINGS as readonly string[]).includes(k)) {
      return {
        error: "cadence_by_rating_unknown_key",
        detail: `Unknown rating '${k}'. Allowed: ${VALID_RATINGS.join(", ")}.`
      };
    }
  }

  return { input: { cadence_by_rating: result } };
}
