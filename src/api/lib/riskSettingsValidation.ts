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
  /** Optional finding SLA policy: severity → days (all-or-nothing map, or explicit null to clear). Absent = leave unchanged. */
  finding_sla_by_severity?: Record<string, number> | null;
  /** Optional closure separation-of-duties toggle. Absent = leave unchanged. */
  require_finding_closure_sod?: boolean;
  /** Optional remediation evidence-gate toggle. Absent = leave unchanged. */
  require_evidence_gate?: boolean;
};

/** Severities the finding SLA policy accepts (matches findings.severity). */
export const SLA_POLICY_SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

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

  const input: RiskSettingsPutInput = { cadence_by_rating: result };

  // Optional finding-governance policies (20260902/20260903). Absent keys
  // leave the stored value unchanged; explicit null clears the SLA policy.
  if ("finding_sla_by_severity" in body) {
    const sla = body["finding_sla_by_severity"];
    if (sla === null) {
      input.finding_sla_by_severity = null;
    } else {
      if (!isPlainObject(sla)) {
        return { error: "finding_sla_by_severity_must_be_object_or_null" };
      }
      const slaResult: Record<string, number> = {};
      for (const sev of SLA_POLICY_SEVERITIES) {
        if (!(sev in sla)) {
          return {
            error: "finding_sla_by_severity_incomplete",
            detail: `Missing key '${sev}'. All four severities must be supplied (or send null to clear).`
          };
        }
        const v = sla[sev];
        if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > MAX_DAYS) {
          return {
            error: "finding_sla_value_invalid",
            detail: `finding_sla_by_severity.${sev} must be an integer between 1 and ${MAX_DAYS}.`
          };
        }
        slaResult[sev] = v;
      }
      for (const k of Object.keys(sla)) {
        if (!(SLA_POLICY_SEVERITIES as readonly string[]).includes(k)) {
          return {
            error: "finding_sla_by_severity_unknown_key",
            detail: `Unknown severity '${k}'. Allowed: ${SLA_POLICY_SEVERITIES.join(", ")}.`
          };
        }
      }
      input.finding_sla_by_severity = slaResult;
    }
  }

  if ("require_finding_closure_sod" in body) {
    if (typeof body["require_finding_closure_sod"] !== "boolean") {
      return { error: "require_finding_closure_sod_must_be_boolean" };
    }
    input.require_finding_closure_sod = body["require_finding_closure_sod"];
  }

  if ("require_evidence_gate" in body) {
    if (typeof body["require_evidence_gate"] !== "boolean") {
      return { error: "require_evidence_gate_must_be_boolean" };
    }
    input.require_evidence_gate = body["require_evidence_gate"];
  }

  return { input };
}
