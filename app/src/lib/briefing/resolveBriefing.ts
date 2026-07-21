/**
 * resolveBriefing.ts — server-side module eligibility resolution (B1).
 *
 * Pure filter over the canonical registry: entitlement × user-identity ×
 * feature flags. Runs in the Server Component only; the client never sees a
 * module the session is not eligible for.
 *
 * This is presentation-side defense in depth (see the authorization-boundary
 * note in contracts.ts) — the engine's per-route entitlement chain remains the
 * enforcement layer. What THIS layer guarantees:
 *   - personal modules are OMITTED (not zeroed) for sessions with no user
 *     identity (legacy API-key sessions);
 *   - flag-dependent modules resolve away fail-closed when their flag is off
 *     (their destination queue does not exist without it);
 *   - a stored layout can never grant access: filterRequestedModules() (B2's
 *     enforcement point for saved layouts) intersects any requested id list
 *     with the eligible set — resolve(requested) ⊆ eligible, always.
 */

import type { BriefingFlagKey, BriefingModuleDef } from "./contracts";
import { BRIEFING_MODULES } from "./registry";

export type BriefingEligibility = {
  /** Mirrors the page's isPlatformUser branch (premium | platform | team). */
  isPlatformUser: boolean;
  /** JWT session with a userId — false for legacy API-key sessions. */
  hasUserIdentity: boolean;
  /** Resolved app feature flags relevant to modules. Fail-closed when absent. */
  flags: Partial<Record<BriefingFlagKey, boolean>>;
};

function isEligible(def: BriefingModuleDef, ctx: BriefingEligibility): boolean {
  if (def.minEntitlement === "platform" && !ctx.isPlatformUser) return false;
  if (def.requiresUserIdentity && !ctx.hasUserIdentity) return false;
  if (def.requiredFlag && ctx.flags[def.requiredFlag] !== true) return false;
  return true;
}

/** Eligible modules in canonical registry (zone) order. */
export function resolveEligibleModules(
  ctx: BriefingEligibility,
): BriefingModuleDef[] {
  return BRIEFING_MODULES.filter((def) => isEligible(def, ctx));
}

/**
 * Intersect a requested module-id list (e.g. a stored layout, B2+) with the
 * session's eligible set. Unknown ids and ineligible modules drop out silently —
 * permissions override personalization. Preserves the REQUESTED order for the
 * survivors (a layout is an ordering; eligibility is not).
 */
export function filterRequestedModules(
  requestedIds: readonly string[],
  ctx: BriefingEligibility,
): BriefingModuleDef[] {
  const eligible = new Map(resolveEligibleModules(ctx).map((d) => [d.id, d]));
  const seen = new Set<string>();
  const out: BriefingModuleDef[] = [];
  for (const id of requestedIds) {
    if (seen.has(id)) continue; // no ambiguous duplicates
    seen.add(id);
    const def = eligible.get(id as BriefingModuleDef["id"]);
    if (def) out.push(def);
  }
  return out;
}
