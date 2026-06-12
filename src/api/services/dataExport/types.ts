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

/** Self-export (one data subject) vs full-org export (Decision Q2). */
export type ExportScope = "user_self" | "org_full";

/**
 * One table's entry in the bundle manifest (`manifest.json`). Keys are
 * snake_case ON PURPOSE: the manifest is a user-facing artifact and its keys
 * mirror the snake_case of the NDJSON data rows and the `data_export_files`
 * columns, so `JSON.stringify(manifest)` is the exact documented shape with no
 * camel/snake mapping layer. Decision Q9 (manifest is JSON, data is NDJSON).
 */
export interface ManifestTableEntry {
  /** Table name (the NDJSON entry stem, e.g. `findings`). */
  name: string;
  category: DataCategory;
  /** Authoritative row count for the table's `.ndjson` file. */
  row_count: number;
  /** NDJSON entry path within the zip, e.g. `tables/findings.ndjson`. */
  file: string;
  /** Byte length of the uncompressed NDJSON payload. */
  size_bytes: number;
  /** SHA-256 of the uncompressed NDJSON payload (tamper-evidence for the subject). */
  sha256: string;
  /** Optional traceability note carried from the `ExportQuery` (e.g. probe outcome). */
  note?: string;
}

/** One R2 attachment's entry in the manifest (org_full only — PR #2c wires it). */
export interface ManifestAttachmentEntry {
  /** Entry path within the zip, e.g. `attachments/vendor-assurance/<docId>.pdf`. */
  path: string;
  size_bytes: number;
  sha256: string;
  source_table: string;
  source_row_id: string;
}

/**
 * The bundle manifest (`manifest.json`). Built by `manifest.ts#buildManifest`.
 * snake_case keys — see `ManifestTableEntry`.
 */
export interface ExportManifest {
  export_id: string;
  scope: ExportScope;
  target_user_id: string | null;
  target_organization_id: string;
  generated_at: string;
  generator_version: string;
  /** Latest applied migration filename (Decision Q1), or null if unavailable. */
  schema_version: string | null;
  tables: ManifestTableEntry[];
  /** Always present; empty `[]` for user_self and for org_full until PR #2c. */
  attachments: ManifestAttachmentEntry[];
  notes: string[];
  gdpr_note: string;
}

/** What `runExport` returns to its caller (the PR #3 worker). */
export interface ExportResult {
  manifest: ExportManifest;
  /** Total uncompressed payload bytes across all table entries (NOT the zip size). */
  bytes_written: number;
}
