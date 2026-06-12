/**
 * selfQueries.ts — the ordered read list for a single data subject's self-export
 * (GDPR Art. 15). Parallel to `orgQueries.ts` (the full-org dump). Extracted
 * from the package barrel so the executor (`exporter.ts`) can import it without
 * an index ↔ exporter import cycle.
 */

import type { ExportQuery, ExportSubject, TableColumns } from "./types.js";
import { buildCategoryQueries, type CategoryCOptions } from "./categoryQueries.js";
import { buildHistoricalAuthorshipQuery } from "./historicalAuthorship.js";

/**
 * Every read that makes up a user self-export: all category-derived queries plus
 * the `security_audit_log` historical-authorship query (O-1). The order is
 * stable (A → B → C → email-keyed → historical authorship) so the bundle
 * generator and the manifest are deterministic.
 *
 * `tableColumns` must carry the live column list for every table in
 * `tablesRequiringProjection()` (trust model item 4) — otherwise building those
 * tables' queries throws fail-closed.
 */
export function buildSelfExportQueries(
  subject: ExportSubject,
  opts: CategoryCOptions = {},
  tableColumns?: TableColumns,
): ExportQuery[] {
  return [
    ...buildCategoryQueries(subject, opts, tableColumns),
    buildHistoricalAuthorshipQuery(subject),
  ];
}
