/**
 * findingListFilters.ts — pure helpers for the Findings list's ops-center filters
 * (ERIP work-first). Kept separate from the route so the security-relevant
 * owner-filter resolution is unit-testable with no HTTP harness.
 */

/**
 * Resolve the ?owner= filter. SECURITY CONTRACT:
 *  - The ONLY accepted value is the literal "me" — a client can never pass a user
 *    id (no enumeration of other users' assignments through this path).
 *  - "me" resolves SERVER-SIDE from the authenticated session identity. An
 *    API-key-only request has no user identity and is rejected, never defaulted.
 */
export type OwnerFilterResult =
  | { kind: "none" }
  | { kind: "me"; userId: string }
  | { kind: "error"; error: "owner_filter_only_me" | "owner_me_requires_user_identity" };

export function resolveOwnerMeFilter(
  ownerParam: unknown,
  sessionUserId: string | null | undefined
): OwnerFilterResult {
  if (ownerParam === undefined || ownerParam === null || ownerParam === "") return { kind: "none" };
  if (ownerParam !== "me") return { kind: "error", error: "owner_filter_only_me" };
  if (typeof sessionUserId !== "string" || sessionUserId.length === 0) {
    return { kind: "error", error: "owner_me_requires_user_identity" };
  }
  return { kind: "me", userId: sessionUserId };
}
