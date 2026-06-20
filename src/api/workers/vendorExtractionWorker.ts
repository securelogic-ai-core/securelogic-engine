/**
 * vendorExtractionWorker.ts — core logic for the durable vendor-assurance
 * extraction worker (Pillar 1, build step 2).
 *
 * This REPLACES the in-process `setImmediate` runner
 * (`vendorAssuranceExtractionRunner.ts`, whose own author wrote "do not promote
 * this runner to production"). It is a near-copy of `dataRightsWorker.ts`: it
 * claims `vendor_assurance_extract` jobs from the generic `jobs` table via
 * `FOR UPDATE SKIP LOCKED`, runs the EXISTING extraction steps (`extractPdfText`,
 * `runSocExtraction`, `persistExtractionAndMarkExtracted`,
 * `refreshCuecMappingsForDocument` — reused verbatim, not rewritten), and writes
 * a terminal job state. Because the work is now a durable claimed job, a deploy
 * that lands mid-extraction no longer strands the document: the visibility
 * timeout reclaims the job and it is retried.
 *
 * ── Tenant isolation (mirrors dataRightsWorker.ts) ───────────────────────────
 *  • The CLAIM POLL runs on the elevated/owner channel (`pgElevated`): a
 *    context-less poller on the tenant channel would see ZERO rows post-RLS-flip
 *    (jobs RLS filters to current_org_id). EVERYTHING after the claim — the
 *    pre-check, the persist, the document state transitions and the terminal
 *    jobs UPDATE — runs inside `withTenant(job.organization_id)` so it is
 *    RLS-correct and provably single-org. One job = one document = one org.
 *
 * ── Idempotency — HARD REQUIREMENT (spec §B.7) ───────────────────────────────
 *  `vendor_assurance_extractions.document_id` is UNIQUE. A job that crashes
 *  AFTER the persist COMMIT but BEFORE marking the job succeeded is reclaimed and
 *  re-run; the re-run must NOT hit a duplicate-INSERT error. Two defences:
 *    1. A pre-check SELECT at the top: if an extraction row already exists, the
 *       worker drives the document to `extracted` and the job to `succeeded`
 *       WITHOUT re-calling Claude (saves credits) — an idempotent success.
 *    2. A belt: a unique-violation (23505) during persist is caught and treated
 *       as the same idempotent success.
 *  The single-claim guarantee (FOR UPDATE SKIP LOCKED) means only the
 *  reclaim-after-commit path can produce a duplicate; both defences cover it.
 *
 * ── Retry / failure (settled, spec §B.3 / §F.5; policy reused from data-rights) ─
 *  • TERMINAL input faults — `pdf_image_only`, `llm_invalid_json` — throw a
 *    TerminalExtractionError (a NonRetryableJobError) → job `failed`, no retry,
 *    document marked `extraction_failed` with its typed code for the UI.
 *  • TRANSIENT faults — worker restart / redeploy reclaim, R2 blip,
 *    `llm_unavailable`/`llm_failed`, `pdf_unparseable`, any unexpected error —
 *    requeue with exponential backoff, then `dead_lettered` at max attempts. The
 *    document stays `extracting` while retrying and only flips to
 *    `extraction_failed` once the job reaches a terminal state.
 */

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { getVendorAssurancePdfStream } from "../lib/vendorAssuranceStorage.js";
import { extractPdfText } from "../lib/vendorAssurancePdfExtractor.js";
import { runSocExtraction } from "../lib/claudeSocExtractor.js";
import { refreshCuecMappingsForDocument } from "../lib/vendorAssuranceCuecMatcher.js";
import {
  markExtracting,
  markFailed,
  persistExtractionAndMarkExtracted,
} from "../lib/vendorAssuranceExtractionRunner.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  VENDOR_EXTRACTION_JOB_TYPES,
  classifyExtractionError,
  decideFailureState,
} from "../lib/vendorExtractionWorkerPolicy.js";

// Re-export the DB-free policy surface so callers import everything from here.
export {
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  RetryableExtractionError,
  TerminalExtractionError,
  VENDOR_EXTRACTION_JOB_TYPES,
  backoffMs,
  classifyExtractionError,
  decideFailureState,
} from "../lib/vendorExtractionWorkerPolicy.js";

/** The columns the claim returns — the subset the worker needs to process a job. */
export interface JobRow {
  id: string;
  organization_id: string;
  requested_by_user_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
}

/** Injectable seams so the executor core is testable with no R2 / no Claude. */
export interface WorkerDeps {
  /** Identifies this worker instance in locked_by. */
  workerId?: string;
  now?: () => Date;
  /** Fetch the document PDF bytes — defaults to R2 via vendorAssuranceStorage. */
  fetchPdf?: (orgId: string, documentId: string) => Promise<Buffer>;
  /** PDF text extraction — defaults to extractPdfText (pdf-parse). */
  extractPdfTextFn?: typeof extractPdfText;
  /** SOC field extraction — defaults to runSocExtraction (Claude). */
  runSocExtractionFn?: typeof runSocExtraction;
  /** CUEC mapping (non-fatal) — defaults to refreshCuecMappingsForDocument. */
  refreshCuecFn?: (documentId: string, orgId: string) => Promise<unknown>;
  /** Loop guard: runOneTick stops claiming when this returns false (shutdown). */
  shouldContinue?: () => boolean;
}

/** S3 SDK Body in Node is an AsyncIterable<Uint8Array>. */
async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body == null) throw new Error("empty body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function defaultFetchPdf(orgId: string, documentId: string): Promise<Buffer> {
  const obj = await getVendorAssurancePdfStream({ organizationId: orgId, documentId });
  return streamToBuffer(obj.Body);
}

/**
 * Atomically claim the next vendor-extraction job (or reclaim a crashed one) on
 * the ELEVATED channel. SELECT ... FOR UPDATE SKIP LOCKED inside the UPDATE makes
 * two worker instances unable to double-claim. Identical to the data-rights
 * claim except for the job-type filter. Returns null when nothing is claimable.
 */
const CLAIM_SQL = `
  UPDATE jobs
     SET status = 'processing',
         locked_by = $1,
         locked_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = (
     SELECT id FROM jobs
      WHERE job_type = ANY($2::text[])
        AND (
              (status = 'queued' AND scheduled_for <= now())
           OR (status = 'processing' AND locked_at < now() - ($3::bigint * interval '1 millisecond'))
        )
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING id, organization_id, requested_by_user_id, job_type, status, attempts, max_attempts, payload`;

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const { rows } = await pgElevated.query(CLAIM_SQL, [
    workerId,
    [...VENDOR_EXTRACTION_JOB_TYPES],
    LOCK_TIMEOUT_MS,
  ]);
  return (rows[0] as JobRow | undefined) ?? null;
}

/** The document id this job targets, read from the job payload (never trusted blindly). */
function resolveDocumentId(job: JobRow): { documentId: string; documentTypeHint: string | null } {
  const documentId = typeof job.payload?.documentId === "string" ? job.payload.documentId : null;
  if (!documentId) {
    throw new NonRetryableJobError("vendor_assurance_extract job payload missing a string documentId");
  }
  const hint = job.payload?.documentTypeHint;
  return { documentId, documentTypeHint: typeof hint === "string" ? hint : null };
}

/** True for a Postgres unique-violation on the one-extraction-per-document constraint. */
function isExtractionUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "23505";
}

/**
 * Drive a document+job to terminal SUCCESS inside one tenant scope: the document
 * to `extracted` (idempotent — covers the reclaim-after-commit case) and the job
 * to `succeeded` with its result. Then run CUEC mapping, strictly non-fatal
 * (mirrors the in-process runner: the extraction is already committed; a matcher
 * failure leaves the Re-match button as the recovery path).
 */
async function recordSuccess(
  job: JobRow,
  documentId: string,
  result: { extraction_id: string; field_count?: number; span_count?: number },
  now: Date,
  refreshCuecFn: (documentId: string, orgId: string) => Promise<unknown>,
): Promise<void> {
  const orgId = job.organization_id;
  await withTenant(orgId, async () => {
    await pg.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'extracted',
              processing_error_code = NULL,
              processing_error_detail = NULL,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND processing_status <> 'finalized'`,
      [documentId, orgId],
    );
    await pg.query(
      `UPDATE jobs
          SET status = 'succeeded', result = $2::jsonb, error = NULL,
              locked_by = NULL, locked_at = NULL,
              completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [job.id, JSON.stringify({ document_id: documentId, ...result })],
    );
  });

  // Strictly non-fatal CUEC mapping. Awaited (this is a worker, not an HTTP
  // request) so a crash mid-CUEC after the job is already 'succeeded' simply
  // skips it — the job is never reopened (matches the runner's discipline).
  try {
    const cuec = await refreshCuecFn(documentId, orgId);
    logger.info(
      { event: "vendor_extraction_job_cuec_match", job_id: job.id, org_id: orgId, document_id: documentId, ...(cuec as object) },
      "vendor-extraction CUEC matching after extraction complete",
    );
  } catch (cuecErr) {
    logger.error(
      { event: "vendor_extraction_job_cuec_match_failed", job_id: job.id, org_id: orgId, document_id: documentId, err: (cuecErr as Error)?.message ?? "unknown" },
      "vendor-extraction CUEC matching after extraction failed (non-fatal)",
    );
  }
}

/**
 * Persist a failure outcome (requeue with backoff / failed / dead_lettered),
 * mirroring data-rights `recordFailure`. ADDITIONALLY, on a TERMINAL outcome
 * (`failed` or `dead_lettered`) the document is marked `extraction_failed` with
 * its typed `processing_error_code` so the existing UI failure surface is
 * unchanged (spec §B.3). On a requeue the document is left `extracting` — work
 * is still owed — so the document status stays a faithful mirror of job progress.
 */
async function recordFailure(
  job: JobRow,
  err: unknown,
  now: Date,
  documentId: string | null,
): Promise<void> {
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);

  if ((decision.status === "failed" || decision.status === "dead_lettered") && documentId) {
    const errorCode = (err as { errorCode?: string })?.errorCode ?? "llm_failed";
    const rawExcerpt = (err as { rawExcerpt?: string | null })?.rawExcerpt ?? null;
    try {
      await markFailed(documentId, job.organization_id, errorCode, message, rawExcerpt);
    } catch (markErr) {
      logger.error(
        { event: "vendor_extraction_job_mark_failed_error", job_id: job.id, org_id: job.organization_id, err: (markErr as Error)?.message },
        "vendor-extraction failed to mark document extraction_failed (job state still recorded)",
      );
    }
  }

  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt],
    );
  });
}

/**
 * Process one already-claimed job to completion. Never throws — every outcome is
 * persisted to the row. (The claim already moved the job to 'processing'.)
 */
export async function processClaimedJob(job: JobRow, deps: WorkerDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const fetchPdf = deps.fetchPdf ?? defaultFetchPdf;
  const extractPdfTextFn = deps.extractPdfTextFn ?? extractPdfText;
  const runSocExtractionFn = deps.runSocExtractionFn ?? runSocExtraction;
  const refreshCuecFn =
    deps.refreshCuecFn ?? ((documentId, orgId) => refreshCuecMappingsForDocument(documentId, orgId, { resyncRows: true }));
  const orgId = job.organization_id;

  let documentId: string;
  let documentTypeHint: string | null;
  try {
    ({ documentId, documentTypeHint } = resolveDocumentId(job));
  } catch (err) {
    await recordFailure(job, err, now(), null);
    logger.error(
      { event: "vendor_extraction_job_failed", job_id: job.id, org_id: orgId, phase: "resolve", message: (err as Error)?.message },
      "vendor-extraction job failed to resolve documentId",
    );
    return;
  }

  try {
    // §B.7 defence 1 — idempotent pre-check. If a committed extraction already
    // exists (reclaim-after-commit), finalize as success without re-calling
    // Claude. SELECT runs inside withTenant so it is RLS-correct post-flip.
    const existing = await withTenant(orgId, async () => {
      const { rows } = await pg.query<{ id: string }>(
        "SELECT id FROM vendor_assurance_extractions WHERE document_id = $1 AND organization_id = $2",
        [documentId, orgId],
      );
      return rows[0]?.id ?? null;
    });
    if (existing) {
      await recordSuccess(job, documentId, { extraction_id: existing }, now(), refreshCuecFn);
      logger.info(
        { event: "vendor_extraction_job_idempotent_success", job_id: job.id, org_id: orgId, document_id: documentId, extraction_id: existing },
        "vendor-extraction job: extraction already present, marked succeeded (idempotent)",
      );
      return;
    }

    await markExtracting(documentId, orgId);
    writeAuditEvent({
      organizationId: orgId,
      eventType: "vendor_assurance.extraction.started",
      resourceType: "vendor_assurance_document",
      resourceId: documentId,
      payload: { document_type_hint: documentTypeHint, job_id: job.id },
    });

    // 1. Pull the PDF bytes from R2. A fetch failure is TRANSIENT (R2 blip);
    //    wrap it with the runner's typed code so a terminal dead-letter still
    //    writes a coherent document error.
    let pdfBytes: Buffer;
    try {
      pdfBytes = await fetchPdf(orgId, documentId);
    } catch (fetchErr) {
      throw classifyExtractionError(
        "pdf_unparseable",
        `blob fetch: ${(fetchErr as Error)?.message ?? "failed"}`,
      );
    }

    // 2. Parse text.
    const parsed = await extractPdfTextFn(pdfBytes);
    if (!parsed.ok) {
      throw classifyExtractionError(parsed.errorCode, parsed.detail);
    }

    // 3. Call the LLM.
    const extracted = await runSocExtractionFn({
      organizationId: orgId,
      documentText: parsed.text,
      documentTypeHint,
    });
    if (!extracted.ok) {
      throw classifyExtractionError(extracted.errorCode, extracted.detail, extracted.rawExcerpt);
    }

    // 4. Persist transactionally (reused verbatim). §B.7 defence 2: a
    //    unique-violation means a concurrent/earlier run already committed —
    //    treat it as the same idempotent success.
    let persisted: { extractionId: string; spanCount: number; fieldCount: number };
    try {
      persisted = await persistExtractionAndMarkExtracted(documentId, orgId, extracted);
    } catch (persistErr) {
      if (isExtractionUniqueViolation(persistErr)) {
        const existingId = await withTenant(orgId, async () => {
          const { rows } = await pg.query<{ id: string }>(
            "SELECT id FROM vendor_assurance_extractions WHERE document_id = $1 AND organization_id = $2",
            [documentId, orgId],
          );
          return rows[0]?.id ?? null;
        });
        await recordSuccess(job, documentId, { extraction_id: existingId ?? "" }, now(), refreshCuecFn);
        logger.info(
          { event: "vendor_extraction_job_idempotent_success", job_id: job.id, org_id: orgId, document_id: documentId, phase: "persist_conflict" },
          "vendor-extraction job: persist hit unique constraint, marked succeeded (idempotent)",
        );
        return;
      }
      throw persistErr;
    }

    await recordSuccess(
      job,
      documentId,
      { extraction_id: persisted.extractionId, field_count: persisted.fieldCount, span_count: persisted.spanCount },
      now(),
      refreshCuecFn,
    );
    writeAuditEvent({
      organizationId: orgId,
      eventType: "vendor_assurance.extraction.completed",
      resourceType: "vendor_assurance_document",
      resourceId: documentId,
      payload: {
        extraction_id: persisted.extractionId,
        field_count: persisted.fieldCount,
        span_count: persisted.spanCount,
        job_id: job.id,
      },
    });
    logger.info(
      {
        event: "vendor_extraction_job_succeeded",
        job_id: job.id,
        org_id: orgId,
        document_id: documentId,
        extraction_id: persisted.extractionId,
        field_count: persisted.fieldCount,
        span_count: persisted.spanCount,
      },
      "vendor-extraction job succeeded",
    );
  } catch (err) {
    await recordFailure(job, err, now(), documentId);
    logger.error(
      { event: "vendor_extraction_job_failed", job_id: job.id, org_id: orgId, phase: "execute", error_code: (err as { errorCode?: string })?.errorCode, message: (err as Error)?.message },
      "vendor-extraction job failed",
    );
  }
}

/**
 * Drain the queue: claim + process jobs until none are claimable (or shutdown
 * is requested between jobs). Returns the number of jobs processed this tick.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  const workerId = deps.workerId ?? `vendor-extraction-worker-${process.pid}`;
  let processed = 0;
  for (;;) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processClaimedJob(job, deps);
    processed += 1;
  }
  return processed;
}
