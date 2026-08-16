/**
 * vendorEvidenceAnalysisWorker.ts — durable analysis of engagement evidence.
 *
 * Claims `vendor_evidence_analysis` jobs from the generic `jobs` table (FOR
 * UPDATE SKIP LOCKED, same claim shape as vendorExtractionWorker) and, for one
 * evidence file per job: fetches the blob, extracts text, asks the model
 * whether the document supports the control it is attached to, and records the
 * verdict in `evidence_analysis` — a SUGGESTION for the reviewer, never a
 * score input.
 *
 * ── The ratified boundary ───────────────────────────────────────────────────
 * Nothing downstream reads these rows into a rating. The effectiveness ladder
 * moves only on the reviewer's confirmation. What analysis feeds is the
 * reviewer's attention (a 'contradicts' flag says "read this first") and the
 * engagement's `analysis_coverage` stamp, which `complete-analysis` computes
 * from how many evidence files actually got an analysis row.
 *
 * ── Failure vocabulary ──────────────────────────────────────────────────────
 * An unreadable DOCUMENT is not a failure: 'unreadable' is a legitimate,
 * deterministic verdict ("a human must read this") recorded without a model
 * call — image-only PDFs, spreadsheets, images. Real failures are the model
 * ones, classified exactly like the extraction worker: llm_invalid_json is
 * terminal; llm_unavailable / llm_failed retry with backoff and dead-letter at
 * max attempts.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * `evidence_analysis.evidence_id` is UNIQUE. Pre-check first (skip the model
 * call on a reclaim-after-commit); a 23505 during persist is the same
 * idempotent success.
 */

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState,
} from "../lib/dataRightsWorkerPolicy.js";
import { getObjectStream } from "../lib/blobStorage.js";
import { evidenceObjectKey } from "../lib/evidenceStorage.js";
import { extractPdfText } from "../lib/vendorAssurancePdfExtractor.js";
import {
  EVIDENCE_ANALYZER_MODEL_ID,
  runEvidenceAnalysis,
} from "../lib/claudeEvidenceAnalyzer.js";
import { vendorAssuranceEnabled } from "../lib/vendorAssuranceFeatureFlag.js";

export const EVIDENCE_ANALYSIS_JOB_TYPES = ["vendor_evidence_analysis"] as const;

type JobRow = {
  id: string;
  organization_id: string;
  requested_by_user_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

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

export async function claimNextAnalysisJob(workerId: string): Promise<JobRow | null> {
  const { rows } = await pgElevated.query(CLAIM_SQL, [
    workerId,
    [...EVIDENCE_ANALYSIS_JOB_TYPES],
    LOCK_TIMEOUT_MS,
  ]);
  return (rows[0] as JobRow | undefined) ?? null;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class RetryableAnalysisError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, detail: string) {
    super(detail);
    this.name = "RetryableAnalysisError";
    this.errorCode = errorCode;
  }
}

class TerminalAnalysisError extends NonRetryableJobError {
  readonly errorCode: string;
  constructor(errorCode: string, detail: string) {
    super(detail);
    this.name = "TerminalAnalysisError";
    this.errorCode = errorCode;
  }
}

type EvidenceRow = {
  id: string;
  engagement_id: string | null;
  requirement_id: string | null;
  mime_type: string | null;
  storage_key: string | null;
  detached_at: string | null;
  requirement_reference: string | null;
  requirement_title: string | null;
  vendor_notes: string | null;
};

async function recordJobSuccess(job: JobRow, result: Record<string, unknown>): Promise<void> {
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = 'succeeded', result = $2::jsonb,
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, JSON.stringify(result)]
    );
  });
}

async function recordJobFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt]
    );
  });
}

/** Persist one analysis row; a 23505 duplicate is an idempotent success. */
async function persistAnalysis(args: {
  organizationId: string;
  evidenceId: string;
  engagementId: string;
  requirementId: string | null;
  verdict: string;
  rationale: string;
  modelId: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO evidence_analysis
       (organization_id, evidence_id, engagement_id, requirement_id, verdict, rationale, model_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (evidence_id) DO NOTHING`,
    [
      args.organizationId,
      args.evidenceId,
      args.engagementId,
      args.requirementId,
      args.verdict,
      args.rationale,
      args.modelId,
    ]
  );
}

export type AnalysisDeps = {
  now?: () => Date;
  fetchBytes?: (orgId: string, evidenceId: string) => Promise<Buffer>;
  analyzeFn?: typeof runEvidenceAnalysis;
};

async function defaultFetchBytes(orgId: string, evidenceId: string): Promise<Buffer> {
  const obj = await getObjectStream({
    organizationId: orgId,
    key: evidenceObjectKey(orgId, evidenceId),
  });
  return streamToBuffer(obj.Body);
}

export async function processClaimedAnalysisJob(job: JobRow, deps: AnalysisDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const analyzeFn = deps.analyzeFn ?? runEvidenceAnalysis;
  const orgId = job.organization_id;

  const evidenceId = typeof job.payload?.["evidenceId"] === "string" ? (job.payload["evidenceId"] as string) : null;
  if (!evidenceId) {
    await recordJobFailure(job, new NonRetryableJobError("vendor_evidence_analysis job payload missing a string evidenceId"), now());
    return;
  }

  try {
    // Everything after the claim runs tenant-scoped: one job = one file = one org.
    const row = await withTenant(orgId, async () => {
      const res = await pg.query<EvidenceRow>(
        `SELECT e.id, e.engagement_id, e.requirement_id, e.mime_type, e.storage_key, e.detached_at,
                r.reference_id AS requirement_reference, r.title AS requirement_title,
                rr.notes AS vendor_notes
           FROM evidence e
           LEFT JOIN requirements r ON r.id = e.requirement_id
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = e.requirement_id
                 AND rr.engagement_id = e.engagement_id
                 AND rr.organization_id = e.organization_id
          WHERE e.id = $1 AND e.organization_id = $2
          LIMIT 1`,
        [evidenceId, orgId]
      );
      return res.rows[0] ?? null;
    });

    if (!row || !row.engagement_id) {
      throw new TerminalAnalysisError("evidence_missing", "Evidence row missing or not engagement-scoped");
    }
    if (row.detached_at) {
      // Withdrawn before analysis ran — nothing to analyse, and that is fine.
      await recordJobSuccess(job, { skipped: "detached" });
      return;
    }

    // Idempotent pre-check: reclaim-after-commit must not re-call the model.
    const existing = await withTenant(orgId, async () => {
      const res = await pg.query(`SELECT id FROM evidence_analysis WHERE evidence_id = $1`, [evidenceId]);
      return (res.rowCount ?? 0) > 0;
    });
    if (existing) {
      await recordJobSuccess(job, { idempotent: true });
      return;
    }

    // ── Deterministic path: types automated analysis cannot read. ───────────
    const mime = (row.mime_type ?? "").toLowerCase();
    let documentText: string | null = null;
    let unreadableReason: string | null = null;

    if (mime === "application/pdf") {
      const bytes = await fetchBytes(orgId, evidenceId);
      const extracted = await extractPdfText(bytes);
      if (extracted.ok) documentText = extracted.text;
      else unreadableReason = extracted.errorCode === "pdf_image_only"
        ? "The PDF contains no extractable text (likely scanned images)."
        : "The PDF could not be parsed.";
    } else if (mime.startsWith("text/")) {
      const bytes = await fetchBytes(orgId, evidenceId);
      documentText = bytes.toString("utf8");
    } else {
      unreadableReason = `Automated analysis does not read ${mime || "this file type"}.`;
    }

    if (unreadableReason !== null) {
      await withTenant(orgId, () =>
        persistAnalysis({
          organizationId: orgId,
          evidenceId,
          engagementId: row.engagement_id!,
          requirementId: row.requirement_id,
          verdict: "unreadable",
          rationale: `${unreadableReason} A reviewer must read this document manually.`,
          modelId: "deterministic",
        })
      );
      await recordJobSuccess(job, { verdict: "unreadable" });
      return;
    }

    // ── The model call — advisory output only. ──────────────────────────────
    const analysis = await analyzeFn({
      organizationId: orgId,
      requirementReference: row.requirement_reference ?? "(unattached)",
      requirementTitle: row.requirement_title ?? "General engagement evidence",
      vendorNotes: row.vendor_notes,
      documentText: documentText ?? "",
    });

    if (!analysis.ok) {
      if (analysis.errorCode === "llm_invalid_json") {
        throw new TerminalAnalysisError(analysis.errorCode, analysis.detail);
      }
      throw new RetryableAnalysisError(analysis.errorCode, analysis.detail);
    }

    await withTenant(orgId, () =>
      persistAnalysis({
        organizationId: orgId,
        evidenceId,
        engagementId: row.engagement_id!,
        requirementId: row.requirement_id,
        verdict: analysis.verdict,
        rationale: analysis.rationale,
        modelId: analysis.modelId,
      })
    );
    await recordJobSuccess(job, { verdict: analysis.verdict, model: EVIDENCE_ANALYZER_MODEL_ID });

    logger.info(
      { event: "evidence_analysis_complete", job_id: job.id, org_id: orgId, evidence_id: evidenceId, verdict: analysis.verdict },
      "Evidence analysis complete"
    );
  } catch (err) {
    await recordJobFailure(job, err, now());
    logger.error(
      { event: "evidence_analysis_job_failed", job_id: job.id, org_id: orgId, evidence_id: evidenceId, message: (err as Error)?.message },
      "Evidence-analysis job failed"
    );
  }
}

/** Drain all claimable analysis jobs; returns how many were processed. */
export async function runAnalysisTick(deps: AnalysisDeps & { shouldContinue?: () => boolean } = {}): Promise<number> {
  if (!vendorAssuranceEnabled()) return 0;
  const workerId = `evidence-analysis-${process.pid}`;
  let processed = 0;
  for (;;) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    const job = await claimNextAnalysisJob(workerId);
    if (!job) break;
    await processClaimedAnalysisJob(job, deps);
    processed += 1;
  }
  return processed;
}
