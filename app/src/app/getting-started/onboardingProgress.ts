/**
 * Pure onboarding step-completion logic for /getting-started, extracted so it
 * can be unit-tested in isolation (the app test lane runs in node with no jsdom
 * — same pattern as billingPortalSubmit.ts / signupValidation.ts).
 *
 * The /getting-started checklist has five steps:
 *   1. Activate a framework
 *   2. Build your asset inventory  (legacy: "Add your first vendor")
 *   3. Add a security control
 *   4. Run an assessment
 *   5. Review your security posture
 *
 * Step 2 is FLAG-AWARE (EAR P12/P13). When SECURELOGIC_ASSET_REGISTRY_ENABLED is
 * on, the wizard guides the user into the Asset Registry onboarding (create /
 * import / connect) and the step completes once the org has ≥1 registry asset.
 * When the flag is OFF the step is byte-for-byte the legacy "Add your first
 * vendor" (completes on vendors > 0) — no behavior change while dark.
 *
 * Bug this fixes: steps 4 and 5 were both keyed to `control_assessments > 0`, so
 * the 5-step progress bar could never read "4 of 5" — running the first
 * assessment jumped it from 3→5 and flipped "All done!" before any posture had
 * been computed or reviewed. Step 5 now reflects a real posture signal, so
 * progress is honest and "Review your security posture" only completes once
 * posture actually exists.
 *
 * Follow-up fix: that "real posture signal" accepted `snapshot_date` as
 * sufficient on its own, which re-introduced the same class of lie one level
 * down. A snapshot row can exist while nothing in it is scored — that is the
 * exact state a brand-new org is in — so the checklist marked step 5 ✓ and
 * claimed "your security posture score is now available" while the dashboard it
 * links to correctly rendered "Insufficient data — no posture snapshot yet."
 * Completion now reads through `postureScoreOf`, the same single definition the
 * Briefing's posture module uses, so the two surfaces cannot disagree. A date is
 * not a score. See lib/postureAvailability.ts.
 */

import { postureScoreOf } from "@/lib/postureAvailability";

export interface OnboardingInventory {
  frameworks: number;
  vendors: number;
  controls: number;
  control_assessments: number;
}

/**
 * `snapshot_date` is retained because callers pass the summary's posture block
 * straight through, but it is deliberately NOT a completion signal: an unscored
 * snapshot has a date and no score. Only `overall_score` completes step 5.
 */
export interface OnboardingPosture {
  overall_score: number | null;
  snapshot_date: string | null;
}

/**
 * Options that make step 2 flag-aware. Omitted / `assetRegistryEnabled: false`
 * preserves the legacy vendor-keyed behavior exactly (dark default).
 */
export interface OnboardingStepOptions {
  assetRegistryEnabled?: boolean;
  /** Total registry assets for the org (from getAssets), used only when enabled. */
  assetsTotal?: number;
}

/**
 * Returns a 5-element boolean array (one per checklist step, in order) marking
 * which onboarding steps are complete.
 */
export function getOnboardingStepCompletion(
  inventory: OnboardingInventory,
  posture: OnboardingPosture,
  options: OnboardingStepOptions = {},
): boolean[] {
  // A date is not a score — see the module header and lib/postureAvailability.ts.
  // `postureScoreOf` is the same definition the dashboard's posture module reads,
  // and it preserves 0 as a real score.
  const postureAvailable = postureScoreOf(posture) !== null;

  // Step 2 — Asset inventory when the registry is on (≥1 asset), else the legacy
  // "Add your first vendor" (vendors > 0). Dark default = unchanged behavior.
  const assetInventoryDone = options.assetRegistryEnabled
    ? (options.assetsTotal ?? 0) > 0
    : inventory.vendors > 0;

  return [
    inventory.frameworks > 0, // 1. Activate a framework
    assetInventoryDone, // 2. Build your asset inventory (legacy: first vendor)
    inventory.controls > 0, // 3. Add a security control
    inventory.control_assessments > 0, // 4. Run an assessment
    postureAvailable, // 5. Review your security posture
  ];
}
