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
 * export.
 *
 * ── R2 attachment streaming (PR #2d, Decision Q6) ────────────────────────────
 * For org_full, after the tables are written the attachment-bearing rows
 * (`vendor_assurance_documents` — the only blob-backed table) are enumerated
 * once via the `readAttachments` seam (metadata only, inside `withTenant` with
 * an explicit org predicate), then each R2 blob is streamed — OUTSIDE any DB
 * scope, since the read needs no connection — through a sha256 hash into its own
 * `attachments/vendor-assurance/<docId>.pdf` zip entry, one blob at a time so
 * peak memory is one blob's stream high-water mark. The streamed sha256 is
 * cross-checked against the upload-time `sha256`. Failure semantics (Decision
 * #6): a CONFIRMED-ABSENT blob (`AttachmentNotFoundError`) becomes a disclosed
 * `status:'unavailable'` manifest entry and the export continues; an
 * INDETERMINATE R2 error or a sha256 MISMATCH fails the whole export (no silent
 * partial, no silently-wrong bytes). user_self never bundles attachments.
 */

import { once } from "node:events";
import { createHash } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";

import archiver from "archiver";

import { pg, withTenant, withElevated, requireTenantContext } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { getVendorAssurancePdfStream } from "../../lib/vendorAssuranceStorage.js";
import type {
  AttachmentRef,
  ExportQuery,
  ExportResult,
  ExportScope,
  ExportSubject,
  ManifestAttachmentEntry,
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

/** The only attachment-bearing (R2 blob-backed) table today (Decision Q6/#2). */
export const VENDOR_ASSURANCE_DOCUMENTS_TABLE = "vendor_assurance_documents";

/**
 * Raised by the `openAttachment` seam when an attachment's R2 object is
 * CONFIRMED ABSENT (NoSuchKey / 404). The executor catches THIS specific error
 * and records a disclosed `status:'unavailable'` manifest gap (Decision #6);
 * every OTHER error from the seam is indeterminate and fails the whole export.
 */
export class AttachmentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentNotFoundError";
  }
}

/** The zip entry path for one attachment (matches `ManifestAttachmentEntry.path`). */
function attachmentZipPath(documentId: string): string {
  return `attachments/vendor-assurance/${documentId}.pdf`;
}

/** True for an AWS SDK / R2 "object does not exist" error (404 / NoSuchKey). */
function isObjectAbsentError(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
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
  /**
   * org_full only (Decision Q3/N4): the CURRENT emails of the org's members,
   * read from `users.email` (NEVER client input — trust-model invariant). The
   * default enumerates non-deleted members (`status <> 'deleted'`); the result
   * is matched against the platform-level email-keyed tables in
   * `buildOrgEmailKeyedQueries`. Unused for `user_self`.
   */
  readMemberEmails?: (orgId: string) => Promise<readonly string[]>;
  /**
   * org_full only (Decision Q6/#3): enumerate the org's attachment-bearing rows
   * (metadata only — id / storage_key / byte_size / sha256), read from
   * `vendor_assurance_documents` inside `withTenant(orgId)` with an EXPLICIT
   * `organization_id` predicate (the real boundary on a pending-RLS table). The
   * bytes are NOT read here — they stream from R2 via `openAttachment`, outside
   * any DB scope. Unused for `user_self`.
   */
  readAttachments?: (orgId: string) => Promise<readonly AttachmentRef[]>;
  /**
   * org_full only (Decision Q6/#4): open a streaming read of one attachment's
   * bytes from R2. MUST throw `AttachmentNotFoundError` when the object is
   * confirmed absent (so the executor can record a disclosed gap); any other
   * error is indeterminate and fails the whole export. Defaults to the
   * vendor-assurance R2 wrapper (key reconstructed from the documentId).
   */
  openAttachment?: (ref: AttachmentRef) => Promise<Readable>;
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
 * Default attachment enumeration for org_full (Decision Q6/#3). Reads the
 * metadata of every `vendor_assurance_documents` row for the org inside
 * `withTenant(orgId)` with an EXPLICIT `organization_id` predicate (the same
 * belt-and-suspenders boundary the table dump uses — RLS is bypassed under owner
 * creds / pending on this table, so the predicate is the real boundary). Returns
 * metadata ONLY; the blob bytes stream from R2 separately. `byte_size` is BIGINT
 * (pg returns it as a string), so it is parsed to a number for the ref.
 */
async function defaultReadAttachments(orgId: string): Promise<readonly AttachmentRef[]> {
  return withTenant(orgId, async () => {
    const { rows } = await pg.query(
      `SELECT id, storage_key, byte_size, sha256
         FROM ${VENDOR_ASSURANCE_DOCUMENTS_TABLE}
        WHERE organization_id = $1
        ORDER BY id`,
      [orgId],
    );
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      documentId: String(r.id),
      orgId,
      storageKey: String(r.storage_key),
      sizeBytes: Number(r.byte_size),
      sha256: String(r.sha256),
      sourceTable: VENDOR_ASSURANCE_DOCUMENTS_TABLE,
    }));
  });
}

/**
 * Default attachment byte read for org_full (Decision Q6/#4). Streams the
 * original PDF from R2 via the vendor-assurance wrapper, which reconstructs the
 * org-prefixed key from the documentId (so we never trust a stored key string)
 * and asserts the org prefix before any I/O. A confirmed-absent object is mapped
 * to `AttachmentNotFoundError` (→ disclosed gap); every other error propagates
 * unchanged (→ fail-whole). An empty/missing body is treated as absent.
 */
async function defaultOpenAttachment(ref: AttachmentRef): Promise<Readable> {
  let output;
  try {
    output = await getVendorAssurancePdfStream({
      organizationId: ref.orgId,
      documentId: ref.documentId,
    });
  } catch (err) {
    if (isObjectAbsentError(err)) {
      throw new AttachmentNotFoundError(`attachment object not found in R2 for document ${ref.documentId}`);
    }
    throw err;
  }
  const body = output.Body;
  if (!body) {
    throw new AttachmentNotFoundError(`attachment object has no body in R2 for document ${ref.documentId}`);
  }
  return body as Readable;
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
 * Stream one attachment's R2 bytes into the archive, returning its manifest
 * entry. Decision Q6/#4-#6/#8:
 *  • The blob streams a chunk at a time through a sha256 hash into its own zip
 *    entry; peak memory is one blob's stream high-water mark. No DB scope is
 *    held (the R2 read needs no connection), so there is no withTenant pinch.
 *  • A CONFIRMED-ABSENT object (`AttachmentNotFoundError` from the seam) yields a
 *    disclosed `status:'unavailable'` entry — NO zip member is appended — and the
 *    export continues. Any OTHER seam error propagates (→ fail-whole).
 *  • The streamed sha256 is cross-checked against the upload-time `sha256`; a
 *    MISMATCH throws (→ fail-whole) rather than emit silently-wrong bytes.
 */
async function consumeAttachmentIntoArchive(params: {
  ref: AttachmentRef;
  archive: ArchiverInstance;
  openAttachment: (ref: AttachmentRef) => Promise<Readable>;
}): Promise<ManifestAttachmentEntry> {
  const { ref, archive, openAttachment } = params;
  const file = attachmentZipPath(ref.documentId);

  let blob: Readable;
  try {
    blob = await openAttachment(ref);
  } catch (err) {
    if (err instanceof AttachmentNotFoundError) {
      // Disclosed gap (no silent omission): recorded in the manifest, NOT in the zip.
      return {
        path: file,
        status: "unavailable",
        size_bytes: null,
        sha256: null,
        source_table: ref.sourceTable,
        source_row_id: ref.documentId,
        unavailable_reason: err.message,
      };
    }
    throw err; // indeterminate → fail-whole
  }

  const pass = new PassThrough();
  const hash = createHash("sha256");
  let sizeBytes = 0;

  // Resolve when archiver has fully consumed THIS entry (match by name).
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
    // for-await pulls one chunk at a time; awaiting 'drain' on backpressure keeps
    // memory bounded to the high-water mark instead of buffering the whole file.
    for await (const chunk of blob) {
      const buf = chunk as Buffer;
      hash.update(buf);
      sizeBytes += buf.length;
      if (!pass.write(buf)) await once(pass, "drain");
    }
    pass.end();
    await entryConsumed;
  } catch (err) {
    pass.destroy(err as Error);
    throw err;
  } finally {
    if (!blob.destroyed) blob.destroy();
  }

  const digest = hash.digest("hex");
  if (ref.sha256 && digest !== ref.sha256) {
    // Corruption / tamper — never emit silently-wrong bytes (Decision #5/#6).
    throw new Error(
      `attachment ${ref.documentId}: sha256 mismatch (stored ${ref.sha256}, streamed ${digest})`,
    );
  }

  return {
    path: file,
    status: "included",
    size_bytes: sizeBytes,
    sha256: digest,
    source_table: ref.sourceTable,
    source_row_id: ref.documentId,
  };
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
  const readAttachments = deps.readAttachments ?? defaultReadAttachments;
  const openAttachment = deps.openAttachment ?? defaultOpenAttachment;

  // Probes + (org_full) member enumeration run once, before the per-table
  // tenant scopes (N2). The schema_version + column probes apply to both scopes.
  const tableColumns = await buildTableColumnsMap(probeRunner);
  const schemaVersion = await readSchemaVersion();

  let queries: ExportQuery[];
  let memberCount = 0;
  if (scope === "org_full") {
    const memberEmails = await readMemberEmails(subject.orgId);
    memberCount = memberEmails.length;
    queries = buildOrgExportQueries(subject.orgId, memberEmails, tableColumns);
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
  const attachments: ManifestAttachmentEntry[] = [];
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

    // Attachment phase (org_full only, Decision Q6/#9): streamed AFTER every
    // table, BEFORE the manifest, so the manifest's hashes/sizes stay
    // authoritative for the bundle that was actually written.
    if (scope === "org_full") {
      const refs = await readAttachments(subject.orgId);
      for (const ref of refs) {
        if (signal?.aborted) throw new Error("runExport: aborted before completing the export");
        const entry = await Promise.race([
          consumeAttachmentIntoArchive({ ref, archive, openAttachment }),
          archiveErrored,
        ]);
        attachments.push(entry);
        if (entry.size_bytes) bytesWritten += entry.size_bytes;
      }
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
      attachments,
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
        // Attachment counts only (Invariant E): never log keys / filenames / PII.
        attachment_count: scope === "org_full" ? attachments.length : undefined,
        attachments_unavailable:
          scope === "org_full"
            ? attachments.filter((a) => a.status === "unavailable").length
            : undefined,
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
