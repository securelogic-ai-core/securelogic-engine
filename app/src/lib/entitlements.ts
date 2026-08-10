/**
 * entitlements.ts — the canonical customer-entitlement predicates for the app.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The platform predicate `["premium", "platform", "team"].includes(level)` was
 * copy-pasted inline (usually as a local `isPlatformUser`) across ~24 app
 * surfaces. Every copy is a place the rule can silently drift, and one already
 * had: `verify-email` tested `level === "premium"` alone.
 *
 * The triad is NOT an app-side invention. It mirrors the engine's own
 * equivalence class in `src/api/middleware/requireEntitlement.ts`, where
 * `premium`, `platform` and `team` all collapse to the same rank:
 *
 *     currentLevelRaw === "premium" || "platform" || "team"  ->  "premium"  (rank 4)
 *     currentLevelRaw === "professional" || "standard"       ->  "professional" (rank 2)
 *     everything else                                        ->  "starter"  (rank 1)
 *
 * So `isPlatformEntitled` here answers exactly the question "would the engine's
 * `requireEntitlement("premium")` admit this org?" — which is what every
 * platform page gate is really asking. Keeping the app answer identical to the
 * engine answer is the whole point: a page that renders but whose every write
 * 403s is a dead end, and a page that redirects an entitled org is a lockout.
 *
 * KNOWN, DELIBERATE LIMITATION
 * ----------------------------
 * The engine has a second admission path: `requireEntitlementOrCapability`
 * (`src/api/lib/corePlatformCapability.ts`) can admit an otherwise-unentitled
 * org that holds an explicit `core_platform_capability` grant. That leg is live
 * only when `SECURELOGIC_CAPABILITY_GATING_ENABLED=true`, which is `"false"` in
 * every service block in `render.yaml` (prod and staging alike). No app-side
 * gate has ever consulted it. This helper therefore models the entitlement leg
 * only, exactly as all existing call sites do. If that flag is ever enabled,
 * the app gates become collectively wrong — that is a pre-existing,
 * platform-wide gap to close in one deliberate pass, not per-page here.
 *
 * This module is intentionally dependency-free and pure so it can be imported
 * from Server Components and Client Components alike.
 */

/**
 * Entitlement values that the app may observe on `me.entitlementLevel`.
 * Stripe only ever writes `starter | professional | premium`
 * (`stripeWebhook.ts` `tierToDbLevel`); `platform` and `team` reach the column
 * via seeds, manual provisioning (`adminApiKeys.ts`) and legacy rows. All five
 * are handled here so no caller has to know that history.
 */
export const PLATFORM_ENTITLEMENT_LEVELS = ["premium", "platform", "team"] as const;

/**
 * True when the org is entitled to the platform surfaces — the app-side mirror
 * of the engine's `requireEntitlement("premium")`.
 *
 * Accepts the raw, possibly-absent value straight off `getMe()`: a missing or
 * unknown level is treated as unentitled, matching the `?? "starter"` default
 * every existing call site applies.
 */
export function isPlatformEntitled(entitlementLevel: string | null | undefined): boolean {
  return (PLATFORM_ENTITLEMENT_LEVELS as readonly string[]).includes(
    entitlementLevel ?? "starter"
  );
}
