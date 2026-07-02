/**
 * Pure onboarding step-completion logic for /getting-started, extracted so it
 * can be unit-tested in isolation (the app test lane runs in node with no jsdom
 * — same pattern as billingPortalSubmit.ts / signupValidation.ts).
 *
 * The /getting-started checklist has five steps:
 *   1. Activate a framework
 *   2. Add your first vendor
 *   3. Add a security control
 *   4. Run an assessment
 *   5. Review your security posture
 *
 * Bug this fixes: steps 4 and 5 were both keyed to `control_assessments > 0`, so
 * the 5-step progress bar could never read "4 of 5" — running the first
 * assessment jumped it from 3→5 and flipped "All done!" before any posture had
 * been computed or reviewed. Step 5 now reflects a real posture signal
 * (overall_score / snapshot_date), so progress is honest and "Review your
 * security posture" only completes once posture actually exists.
 */

export interface OnboardingInventory {
  frameworks: number;
  vendors: number;
  controls: number;
  control_assessments: number;
}

export interface OnboardingPosture {
  overall_score: number | null;
  snapshot_date: string | null;
}

/**
 * Returns a 5-element boolean array (one per checklist step, in order) marking
 * which onboarding steps are complete.
 */
export function getOnboardingStepCompletion(
  inventory: OnboardingInventory,
  posture: OnboardingPosture,
): boolean[] {
  const postureAvailable =
    posture.overall_score !== null || posture.snapshot_date !== null;

  return [
    inventory.frameworks > 0, // 1. Activate a framework
    inventory.vendors > 0, // 2. Add your first vendor
    inventory.controls > 0, // 3. Add a security control
    inventory.control_assessments > 0, // 4. Run an assessment
    postureAvailable, // 5. Review your security posture
  ];
}
