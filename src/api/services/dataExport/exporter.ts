/**
 * exporter.ts — the GDPR/CCPA export EXECUTOR (PR #2b).
 *
 * `runExport` drives the self-export query list (PR #2a builders) to completion
 * inside per-table `withTenant` scopes, streams each table's rows through the
 * NDJSON transform into a zip entry a row at a time, writes the manifest last,
 * and finalizes the archive into a caller-supplied sink.
 *
 * ── Security invariants (from the PR #2a security review) ────────────────────
 *  A. requireTenantContext() is called inside every per-table scope before the
 *     builder's SQL runs (fail-closed). Enforced by `defaultOpenStreamer`.
 *  B. ExportSubject.userEmail MUST be the authenticated subject's users.email —
 *     the caller's responsibility (this module never reads it from request input).
 *  C. Every streamer is closed in a `finally`, even on mid-stream error.
 *  D. Cursor read batch size is bounded by EXPORT_BATCH_SIZE.
 *  E. One structured log per export — ids + per-table row counts + bundle key,
 *     NO email / PII values.
 *
 * ── Bounded memory + the withTenant/archiver pinch (Decision Q1/Q2) ──────────
 * `withTenant` COMMITs and releases the connection on callback return, while
 * archiver pulls an appended source lazily — handing archiver a cursor-backed
 * stream would read rows after COMMIT (use-after-release). Instead the cursor is
 * fully drained INSIDE the scope into an in-memory PassThrough (DB-independent),
 * and we await archiver consuming that entry (`'entry'`) BEFORE leaving the
 * scope. Memory stays bounded to one batch + the stream's high-water mark.
 *
 * `scope:'org_full'` is intentionally NOT wired here — it lands in PR #2c. The
 * org_full query builders (`orgQueries.ts`) ship in PR #2b and are unit-tested,
 * but the executor only runs `user_self`.
 */

import { once } from "node:events";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import archiver from "archiver";

import { pg, withTenant, withElevated, requireTenantContext } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import type {
  ExportQuery,
  ExportResult,
  ExportScope,
  ExportSubject,
  ManifestTableEntry,
  QueryRunner,
  RowStreamer,
} from "./types.js";
import { CursorRowStreamer } from "./rowStreamer.js";
import { rowToNdjsonLine } from "./ndjsonTransform.js";
import { buildSelfExportQueries } from "./selfQueries.js";
import { buildTableColumnsMap } from "./columnProbe.js";
import { dependencyAssessmentsHasReviewerUuid } from "./dependencyAssessmentsProbe.js";
import { buildManifest, serializeManifest } from "./manifest.js";

/** The archiver instance type (from the local `archiver` shim's callable return). */
type ArchiverInstance = ReturnType<typeof archiver>;

/** Cursor read batch size (Invariant D) — bounds memory to one batch + zlib window. */
export const EXPORT_BATCH_SIZE = 500;

/** Thrown when `runExport` is asked for an org_full export, which lands in PR #2c. */
export class OrgExportNotWiredError extends Error {
  constructor() {
    super(
      "runExport: scope 'org_full' is not wired yet — it lands in PR #2c. The org_full " +
        "query builders (buildOrgExportQueries) ship in PR #2b but the executor only runs 'user_self'.",
    );
    this.name = "OrgExportNotWiredError";
  }
}

export interface RunExportArgs {
  /** The data subject. `userEmail` MUST come from the authenticated users.email (Invariant B). */
  subject: ExportSubject;
  scope: ExportScope;
  /** Archive destination (Buffer collector in tests; R2 multipart in PR #3; fs locally). */
  sink: NodeJS.WritableStream;
  /** data_export_files.id (a uuid in tests until PR #5 creates the row). */
  exportId: string;
  /** Optional cancellation — checked between tables. */
  signal?: AbortSignal;
}

/**
 * Injectable seams (Decision N1) so the executor core is unit-testable with no
 * database. Production defaults wire `withTenant` + `CursorRowStreamer` + the
 * owner-channel schema-version read; tests pass an identity scope +
 * `ArrayRowStreamer` + a Buffer sink.
 */
export interface RunExportDeps {
  withScope?: <T>(orgId: string, fn: () => Promise<T>) => Promise<T>;
  openStreamer?: (query: ExportQuery) => RowStreamer;
  probeRunner?: QueryRunner;
  readSchemaVersion?: () => Promise<string | null>;
  now?: () => Date;
}

/** Default streamer factory — also the Invariant-A fail-closed gate. */
function defaultOpenStreamer(query: ExportQuery): RowStreamer {
  const ctx = requireTenantContext(); // Invariant A: throws if not in a withTenant scope.
  return new CursorRowStreamer(ctx.client, query.text, query.values);
}

/** Default probe runner — information_schema is role-agnostic, so ambient pg is fine (N2). */
const defaultProbeRunner: QueryRunner = async (text, values) => {
  const result = await pg.query(text, values as unknown[]);
  return { rows: result.rows as Array<Record<string, unknown>> };
};

/**
 * Default schema_version read (Decision Q1/N2): the latest applied migration
 * FILENAME, on the owner channel (`schema_migrations` is owner-only). Tolerates
 * a missing table (some bootstrap/test DBs apply migrations without the
 * runMigrations bookkeeping table) by returning null rather than throwing.
 */
async function defaultReadSchemaVersion(): Promise<string | null> {
  try {
    return await withElevated(async (client) => {
      const { rows } = await client.query(
        "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1",
      );
      const [first] = rows as Array<{ filename?: unknown }>;
      return first ? String(first.filename) : null;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null; // undefined_table
    throw err;
  }
}

/**
 * Stream one table into the archive inside its own tenant scope, returning its
 * manifest entry. The cursor is drained to completion and the archive entry is
 * fully consumed BEFORE the scope returns (Q1), and the streamer is closed in a
 * `finally` (Invariant C).
 */
async function consumeTableIntoArchive(params: {
  query: ExportQuery;
  archive: ArchiverInstance;
  orgId: string;
  withScope: <T>(orgId: string, fn: () => Promise<T>) => Promise<T>;
  openStreamer: (query: ExportQuery) => RowStreamer;
}): Promise<ManifestTableEntry> {
  const { query, archive, orgId, withScope, openStreamer } = params;
  const file = `tables/${query.table}.ndjson`;

  return withScope(orgId, async () => {
    const streamer = openStreamer(query);
    const pass = new PassThrough();
    const hash = createHash("sha256");
    let rowCount = 0;
    let sizeBytes = 0;

    // Resolve when archiver has fully consumed THIS entry. Match by name so
    // event ordering across tables can never cross the wires.
    const entryConsumed = new Promise<void>((resolve) => {
      const onEntry = (data: { name: string }): void => {
        if (data.name === file) {
          archive.off("entry", onEntry);
          resolve();
        }
      };
      archive.on("entry", onEntry);
    });

    archive.append(pass, { name: file });

    try {
      for (;;) {
        const batch = await streamer.read(EXPORT_BATCH_SIZE);
        if (batch.length === 0) break;
        for (const row of batch) {
          const line = rowToNdjsonLine(row);
          hash.update(line);
          sizeBytes += Buffer.byteLength(line);
          rowCount += 1;
          if (!pass.write(line)) await once(pass, "drain");
        }
      }
      pass.end();
      await entryConsumed;
    } finally {
      await streamer.close();
    }

    const entry: ManifestTableEntry = {
      name: query.table,
      category: query.category,
      row_count: rowCount,
      file,
      size_bytes: sizeBytes,
      sha256: hash.digest("hex"),
    };
    return query.note ? { ...entry, note: query.note } : entry;
  });
}

/**
 * Run a GDPR/CCPA export and write the zip bundle to `sink`. Returns the
 * manifest + total uncompressed payload size. Fails the WHOLE export on any
 * table error (no partial bundle) — retries are the PR #3 worker's job.
 */
export async function runExport(args: RunExportArgs, deps: RunExportDeps = {}): Promise<ExportResult> {
  const { subject, scope, sink, exportId, signal } = args;
  if (scope === "org_full") throw new OrgExportNotWiredError();

  const now = (deps.now ?? (() => new Date()))();
  const probeRunner = deps.probeRunner ?? defaultProbeRunner;
  const withScope = deps.withScope ?? withTenant;
  const openStreamer = deps.openStreamer ?? defaultOpenStreamer;
  const readSchemaVersion = deps.readSchemaVersion ?? defaultReadSchemaVersion;

  // Probes run once, before the per-table tenant scopes (N2).
  const tableColumns = await buildTableColumnsMap(probeRunner);
  const reviewerUuidPresent = await dependencyAssessmentsHasReviewerUuid(probeRunner);
  const schemaVersion = await readSchemaVersion();

  const queries = buildSelfExportQueries(
    subject,
    { dependencyAssessmentsReviewerUuidPresent: reviewerUuidPresent },
    tableColumns,
  );

  const archive = archiver("zip", { zlib: { level: 9 } });
  // Race every awaited archive step against this so a mid-stream archiver error
  // rejects instead of hanging an entry that will never complete.
  const archiveErrored = new Promise<never>((_, reject) => {
    archive.on("error", (err: Error) => reject(err));
  });
  archiveErrored.catch(() => undefined); // ensure the rejection is always considered handled
  archive.on("warning", (err: { code?: string; message?: string }) => {
    if (err?.code === "ENOENT") return;
    logger.warn({ event: "data_export_archive_warning", message: err?.message }, "archiver warning");
  });

  const sinkSettled = new Promise<void>((resolve, reject) => {
    sink.on("error", reject);
    sink.on("close", () => resolve());
    sink.on("finish", () => resolve());
  });
  archive.pipe(sink);

  const tables: ManifestTableEntry[] = [];
  const notes: string[] = [];
  let bytesWritten = 0;

  try {
    for (const query of queries) {
      if (signal?.aborted) throw new Error("runExport: aborted before completing the export");
      const entry = await Promise.race([
        consumeTableIntoArchive({ query, archive, orgId: subject.orgId, withScope, openStreamer }),
        archiveErrored,
      ]);
      tables.push(entry);
      bytesWritten += entry.size_bytes;
      if (entry.note) notes.push(`${entry.name}: ${entry.note}`);
    }

    const manifest = buildManifest({
      exportId,
      scope: "user_self",
      targetUserId: subject.userId,
      targetOrganizationId: subject.orgId,
      generatedAt: now,
      schemaVersion,
      tables,
      notes,
    });
    archive.append(serializeManifest(manifest), { name: "manifest.json" });

    await Promise.race([archive.finalize(), archiveErrored]);
    await Promise.race([sinkSettled, archiveErrored]);

    logger.info(
      {
        event: "data_export_completed",
        scope: "user_self",
        subject_id: subject.userId,
        org_id: subject.orgId,
        bundle_key: exportId,
        table_count: tables.length,
        tables: tables.map((t) => ({ name: t.name, row_count: t.row_count })),
        bytes_written: bytesWritten,
      },
      "data export completed",
    );

    return { manifest, bytes_written: bytesWritten };
  } catch (err) {
    // Fail-the-whole-export: never leave a partial bundle behind.
    try {
      archive.abort();
    } catch {
      /* archive already torn down */
    }
    logger.error(
      {
        event: "data_export_failed",
        scope: "user_self",
        subject_id: subject.userId,
        org_id: subject.orgId,
        bundle_key: exportId,
        message: (err as Error)?.message,
      },
      "data export failed",
    );
    throw err;
  }
}
