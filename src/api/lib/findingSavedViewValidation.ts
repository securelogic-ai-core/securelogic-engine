/**
 * findingSavedViewValidation.ts — pure validation for Findings saved-view filters
 * (ERIP §1 saved views). Kept separate from the route so it is unit-testable with
 * no database.
 *
 * A saved view stores a small object of Findings LIST filters. Only these keys are
 * allowed, each a non-empty string; unknown keys are dropped (never persisted) so a
 * saved view can never smuggle arbitrary JSON into the store. The value space is the
 * same as the /findings query params.
 */

export const SAVED_VIEW_FILTER_KEYS = ["status", "severity", "source_type", "domain", "priority"] as const;
export type SavedViewFilterKey = (typeof SAVED_VIEW_FILTER_KEYS)[number];
export type SavedViewFilters = Partial<Record<SavedViewFilterKey, string>>;

export const MAX_SAVED_VIEW_NAME = 80;

/** Trim + bound-check a view name. Returns null when invalid. */
export function normalizeSavedViewName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_SAVED_VIEW_NAME) return null;
  return name;
}

/**
 * Keep only whitelisted keys whose value is a non-empty string. Everything else is
 * dropped. Always returns a plain object (never throws) so a bad payload degrades to
 * an empty filter set rather than an error.
 */
export function sanitizeSavedViewFilters(raw: unknown): SavedViewFilters {
  const out: SavedViewFilters = {};
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of SAVED_VIEW_FILTER_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) out[key] = v.trim();
  }
  return out;
}
