/**
 * signalApplicabilityShadow.ts — Enterprise Risk Graph convergence (C3).
 *
 * PURE comparison of the LEGACY signal→vendor/asset match set against the NEW
 * product→tenant-asset resolution, for the shadow period. No I/O, no writes — it
 * turns two result sets into a structured convergence record + telemetry payload.
 *
 * The shadow NEVER changes customer-visible behavior; this module only measures.
 * The categories below feed the convergence report: agreement rate, disagreement
 * categories, false-positive candidates (shadow asserts assets legacy did not),
 * false-negative candidates (legacy matched assets the shadow did not resolve),
 * and unresolved ambiguities (shadow needs_review / ambiguous).
 */

/** Minimal structural shape of a tenant-asset resolution (decoupled from the
 *  resolver module so this comparator has no runtime dependency on it). */
export interface ShadowResolution {
  status: "resolved" | "ambiguous" | "no_match" | "needs_review";
  reason: string;
  candidates: Array<{ asset_id: string }>;
}

export type ShadowAgreement =
  | "agree"               // legacy asset set == shadow resolved set (non-empty)
  | "both_empty"          // neither found assets (legacy none; shadow no_match)
  | "partial"             // overlap, but the sets differ
  | "legacy_only"         // legacy matched assets; shadow resolved none of them
  | "shadow_only"         // shadow resolved assets; legacy matched none
  | "shadow_unresolved";  // shadow returned needs_review / ambiguous (no confident set)

export interface ShadowComparison {
  agreement: ShadowAgreement;
  shadow_status: ShadowResolution["status"];
  shadow_reason: string;
  legacy_asset_ids: string[];
  shadow_asset_ids: string[];
  agreed: string[];
  legacy_only: string[];  // false-NEGATIVE candidates for the new path
  shadow_only: string[];  // false-POSITIVE candidates for the new path
  unresolved_ambiguity: boolean;
}

function uniqSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Compare the legacy matched asset ids against the shadow resolution. Pure.
 */
export function compareApplicabilityShadow(
  legacyAssetIds: string[],
  shadow: ShadowResolution
): ShadowComparison {
  const legacy = uniqSorted(legacyAssetIds);
  const unresolved = shadow.status === "needs_review" || shadow.status === "ambiguous";
  const shadowIds = unresolved ? [] : uniqSorted(shadow.candidates.map((c) => c.asset_id));

  const legacySet = new Set(legacy);
  const shadowSet = new Set(shadowIds);
  const agreed = legacy.filter((id) => shadowSet.has(id));
  const legacyOnly = legacy.filter((id) => !shadowSet.has(id));
  const shadowOnly = shadowIds.filter((id) => !legacySet.has(id));

  let agreement: ShadowAgreement;
  if (unresolved) {
    agreement = "shadow_unresolved";
  } else if (legacy.length === 0 && shadowIds.length === 0) {
    agreement = "both_empty";
  } else if (legacyOnly.length === 0 && shadowOnly.length === 0) {
    agreement = "agree";
  } else if (shadowIds.length === 0) {
    agreement = "legacy_only";
  } else if (legacy.length === 0) {
    agreement = "shadow_only";
  } else {
    agreement = "partial";
  }

  return {
    agreement,
    shadow_status: shadow.status,
    shadow_reason: shadow.reason,
    legacy_asset_ids: legacy,
    shadow_asset_ids: shadowIds,
    agreed,
    legacy_only: legacyOnly, // false-negative candidates
    shadow_only: shadowOnly, // false-positive candidates
    unresolved_ambiguity: unresolved,
  };
}

/**
 * Shape the comparison into a flat telemetry payload (counts only — no asset ids
 * beyond counts, so aggregation carries no tenant identifiers). Emitted to the
 * structured log during the shadow period; consumed to build the convergence report.
 */
export function shadowTelemetry(cmp: ShadowComparison): Record<string, string | number | boolean> {
  return {
    event: "signal_applicability_shadow",
    agreement: cmp.agreement,
    shadow_status: cmp.shadow_status,
    shadow_reason: cmp.shadow_reason,
    legacy_count: cmp.legacy_asset_ids.length,
    shadow_count: cmp.shadow_asset_ids.length,
    agreed_count: cmp.agreed.length,
    legacy_only_count: cmp.legacy_only.length,  // false-negative candidates
    shadow_only_count: cmp.shadow_only.length,  // false-positive candidates
    unresolved_ambiguity: cmp.unresolved_ambiguity,
  };
}
