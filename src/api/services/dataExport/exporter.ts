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
 * `scope:'org_full'` (PR #2c) is wired here on top of PR #2b's pure builders:
 * the org's current member emails are enumerated once (the `readMemberEmails`
 * seam, default `WHERE status <> 'deleted'` per Decision Q3), then
 * `buildOrgExportQueries` drives the same per-table streaming loop as the self
 * export. The R2 vendor-assurance ATTACHMENT bytes (Q6) are NOT bundled yet —
 * `manifest.attachments` stays `[]` and an org_full manifest note discloses it;
 * attachment streaming lands in a follow-up PR.
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
import { buildOrgExportQueries } from "./orgQueries.js";
import { buildTableColumnsMap } from "./columnProbe.js";
import { dependencyAssessmentsHasReviewerUuid } from "./dependencyAssessmentsProbe.js";
import { buildManifest, serializeManifest } from "./manifest.js";

/** The archiver instance type (from the local `archiver` shim's callable return). */
type ArchiverInstance = ReturnType<typeof archiver>;

/** Cursor read batch size (Invariant D) — bounds memory to one batch + zlib window. */
export const EXPORT_BATCH_SIZE = 500;

/**
 * Honest disclosure (no silent cap) recorded in every org_full manifest until
 * R2 attachment streaming (Q6) lands: this bundle carries database tables only,
 * not the vendor-assurance document files those tables reference.
 */
export const ORG_FULL_ATTACHMENTS_DEFERRED_NOTE =
  "attachments: vendor-assurance document files (Q6) are not bundled in this export — only database tables are included. Attachment streaming lands in a follow-up release.";

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
  /**
   * org_full only (Decision Q3/N4): the CURRENT emails of the org's members,
   * read from `users.email` (NEVER client input — trust-model invariant). The
   * default enumerates non-deleted members (`status <> 'deleted'`); the result
   * is matched against the platform-level email-keyed tables in
   * `buildOrgEmailKeyedQueries`. Unused for `user_self`.
   */
  readMemberEmails?: (orgId: string) => Promise<readonly string[]>;
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
 * Default member-email enumeration for org_full (Decision Q3/N4). Reads the
 * CURRENT `users.email` of every non-deleted member inside `withTenant(orgId)`
 * with an EXPLICIT `organization_id` predicate — the same belt-and-suspenders
 * boundary the org dump uses (RLS is bypassed under owner creds / absent on
 * pending-RLS tables, so the explicit predicate is the real boundary; live RLS
 * is defense-in-depth). Deleted accounts are excluded because their email was
 * scrubbed at tombstone time, so it no longer keys their old records (manifest
 * gdpr_note discloses this). Emails are read from the DB, never request input.
 */
async function defaultReadMemberEmails(orgId: string): Promise<readonly string[]> {
  return withTenant(orgId, async () => {
    const { rows } = await pg.query(
      "SELECT email FROM users WHERE organization_id = $1 AND status <> 'deleted' AND email IS NOT NULL ORDER BY email",
      [orgId],
    );
    return (rows as Array<{ email: unknown }>).map((r) => String(r.email));
  });
}

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

  const now = (deps.now ?? (() => new Date()))();
  const probeRunner = deps.probeRunner ?? defaultProbeRunner;
  const withScope = deps.withScope ?? withTenant;
  const openStreamer = deps.openStreamer ?? defaultOpenStreamer;
  const readSchemaVersion = deps.readSchemaVersion ?? defaultReadSchemaVersion;
  const readMemberEmails = deps.readMemberEmails ?? defaultReadMemberEmails;

  // Probes + (org_full) member enumeration run once, before the per-table
  // tenant scopes (N2). The schema_version + column probes apply to both scopes.
  const tableColumns = await buildTableColumnsMap(probeRunner);
  const schemaVersion = await readSchemaVersion();

  // org_full bundles a per-scope disclosure note (no silent attachment cap).
  const seedNotes: string[] = [];
  let queries: ExportQuery[];
  let memberCount = 0;
  if (scope === "org_full") {
    const memberEmails = await readMemberEmails(subject.orgId);
    memberCount = memberEmails.length;
    queries = buildOrgExportQueries(subject.orgId, memberEmails, tableColumns);
    seedNotes.push(ORG_FULL_ATTACHMENTS_DEFERRED_NOTE);
  } else {
    // reviewer_uuid matching is a self-export concern only (org_full full-dumps
    // dependency_assessments by org predicate), so probe it only when needed.
    const reviewerUuidPresent = await dependencyAssessmentsHasReviewerUuid(probeRunner);
    queries = buildSelfExportQueries(
      subject,
      { dependencyAssessmentsReviewerUuidPresent: reviewerUuidPresent },
      tableColumns,
    );
  }

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
  const notes: string[] = [...seedNotes];
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
      scope,
      // An org_full bundle is an org-level artifact, not a single subject's —
      // its target is the organization, so target_user_id is null (Q2/§4).
      targetUserId: scope === "org_full" ? null : subject.userId,
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
        scope,
        subject_id: subject.userId,
        org_id: subject.orgId,
        bundle_key: exportId,
        // Count only (Invariant E): never log member emails / PII values.
        member_count: scope === "org_full" ? memberCount : undefined,
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
        scope,
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
