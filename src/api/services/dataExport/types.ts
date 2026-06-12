/**
 * types.ts — shared type surface for the GDPR/CCPA export engine
 * (`src/api/services/dataExport/`). PR #2a is the query + streaming core; the
 * bundle/zip orchestration, manifest builder, and org-wide loop land in PR #2b.
 *
 * SOURCE OF TRUTH for classification: docs/DATA_CLASSIFICATION.md and its
 * machine-readable mirror src/api/lib/dataClassification.ts.
 */

import type { DataCategory } from "../../lib/dataClassification.js";

/**
 * The data subject a self-export is built for. `userEmail` is the subject's
 * CURRENT users.email (Decision Q5/Q6) — used to match legacy TEXT actor columns
 * and the email-keyed export tables. Historical email addresses are not tracked
 * and therefore not matched.
 */
export interface ExportSubject {
  userId: string;
  userEmail: string;
  orgId: string;
}

/**
 * A parameterized read for one table. The query is built here (PR #2a) and
 * consumed later (PR #2b) INSIDE a `withTenant(orgId)` callback (Decision Q1/Q2),
 * so org-scoping for RLS-governed tables is the caller's responsibility and is
 * deliberately NOT duplicated into `text`. The one exception is `subscribers`,
 * which has no `organization_id` column — there the unique email is the boundary.
 */
export interface ExportQuery {
  /** Table name (also the NDJSON entry stem, e.g. `findings` → `findings.ndjson`). */
  table: string;
  category: DataCategory;
  /** Parameterized SQL. `$1..$n` map positionally to `values`. */
  text: string;
  values: unknown[];
  /** Optional human note recorded for traceability (e.g. probe outcomes). */
  note?: string;
}

/**
 * Minimal query interface for one-shot reads that are NOT streamed (e.g. the
 * `information_schema` probe). Structurally satisfied by `pg`'s
 * `query(text, values)` and by a test double. Rows are untyped maps.
 */
export type QueryRunner = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Resolved column lists per table, keyed by table name. Supplied to the query
 * builders so a table with `exportExcludedColumns` can be projected as an
 * explicit allowlist (every column EXCEPT the excluded ones) instead of
 * `SELECT *`. Produced by the `columnProbe` (information_schema) and injected —
 * the builders stay pure/sync, mirroring how `dependencyAssessmentsReviewerUuidPresent`
 * is resolved out-of-band and passed in rather than probed inside the builder.
 */
export type TableColumns = Readonly<Record<string, readonly string[]>>;

/**
 * Streams rows for one `ExportQuery`. Cursor-backed in production
 * (`CursorRowStreamer`), array-backed in tests (`ArrayRowStreamer`) — Decision
 * Q10. `read` returns up to `batchSize` rows and an empty array signals
 * exhaustion; `close` releases the underlying portal/handle and is idempotent.
 */
export interface RowStreamer<T = Record<string, unknown>> {
  read(batchSize: number): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * SKETCH ONLY (Decision: manifest implementation deferred to PR #2b). Declared
 * here so #2a code can reference the shape without building the manifest writer.
 * The manifest itself is JSON (not NDJSON) — Decision Q9.
 */
export interface ManifestEntry {
  table: string;
  category: DataCategory;
  /** Authoritative row count for the table's `.ndjson` file. */
  rowCount: number;
  /** NDJSON entry path within the zip, e.g. `tables/findings.ndjson`. */
  file: string;
}
