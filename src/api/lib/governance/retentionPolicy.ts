/**
 * retentionPolicy.ts — pure policy resolution and validation for TDG.
 *
 * DB-free: every rule here is a function of values the caller already has, so
 * the invariants that matter most (TDG-1, TDG-2, TDG-4, TDG-5) are provable
 * without a database. The store fetches rows; this module decides.
 */

import type { GovernedDataClass } from "./dataClasses.js";

/** Where the effective number came from. 'platform_default' is never stored. */
export type PolicySource = "platform_default" | "tenant" | "contract";

/** One row of retention_policies, as the store returns it. */
export interface RetentionPolicyVersion {
  id: string;
  organizationId: string;
  dataClass: string;
  version: number;
  retentionDays: number | null;
  cleared: boolean;
  source: "tenant" | "contract";
  effectiveFrom: Date;
}

export interface EffectivePolicy {
  dataClass: string;
  retentionDays: number;
  source: PolicySource;
  /**
   * The retention_policies row this decision rests on, or null when the
   * platform default applied. Recorded on every deletion (TDG-8) so a later
   * policy version cannot retroactively re-explain a past deletion.
   */
  policyVersionId: string | null;
  version: number | null;
  effectiveFrom: Date | null;
}

/**
 * TDG-1 + TDG-2. The effective policy is the highest-versioned row that has
 * already taken effect; absence — or a `cleared` version — means the platform
 * default declared by the class.
 *
 * `versions` may arrive in any order and may contain rows for other classes or
 * future effective dates; this function filters rather than trusting the query.
 * That redundancy is deliberate: the resolver is the single seam every deletion
 * passes through, so it should not be able to be wrong because a caller's SQL
 * changed.
 */
export function resolveEffectivePolicy(
  dataClass: GovernedDataClass,
  versions: readonly RetentionPolicyVersion[],
  now: Date = new Date()
): EffectivePolicy {
  const applicable = versions
    .filter((v) => v.dataClass === dataClass.key && v.effectiveFrom.getTime() <= now.getTime())
    .sort((a, b) => b.version - a.version);

  const latest = applicable[0];

  if (!latest || latest.cleared || latest.retentionDays == null) {
    return {
      dataClass: dataClass.key,
      retentionDays: dataClass.defaultDays,
      source: "platform_default",
      policyVersionId: null,
      version: null,
      effectiveFrom: null
    };
  }

  return {
    dataClass: dataClass.key,
    retentionDays: latest.retentionDays,
    source: latest.source,
    policyVersionId: latest.id,
    version: latest.version,
    effectiveFrom: latest.effectiveFrom
  };
}

export type PolicyValidationCode =
  | "class_not_configurable"
  | "not_an_integer"
  | "out_of_range"
  | "exceeds_dependency";

export interface PolicyValidationResult {
  ok: boolean;
  code?: PolicyValidationCode;
  message?: string;
}

const OK: PolicyValidationResult = { ok: true };

/**
 * TDG-4. Rejects — never clamps. A clamp turns "your value was refused" into
 * "your value was silently changed", which is exactly the class of behaviour a
 * retention control must not have: the customer would believe they had set 730
 * days and be deleted at 365.
 */
export function validateRetentionDays(
  dataClass: GovernedDataClass,
  days: unknown
): PolicyValidationResult {
  if (!dataClass.tenantConfigurable) {
    return {
      ok: false,
      code: "class_not_configurable",
      message: `${dataClass.key} retention is fixed by the platform and cannot be set per tenant`
    };
  }
  if (typeof days !== "number" || !Number.isInteger(days)) {
    return {
      ok: false,
      code: "not_an_integer",
      message: "retention_days must be a whole number of days"
    };
  }
  if (days < dataClass.minDays || days > dataClass.maxDays) {
    return {
      ok: false,
      code: "out_of_range",
      message: `retention_days must be between ${dataClass.minDays} and ${dataClass.maxDays} inclusive`
    };
  }
  return OK;
}

/**
 * TDG-5, rule 1. Content may never be retained longer than the evidence that
 * substantiates it. `resolveDependency` returns the effective retention of a
 * dependency class for the same organization.
 *
 * A dependency that is not registered is treated as a REFUSAL, not as an absent
 * constraint: an unresolvable dependency means the invariant cannot be shown to
 * hold, and the safe answer to "cannot be shown" is no.
 */
export function validateAgainstDependencies(
  dataClass: GovernedDataClass,
  days: number,
  resolveDependency: (key: string) => EffectivePolicy | null
): PolicyValidationResult {
  for (const depKey of dataClass.dependsOn) {
    const dep = resolveDependency(depKey);
    if (!dep) {
      return {
        ok: false,
        code: "exceeds_dependency",
        message: `dependency '${depKey}' could not be resolved; refusing to set a retention that cannot be checked against it`
      };
    }
    if (days > dep.retentionDays) {
      return {
        ok: false,
        code: "exceeds_dependency",
        message: `retention_days may not exceed ${depKey} retention (${dep.retentionDays} days): content cannot outlive the provenance that substantiates it`
      };
    }
  }
  return OK;
}

/** Convenience: both checks, in the order the route reports them. */
export function validatePolicyWrite(
  dataClass: GovernedDataClass,
  days: unknown,
  resolveDependency: (key: string) => EffectivePolicy | null
): PolicyValidationResult {
  const basic = validateRetentionDays(dataClass, days);
  if (!basic.ok) return basic;
  return validateAgainstDependencies(dataClass, days as number, resolveDependency);
}
