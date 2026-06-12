/**
 * dataExport — GDPR/CCPA export engine (query + streaming core, PR #2a).
 *
 * Bundle/zip orchestration, the manifest builder, the org-wide outer loop, and
 * R2 attachment streaming are PR #2b and are NOT exported here yet.
 *
 * See docs/DATA_CLASSIFICATION.md and docs/investigation/gdpr-pr2-phase0.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRUST MODEL — read before calling any builder (these are security invariants).
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. The `build*Queries` functions RETURN SQL STRINGS; they do NOT execute SQL
 *    and hold no database handle. There is deliberately NO tenant/auth check
 *    inside them — they cannot perform one. Safety is the executor's job.
 *
 * 2. The executor (PR #2b) MUST run every produced query INSIDE `withTenant(orgId)`
 *    and MUST call `requireTenantContext()` (from infra/postgres) to fail CLOSED
 *    before executing. Running a builder's output outside a tenant scope can
 *    return cross-tenant rows for any table whose RLS policy is not yet live.
 *
 * 3. `ExportSubject.userEmail` MUST be read from the authenticated subject's
 *    `users.email` row — NEVER from client input. The email-keyed builders match
 *    on it directly, and `subscribers` has NO `organization_id` and is keyed by
 *    email alone: a `withTenant` scope does NOT constrain it, so a client-supplied
 *    or malformed email parameter would enumerate platform-wide subscriber PII.
 *
 * 4. Tables in `tablesRequiringProjection()` (those with `exportExcludedColumns`)
 *    MUST have their live column list probed via `getTableColumns` /
 *    `buildTableColumnsMap` and passed in as `tableColumns`. Omitting it makes the
 *    builder throw (fail-closed) rather than emit a secret-leaking `SELECT *`.
 */

export type {
  ExportSubject,
  ExportQuery,
  RowStreamer,
  QueryRunner,
  TableColumns,
  ManifestEntry,
} from "./types.js";

export {
  CursorRowStreamer,
  ArrayRowStreamer,
  drainRows,
} from "./rowStreamer.js";

export { rowToNdjsonLine, createNdjsonTransform } from "./ndjsonTransform.js";

export {
  dependencyAssessmentsHasReviewerUuid,
  DEPENDENCY_ASSESSMENTS_TABLE,
  REVIEWER_UUID_COLUMN,
} from "./dependencyAssessmentsProbe.js";

export {
  getTableColumns,
  tablesRequiringProjection,
  buildTableColumnsMap,
  resetColumnCache,
} from "./columnProbe.js";

export {
  buildCategoryAQuery,
  buildCategoryBQueries,
  buildCategoryCQueries,
  buildEmailKeyedQueries,
  buildCategoryQueries,
  EXPORT_EXCLUDED_TABLES,
  type CategoryCOptions,
} from "./categoryQueries.js";

export {
  buildHistoricalAuthorshipQuery,
  SECURITY_AUDIT_LOG_TABLE,
} from "./historicalAuthorship.js";

import type { ExportQuery, ExportSubject, TableColumns } from "./types.js";
import { buildCategoryQueries, type CategoryCOptions } from "./categoryQueries.js";
import { buildHistoricalAuthorshipQuery } from "./historicalAuthorship.js";

/**
 * Every read that makes up a user self-export: all category-derived queries plus
 * the `security_audit_log` historical-authorship query (O-1). The order is
 * stable (A → B → C → email-keyed → historical authorship) so the bundle
 * generator (PR #2b) and the manifest are deterministic.
 *
 * `tableColumns` must carry the live column list for every table in
 * `tablesRequiringProjection()` (see trust model, item 4) — otherwise building
 * those tables' queries throws fail-closed.
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
