/**
 * entitlementClass.ts — the canonical collapse from raw `entitlement_level`
 * values to the three effective entitlement classes.
 *
 * This IS the mapping `requireEntitlement` has always applied inline
 * (premium/platform/team → premium; professional/standard → professional;
 * everything else → starter). Extracted to a dependency-free lib module
 * (Launch Completion 2) so requester-aware consumers — Ask's
 * product-knowledge filter — share the identical mapping without importing
 * middleware, and so tests that mock the middleware module cannot
 * accidentally erase it.
 */
export type EntitlementClass = "starter" | "professional" | "premium";

export function collapseEntitlementLevel(
  raw: string | null | undefined
): EntitlementClass {
  const level = typeof raw === "string" ? raw.toLowerCase() : "starter";
  return level === "premium" || level === "platform" || level === "team"
    ? "premium"
    : level === "professional" || level === "standard"
      ? "professional"
      : "starter";
}
