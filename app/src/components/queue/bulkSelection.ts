/**
 * bulkSelection.ts — pure selection + result logic for bulk Review-Suggested-Links
 * actions (ERIP §3). Dependency-free (no React) so it is unit-testable without a
 * DOM/RTL harness. The bulk flow reuses the ratified single accept/dismiss endpoints
 * per id (see bulkDecideSuggestionsAction) — this module only manages which ids are
 * selected and how to summarize the outcome.
 */

/** Add or remove one id from the selection (immutably). */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** True when every currently-visible id is selected (and there is at least one). */
export function isAllSelected(selected: string[], visibleIds: string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
}

/** Select-all when not all are selected; otherwise clear (immutably). */
export function toggleSelectAll(selected: string[], visibleIds: string[]): string[] {
  return isAllSelected(selected, visibleIds) ? [] : [...visibleIds];
}

/** Keep only still-visible ids selected (drop ids that scrolled/refreshed away). */
export function pruneSelection(selected: string[], visibleIds: string[]): string[] {
  const set = new Set(visibleIds);
  return selected.filter((id) => set.has(id));
}

export type BulkDecision = "accept" | "dismiss";

/** Human summary of a bulk outcome for the result notice. */
export function summarizeBulkResult(
  decision: BulkDecision,
  succeeded: number,
  failed: number,
): string {
  const verb = decision === "accept" ? "accepted" : "dismissed";
  if (failed === 0) return `${succeeded} ${verb}.`;
  if (succeeded === 0) return `Could not ${decision} ${failed} — please retry.`;
  return `${succeeded} ${verb}, ${failed} failed — please retry those.`;
}
