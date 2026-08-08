/**
 * savedViews.ts — pure logic for Findings saved views (ERIP §1). Dependency-free
 * (no React/fetch) so it is unit-testable without a DOM/RTL harness. A saved view
 * is a named set of Findings list filters; applying one is just a /findings URL.
 */

// Mirrors the engine whitelist (findingSavedViewValidation.ts) — legacy list
// keys plus the queue-controls browse keys (URL param names, verbatim; `page`
// excluded — a view is a filter set, not a scroll position).
export const SAVED_VIEW_FILTER_KEYS = [
  "status",
  "severity",
  "source_type",
  "domain",
  "priority",
  "q",
  "governance",
  "operational",
  "due",
  "mine",
  "has_action",
  "has_evidence",
  "created_from",
  "created_to",
  "sort",
] as const;
export type SavedViewFilters = Partial<Record<(typeof SAVED_VIEW_FILTER_KEYS)[number], string>>;

/** Keys only the queue-controls browse view understands. A href carrying any of
 *  them must pin `queue=all` so it deterministically opens the browse view (and
 *  never the Ops Center home, which would silently ignore the filters). */
const QUEUE_ONLY_KEYS: ReadonlySet<string> = new Set([
  "q", "governance", "operational", "due", "mine", "has_action", "has_evidence",
  "created_from", "created_to", "sort",
]);

/** Build the /findings URL that applies a saved view's filters (stable key order). */
export function savedViewHref(filters: SavedViewFilters): string {
  const p = new URLSearchParams();
  let hasQueueKey = false;
  for (const k of SAVED_VIEW_FILTER_KEYS) {
    const v = filters[k];
    if (typeof v === "string" && v.length > 0) {
      p.set(k, v);
      if (QUEUE_ONLY_KEYS.has(k)) hasQueueKey = true;
    }
  }
  if (hasQueueKey) p.set("queue", "all");
  const qs = p.toString();
  return qs ? `/findings?${qs}` : "/findings";
}

/** Extract the current view's filters from the page search params (whitelisted keys only). */
export function currentViewFilters(sp: Record<string, string | undefined>): SavedViewFilters {
  const out: SavedViewFilters = {};
  for (const k of SAVED_VIEW_FILTER_KEYS) {
    const v = sp[k];
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

/** Whether two filter sets are equivalent (for the active-view highlight). */
export function filtersEqual(a: SavedViewFilters, b: SavedViewFilters): boolean {
  return SAVED_VIEW_FILTER_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}

/** A view is only worth saving when at least one filter is active. */
export function hasAnyFilter(f: SavedViewFilters): boolean {
  return SAVED_VIEW_FILTER_KEYS.some((k) => typeof f[k] === "string" && (f[k] as string).length > 0);
}
