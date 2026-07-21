/**
 * independentReviewSelection.ts — PURE reviewer-selection for Independent Governance
 * Review, free of any I/O import (no postgres, no mail transport) so the separation-of-
 * duties rule is unit-testable without a database. The impure half — reading candidates
 * and writing the assignment — lives in `independentReviewAssignment.ts`, which imports
 * these. Mirrors the emails/notifier split used elsewhere in this codebase.
 */

/** A candidate reviewer row, already org-scoped and ordered by the query. */
export interface ReviewerCandidate {
  id: string;
}

/**
 * Pick the reviewer from an ordered list of eligible admin candidates, excluding the
 * remediator. The list is expected pre-ordered deterministically (oldest admin first) and
 * already filtered to active admins in the org; this function enforces the SoD exclusion and
 * the "none eligible → null" contract.
 *
 * Returns the first candidate whose id differs from the remediator, or null when none do
 * (e.g. the only admin IS the remediator, or there are no admins). Null is a valid outcome:
 * the finding still surfaces org-wide in the review queue; the system never fabricates an
 * assignment or assigns the work to the very person barred from doing it.
 */
export function chooseReviewer(
  candidates: readonly ReviewerCandidate[],
  remediatorUserId: string | null
): string | null {
  for (const c of candidates) {
    if (c.id && c.id !== remediatorUserId) return c.id;
  }
  return null;
}
