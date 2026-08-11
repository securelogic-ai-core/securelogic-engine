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

/**
 * Split a selection for a bulk ACCEPT into accept-eligible ids and skipped
 * ids. Asset-target suggestions are not acceptable yet (the engine refuses
 * with 409 asset_target_accept_unsupported until the registry link store
 * ships) — sending them would just convert the whole selection into partial
 * failures. Dismiss has no such split; every selected row is dismissable.
 */
export function partitionAcceptEligible(
  selected: string[],
  targetTypeById: ReadonlyMap<string, string>,
): { eligible: string[]; skipped: string[] } {
  const eligible: string[] = [];
  const skipped: string[] = [];
  for (const id of selected) {
    (targetTypeById.get(id) === "asset" ? skipped : eligible).push(id);
  }
  return { eligible, skipped };
}

/** Human summary of a bulk outcome for the result notice. */
export function summarizeBulkResult(
  decision: BulkDecision,
  succeeded: number,
  failed: number,
  skippedAssets = 0,
): string {
  const verb = decision === "accept" ? "accepted" : "dismissed";
  const skippedSuffix =
    skippedAssets > 0
      ? ` ${skippedAssets} asset suggestion${skippedAssets === 1 ? "" : "s"} skipped — accept for assets is coming soon.`
      : "";
  if (failed === 0) return `${succeeded} ${verb}.${skippedSuffix}`;
  if (succeeded === 0) return `Could not ${decision} ${failed} — please retry.${skippedSuffix}`;
  return `${succeeded} ${verb}, ${failed} failed — please retry those.${skippedSuffix}`;
}
