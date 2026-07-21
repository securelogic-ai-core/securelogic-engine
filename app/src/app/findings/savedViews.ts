/**
 * savedViews.ts — pure logic for Findings saved views (ERIP §1). Dependency-free
 * (no React/fetch) so it is unit-testable without a DOM/RTL harness. A saved view
 * is a named set of Findings list filters; applying one is just a /findings URL.
 */

export const SAVED_VIEW_FILTER_KEYS = ["status", "severity", "source_type", "domain", "priority"] as const;
export type SavedViewFilters = Partial<Record<(typeof SAVED_VIEW_FILTER_KEYS)[number], string>>;

/** Build the /findings URL that applies a saved view's filters (stable key order). */
export function savedViewHref(filters: SavedViewFilters): string {
  const p = new URLSearchParams();
  for (const k of SAVED_VIEW_FILTER_KEYS) {
    const v = filters[k];
    if (typeof v === "string" && v.length > 0) p.set(k, v);
  }
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
