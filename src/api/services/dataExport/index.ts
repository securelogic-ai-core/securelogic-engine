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
 *    The org_full builders (`buildOrgExportQueries`) take the same care: the
 *    `memberEmails` they match the platform-level email-keyed tables against MUST
 *    be the CURRENT `users.email` of the org's members, never client input.
 *
 * 4. Tables in `tablesRequiringProjection()` (those with `exportExcludedColumns`)
 *    MUST have their live column list probed via `getTableColumns` /
 *    `buildTableColumnsMap` and passed in as `tableColumns`. Omitting it makes the
 *    builder throw (fail-closed) rather than emit a secret-leaking `SELECT *`.
 *    As of PR #2b this set is `users`, `org_invites` (self-export) plus
 *    `organizations`, `webhook_endpoints` (org_full secret/Stripe omission, Q5).
 *
 * 5. org_full (Decision Q2) is a FULL TABLE DUMP with no actor predicate, so the
 *    org boundary is NOT `withTenant` alone (RLS is bypassed under owner creds and
 *    absent on pending-RLS tables): every `buildOrgExportQueries` query carries an
 *    EXPLICIT org predicate. The executor's org_full path is wired in PR #2c
 *    (member enumeration via the `readMemberEmails` seam + the same per-table
 *    streaming loop); R2 vendor-assurance attachment bytes (Q6) are not bundled
 *    yet (manifest.attachments stays []), and a follow-up PR adds them.
 */

export type {
  ExportSubject,
  ExportQuery,
  RowStreamer,
  QueryRunner,
  TableColumns,
  ExportScope,
  ManifestTableEntry,
  ManifestAttachmentEntry,
  ExportManifest,
  ExportResult,
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

/** The ordered self-export read list (Art. 15). See selfQueries.ts. */
export { buildSelfExportQueries } from "./selfQueries.js";

/**
 * Full-organization export read list + builders (Decision Q2). PR #2b ships and
 * tests these as pure functions; PR #2c wires them into `runExport`'s org_full
 * path (member enumeration + the per-table streaming loop). R2 attachments are a
 * follow-up.
 */
export {
  buildOrgExportQueries,
  buildOrgDumpQueries,
  buildOrgEmailKeyedQueries,
  ORG_EXPORT_DEFERRED_TABLES,
  ORG_MEMBERSHIP_SCOPED_TABLES,
} from "./orgQueries.js";

/** Bundle manifest builder + constants (manifest.json — Decision Q9/Q10). */
export {
  buildManifest,
  serializeManifest,
  GENERATOR_VERSION,
  EXPORT_GDPR_NOTE,
  type BuildManifestInput,
} from "./manifest.js";

/**
 * The executor (`runExport`) lives in `./exporter.js` and is DELIBERATELY NOT
 * re-exported here: it imports the DB layer (infra/postgres), which throws at
 * module-eval if DATABASE_URL is unset. Keeping this barrel free of that import
 * lets the pure query/manifest surface (and its drift tests) be consumed with
 * no database. Callers of the executor (the PR #3 worker) import it directly:
 *   import { runExport } from "../services/dataExport/exporter.js";
 */
