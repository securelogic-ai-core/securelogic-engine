/**
 * vendorExtractionWorker.test.ts — integration test for the durable
 * vendor-assurance extraction worker (Pillar 1, build step 2) against a REAL
 * Postgres (the throwaway TEST_DATABASE_URL harness).
 *
 * It runs the REAL worker pipeline — the claim poll on the elevated channel,
 * then `processClaimedJob` inside `withTenant(job.organization_id)`, with the
 * EXISTING `persistExtractionAndMarkExtracted` / `markExtracting` / `markFailed`
 * steps unchanged. The only injected seams are the three external-IO steps:
 * PDF fetch (R2), PDF text extraction (pdf-parse) and SOC extraction (Claude) —
 * so no network and no Claude credits are touched, exactly like the data-rights
 * worker test injects a Buffer sink in place of R2.
 *
 * What it proves:
 *   (a) claim — a queued job is atomically claimed (status→processing, locked).
 *   (b) success — a happy-path run drives the document to `extracted`, the job
 *       to `succeeded` with a result, and persists exactly one extraction row.
 *   (§B.7) IDEMPOTENCY — the load-bearing requirement: running processClaimedJob
 *       TWICE against the same document (simulating a reclaim after a committed
 *       persist) ends `succeeded` with EXACTLY ONE extraction row — no
 *       unique-violation, no failed/dead_lettered, and Claude is NOT re-called.
 *   (c) requeue — a TRANSIENT fault requeues with backoff (document left
 *       `extracting`), attempts < max.
 *   (d) terminal failed — `pdf_image_only` and `llm_invalid_json` go straight to
 *       `failed` (no retry) and mark the document `extraction_failed` with the
 *       typed code (and, for invalid-JSON, the raw excerpt).
 *   (e) dead-letter — a transient fault on the final attempt → `dead_lettered`.
 *
 * setup.ts points DATABASE_URL at TEST_DATABASE_URL before this module imports,
 * so infra/postgres boots against the throwaway DB; pgElevated falls back to
 * DATABASE_URL, so the claim poll and the withTenant bodies hit the same DB.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import {
  claimNextJob,
  processClaimedJob,
  runOneTick,
  type JobRow,
  type WorkerDeps,
} from "../../src/api/workers/vendorExtractionWorker.js";
import type { SocExtractionResult } from "../../src/api/lib/claudeSocExtractor.js";
import type { PdfExtractionResult } from "../../src/api/lib/vendorAssurancePdfExtractor.js";

let seed: TestDbSeed;
let pool: Pool;
let vendorId: string;

/** A valid SOC extraction result with no spans (keeps the persist a single row). */
function fakeSocSuccess(): Extract<SocExtractionResult, { ok: true }> {
  return {
    ok: true,
    fields: {
      service_organization_name: { value: "Acme Cloud", confidence: 1, status: "extracted" },
    },
    spans: [],
    rawExcerpt: "fake-model-response",
    modelId: "claude-sonnet-4-6-test",
    promptVersion: "soc-extraction-v2-test",
  } as Extract<SocExtractionResult, { ok: true }>;
}

/** Happy-path injected seams: fetch a stub PDF, parse it, extract it — no IO. */
function happyDeps(over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    workerId: "test-vendor-worker",
    fetchPdf: async () => Buffer.from("%PDF-1.4 stub bytes"),
    extractPdfTextFn: async (): Promise<PdfExtractionResult> => ({
      ok: true,
      text: "x".repeat(800),
      pageCount: 12,
    }),
    runSocExtractionFn: async () => fakeSocSuccess(),
    refreshCuecFn: async () => ({ promoted: 0, matched: 0 }),
    ...over,
  };
}

async function seedDocument(orgId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key,
        mime_type, document_type_hint, processing_status)
     VALUES ($1, $2, 'soc2-report.pdf', 524288, $3, $4, 'application/pdf', 'soc2_type2', 'pending')
     RETURNING id`,
    [orgId, vendorId, "ab".repeat(32), `org/${orgId}/vendor-assurance/seed/original.pdf`],
  );
  return rows[0].id;
}

async function enqueueJob(
  orgId: string,
  documentId: string,
  opts: { attempts?: number; maxAttempts?: number } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload, attempts, max_attempts)
     VALUES ($1, NULL, 'vendor_assurance_extract', $2::jsonb, $3, $4)
     RETURNING id`,
    [
      orgId,
      JSON.stringify({ documentId, documentTypeHint: "soc2_type2" }),
      opts.attempts ?? 0,
      opts.maxAttempts ?? 5,
    ],
  );
  return rows[0].id;
}

async function getJob(jobId: string) {
  const { rows } = await pool.query(
    `SELECT status, attempts, max_attempts, error, result, next_attempt_at,
            scheduled_for, locked_by, locked_at, completed_at
       FROM jobs WHERE id = $1`,
    [jobId],
  );
  return rows[0];
}

async function getDocument(documentId: string) {
  const { rows } = await pool.query(
    `SELECT processing_status, processing_error_code, processing_error_detail, raw_response_excerpt
       FROM vendor_assurance_documents WHERE id = $1`,
    [documentId],
  );
  return rows[0];
}

async function countExtractions(documentId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM vendor_assurance_extractions WHERE document_id = $1",
    [documentId],
  );
  return Number(rows[0].n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor-extraction worker test.");
  pool = new Pool({ connectionString: url, ssl: false });

  vendorId = await seedVendor(pool, seed.orgA.id, { name: "Vendor Under Assurance" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("vendor-extraction worker — durable claim/process against real Postgres", () => {
  it("(a) atomically claims a queued job (status→processing, locked, attempts++)", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    const claimed = await claimNextJob("claim-test-worker");
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.organization_id).toBe(seed.orgA.id);
    expect((claimed!.payload as { documentId?: string }).documentId).toBe(documentId);

    const row = await getJob(jobId);
    expect(row.status).toBe("processing");
    expect(row.attempts).toBe(1);
    expect(row.locked_by).toBe("claim-test-worker");
    expect(row.locked_at).not.toBeNull();

    // Drain it so it doesn't leak into the next test's runOneTick.
    await processClaimedJob(claimed!, happyDeps());
  });

  it("(b) happy path → document 'extracted', job 'succeeded', exactly one extraction row", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    const processed = await runOneTick(happyDeps());
    expect(processed).toBeGreaterThanOrEqual(1);

    const row = await getJob(jobId);
    expect(row.status).toBe("succeeded");
    expect(row.error).toBeNull();
    expect(row.completed_at).not.toBeNull();
    expect(row.locked_by).toBeNull();
    expect(row.result).toMatchObject({ document_id: documentId });
    expect(typeof row.result.extraction_id).toBe("string");

    expect((await getDocument(documentId)).processing_status).toBe("extracted");
    expect(await countExtractions(documentId)).toBe(1);
  });

  // ── THE REQUIRED §B.7 IDEMPOTENCY TEST ─────────────────────────────────────
  it("(§B.7) reclaim-after-commit re-runs idempotently: 'succeeded', exactly ONE extraction row, no Claude re-call", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    // Spy seams so we can prove run 2 does NOT re-fetch / re-parse / re-call Claude.
    const fetchPdf = vi.fn(async () => Buffer.from("%PDF-1.4 stub bytes"));
    const extractPdfTextFn = vi.fn(
      async (): Promise<PdfExtractionResult> => ({ ok: true, text: "x".repeat(800), pageCount: 12 }),
    );
    const runSocExtractionFn = vi.fn(async () => fakeSocSuccess());
    const deps = happyDeps({ fetchPdf, extractPdfTextFn, runSocExtractionFn });

    // Run 1 — a normal claim + full extraction that COMMITS the persist row.
    const job1 = await claimNextJob("idem-worker-1");
    expect(job1).not.toBeNull();
    expect(job1!.id).toBe(jobId);
    await processClaimedJob(job1!, deps);

    expect(await getJob(jobId).then((r) => r.status)).toBe("succeeded");
    expect(await countExtractions(documentId)).toBe(1);
    expect(runSocExtractionFn).toHaveBeenCalledTimes(1);

    // Simulate the dangerous window: the worker COMMITTED the persist but
    // crashed before/while marking the job succeeded, so the job is left
    // 'processing' with a stale lock. The visibility-timeout arm of the claim
    // then RECLAIMS it — exactly the path that would hit the UNIQUE constraint
    // on a naive re-INSERT.
    await pool.query(
      `UPDATE jobs
          SET status = 'processing', completed_at = NULL, result = NULL,
              locked_by = 'dead-worker', locked_at = now() - interval '30 minutes'
        WHERE id = $1`,
      [jobId],
    );

    const job2 = await claimNextJob("idem-worker-2");
    expect(job2, "stale 'processing' job is reclaimed via the visibility timeout").not.toBeNull();
    expect(job2!.id).toBe(jobId);

    // Run 2 — the reclaim. It MUST finish as an idempotent success.
    await processClaimedJob(job2!, deps);

    const row = await getJob(jobId);
    expect(row.status).toBe("succeeded");
    expect(row.status).not.toBe("failed");
    expect(row.status).not.toBe("dead_lettered");
    expect(row.error).toBeNull();
    expect(row.result).toMatchObject({ document_id: documentId });

    // The load-bearing assertion: STILL exactly one extraction row.
    expect(await countExtractions(documentId)).toBe(1);
    expect((await getDocument(documentId)).processing_status).toBe("extracted");

    // Run 2 short-circuited on the pre-check: no re-fetch, no re-parse, and
    // crucially NO second Claude call (no wasted credits).
    expect(fetchPdf).toHaveBeenCalledTimes(1);
    expect(extractPdfTextFn).toHaveBeenCalledTimes(1);
    expect(runSocExtractionFn).toHaveBeenCalledTimes(1);
  });

  it("(c) a TRANSIENT fault (llm_unavailable) requeues with backoff; document stays 'extracting'", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    const processed = await runOneTick(
      happyDeps({
        runSocExtractionFn: async (): Promise<SocExtractionResult> => ({
          ok: false,
          errorCode: "llm_unavailable",
          detail: "ANTHROPIC_API_KEY not set",
        }),
      }),
    );
    expect(processed).toBeGreaterThanOrEqual(1);

    const row = await getJob(jobId);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.attempts).toBeLessThan(row.max_attempts);
    expect(row.next_attempt_at).not.toBeNull();
    expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now());
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();

    // Requeued — work is still owed — so the document is left 'extracting'
    // (NOT flipped to extraction_failed), and no extraction row was written.
    expect((await getDocument(documentId)).processing_status).toBe("extracting");
    expect(await countExtractions(documentId)).toBe(0);
  });

  it("(d1) pdf_image_only → terminal 'failed' (no retry), document 'extraction_failed' with the typed code", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    await runOneTick(
      happyDeps({
        extractPdfTextFn: async (): Promise<PdfExtractionResult> => ({
          ok: false,
          errorCode: "pdf_image_only",
          detail: "extracted only 12 chars (threshold 200)",
        }),
      }),
    );

    const row = await getJob(jobId);
    expect(row.status).toBe("failed");
    expect(row.next_attempt_at).toBeNull();

    const doc = await getDocument(documentId);
    expect(doc.processing_status).toBe("extraction_failed");
    expect(doc.processing_error_code).toBe("pdf_image_only");
    expect(await countExtractions(documentId)).toBe(0);
  });

  it("(d2) llm_invalid_json → terminal 'failed', document carries the typed code and the raw excerpt", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    const jobId = await enqueueJob(seed.orgA.id, documentId);

    await runOneTick(
      happyDeps({
        runSocExtractionFn: async (): Promise<SocExtractionResult> => ({
          ok: false,
          errorCode: "llm_invalid_json",
          detail: "validator rejected: missing material field",
          rawExcerpt: "<<the raw non-conforming model response>>",
        }),
      }),
    );

    const row = await getJob(jobId);
    expect(row.status).toBe("failed");
    expect(row.next_attempt_at).toBeNull();

    const doc = await getDocument(documentId);
    expect(doc.processing_status).toBe("extraction_failed");
    expect(doc.processing_error_code).toBe("llm_invalid_json");
    expect(doc.raw_response_excerpt).toContain("raw non-conforming model response");
    expect(await countExtractions(documentId)).toBe(0);
  });

  it("(e) a TRANSIENT fault on the final attempt → 'dead_lettered'", async () => {
    const documentId = await seedDocument(seed.orgA.id);
    // attempts=4 so the claim bumps it to max (5) and decideFailureState
    // routes the transient failure to the terminal dead-letter state.
    const jobId = await enqueueJob(seed.orgA.id, documentId, { attempts: 4, maxAttempts: 5 });

    await runOneTick(
      happyDeps({
        runSocExtractionFn: async (): Promise<SocExtractionResult> => ({
          ok: false,
          errorCode: "llm_failed",
          detail: "anthropic 503",
        }),
      }),
    );

    const row = await getJob(jobId);
    expect(row.status).toBe("dead_lettered");
    expect(row.attempts).toBe(5);
    expect(row.next_attempt_at).toBeNull();
    expect(row.locked_by).toBeNull();

    // Terminal (dead-letter) → document marked extraction_failed with the typed code.
    const doc = await getDocument(documentId);
    expect(doc.processing_status).toBe("extraction_failed");
    expect(doc.processing_error_code).toBe("llm_failed");
  });
});
