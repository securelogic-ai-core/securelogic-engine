/**
 * vendorExtractionWorkerPolicy.ts — DB-free policy for the durable
 * vendor-assurance extraction worker (Pillar 1, build step 2).
 *
 * Mirrors `dataRightsWorkerPolicy.ts`: it carries NO import of infra/postgres
 * (which throws at module-eval when DATABASE_URL is unset) so the retry/backoff
 * decision and the failure-classification surface are unit-testable without a
 * database. The DB-touching executor (claim / process / record) lives in
 * `src/api/workers/vendorExtractionWorker.ts` and re-exports this surface.
 *
 * The retry/backoff/dead-letter machinery is REUSED WHOLESALE from the
 * data-rights worker (spec §B.3 — "directly reusable"): `LOCK_TIMEOUT_MS`,
 * `MAX_BACKOFF_MS`, `backoffMs`, `decideFailureState` and `NonRetryableJobError`
 * are imported from `dataRightsWorkerPolicy.ts` and re-exported here so the
 * worker imports one policy module. Only the job-type filter and the
 * vendor-specific failure classification are new.
 */

import {
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  backoffMs,
  decideFailureState,
} from "./dataRightsWorkerPolicy.js";

// Re-export the shared retry/backoff surface so the worker imports everything
// vendor-policy-related from here (parallels dataRightsWorker.ts's re-export).
export {
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  backoffMs,
  decideFailureState,
};

/** The job type this worker claims. Reuses the generic `jobs` table (spec §F.2). */
export const VENDOR_EXTRACTION_JOB_TYPES = ["vendor_assurance_extract"] as const;

/**
 * The typed `processing_error_code` values the existing extraction steps
 * produce. Kept here (not just inline) so the failure classification is a single
 * source of truth shared with the document-failure write.
 */
export type VendorExtractionErrorCode =
  | "pdf_unparseable"
  | "pdf_image_only"
  | "llm_unavailable"
  | "llm_invalid_json"
  | "llm_failed";

/**
 * TERMINAL input faults (settled, spec §F.5): `pdf_image_only` and
 * `llm_invalid_json` are permanent — re-running cannot help (an image-only PDF
 * needs OCR we do not do; an invalid-JSON model response will not become valid
 * on retry, and retrying only burns attempts + Claude credits). These go
 * straight to `failed` and are surfaced to the user. EVERY OTHER code
 * (`pdf_unparseable`, `llm_unavailable`, `llm_failed`) is treated as transient
 * and is retried with backoff, landing in `dead_lettered` at max attempts — the
 * spec enumerates exactly these two terminal codes and nothing else.
 */
export const TERMINAL_EXTRACTION_ERROR_CODES: ReadonlySet<VendorExtractionErrorCode> =
  new Set(["pdf_image_only", "llm_invalid_json"]);

/**
 * A transient extraction fault — requeued with backoff, dead-lettered at max
 * attempts. Carries the typed `errorCode` (and, for the invalid-JSON paths, the
 * `rawExcerpt`) so the worker can write the document's `extraction_failed` row
 * with the same vocabulary the in-process runner used — the existing UI failure
 * surface is unchanged (spec §B.3).
 */
export class RetryableExtractionError extends Error {
  readonly errorCode: VendorExtractionErrorCode;
  readonly rawExcerpt: string | null;
  constructor(errorCode: VendorExtractionErrorCode, detail: string, rawExcerpt?: string | null) {
    super(detail);
    this.name = "RetryableExtractionError";
    this.errorCode = errorCode;
    this.rawExcerpt = rawExcerpt ?? null;
  }
}

/**
 * A terminal extraction fault. Extends `NonRetryableJobError` so the REUSED
 * `decideFailureState` routes it straight to `failed` (no retry) with zero
 * vendor-specific branching in the policy.
 */
export class TerminalExtractionError extends NonRetryableJobError {
  readonly errorCode: VendorExtractionErrorCode;
  readonly rawExcerpt: string | null;
  constructor(errorCode: VendorExtractionErrorCode, detail: string, rawExcerpt?: string | null) {
    super(detail);
    this.name = "TerminalExtractionError";
    this.errorCode = errorCode;
    this.rawExcerpt = rawExcerpt ?? null;
  }
}

/**
 * Map a typed extraction error code (from `extractPdfText` / `runSocExtraction`)
 * to the right job-policy error: terminal for the two settled permanent codes,
 * retryable for everything else.
 */
export function classifyExtractionError(
  errorCode: VendorExtractionErrorCode,
  detail: string,
  rawExcerpt?: string | null,
): RetryableExtractionError | TerminalExtractionError {
  if (TERMINAL_EXTRACTION_ERROR_CODES.has(errorCode)) {
    return new TerminalExtractionError(errorCode, detail, rawExcerpt);
  }
  return new RetryableExtractionError(errorCode, detail, rawExcerpt);
}
