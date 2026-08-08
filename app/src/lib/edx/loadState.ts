/**
 * loadState.ts — EDX read-path load discrimination (pattern EDX-1).
 *
 * The whole point of this module is one distinction the app kept collapsing:
 * a fetch that FAILED and a fetch that succeeded with nothing in it are not
 * the same event, and only one of them is an answer.
 *
 * Every `lib/api` reader returns `T | null`, where `null` means the response
 * was not OK **or** the request threw — a 500, a timeout, a dropped
 * connection, a 403, anything. Pages that wrote `data === null ? … : …` and
 * then rendered an empty state, an upgrade pitch, or a zero were converting
 * "we don't know" into a confident statement about the customer's own data.
 *
 * Contract notes:
 * - Pure, clock-free, no I/O — same discipline as lib/edx/freshness.
 * - It deliberately CANNOT say *why* a fetch failed. The app layer does not
 *   have that evidence, so any attribution built on top of it (a plan, a
 *   permission, an empty register) would be invented. Making the cause
 *   unrepresentable is the feature, not a limitation.
 */

/**
 * The three states a read surface can be in.
 *
 * - `unavailable` — the fetch failed. Nothing may be asserted about the data.
 * - `empty` — the fetch succeeded and the population is genuinely zero.
 *   An empty answer IS an answer, and gets the ordinary empty state.
 * - `populated` — render the rows.
 */
export type LoadState = "unavailable" | "empty" | "populated";

/**
 * Classify a nullable API payload.
 *
 * @param data  The reader's return value. `null`/`undefined` = the fetch failed.
 * @param rows  Optional accessor for the collection that decides empty vs
 *              populated. Omit it when the caller only needs the
 *              loaded/not-loaded split (a page that fails whole, a summary
 *              object with no list behind it) — a present payload is then
 *              `populated`.
 *
 * A thrown accessor is not caught: if `rows` cannot read its own payload the
 * shape is wrong, and failing loudly in tests beats quietly reporting `empty`.
 */
export function loadState<T>(
  data: T | null | undefined,
  rows?: (d: T) => { readonly length: number } | null | undefined,
): LoadState {
  if (data === null || data === undefined) return "unavailable";
  if (!rows) return "populated";
  const collection = rows(data);
  return collection && collection.length > 0 ? "populated" : "empty";
}

/**
 * `true` when the fetch failed — the guard that must precede any empty state.
 *
 * Reads at the call site as the question the page is actually asking, and
 * keeps the `=== null` idiom (which invites the `?? []` that hides it) out of
 * page bodies.
 *
 * Declared as a type predicate so it narrows exactly as the `=== null` checks
 * it replaces: after an early `if (isUnavailable(data)) return …`, the payload
 * is non-null for the rest of the page. Without this, migrating a guard would
 * silently push callers toward `!` assertions — trading a customer-facing
 * falsehood for a runtime crash.
 */
export function isUnavailable<T>(
  data: T | null | undefined,
): data is null | undefined {
  return data === null || data === undefined;
}
