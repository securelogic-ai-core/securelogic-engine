/**
 * vendorExtractionWorkerPolicy.test.ts — DB-free unit tests for the durable
 * vendor-assurance extraction worker's policy surface (Pillar 1, build step 2).
 *
 * Two things are proven here without a database:
 *  1. The scope/constant reuse — the worker claims ONLY the
 *     `vendor_assurance_extract` job type and reuses the data-rights
 *     visibility-timeout / backoff machinery verbatim.
 *  2. The settled failure semantics (spec §F.5): `pdf_image_only` and
 *     `llm_invalid_json` classify TERMINAL (→ `failed`, no retry); every other
 *     typed extraction code classifies TRANSIENT (→ `queued` with backoff, then
 *     `dead_lettered` at max attempts). This is the load-bearing routing the
 *     DB-backed worker test then exercises end-to-end.
 */

import { describe, expect, it } from "vitest";

import {
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  RetryableExtractionError,
  TERMINAL_EXTRACTION_ERROR_CODES,
  TerminalExtractionError,
  VENDOR_EXTRACTION_JOB_TYPES,
  backoffMs,
  classifyExtractionError,
  decideFailureState,
} from "../vendorExtractionWorkerPolicy.js";

describe("vendor-extraction worker — scope constants", () => {
  it("claims only the vendor_assurance_extract job type", () => {
    expect([...VENDOR_EXTRACTION_JOB_TYPES]).toEqual(["vendor_assurance_extract"]);
    // It must not claim any of the data-rights worker's types.
    expect([...VENDOR_EXTRACTION_JOB_TYPES]).not.toContain("data_export_self");
    expect([...VENDOR_EXTRACTION_JOB_TYPES]).not.toContain("data_export_org");
    expect([...VENDOR_EXTRACTION_JOB_TYPES]).not.toContain("account_deletion_reap");
  });

  it("reuses the data-rights visibility timeout (15m) and backoff cap (60m)", () => {
    expect(LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(MAX_BACKOFF_MS).toBe(60 * 60 * 1000);
  });

  it("reuses the exponential backoff schedule verbatim", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(100)).toBe(MAX_BACKOFF_MS);
  });
});

describe("vendor-extraction worker — failure classification (spec §F.5)", () => {
  it("treats EXACTLY pdf_image_only and llm_invalid_json as terminal", () => {
    expect([...TERMINAL_EXTRACTION_ERROR_CODES].sort()).toEqual([
      "llm_invalid_json",
      "pdf_image_only",
    ]);
  });

  it("classifies pdf_image_only as a TERMINAL (non-retryable) error", () => {
    const err = classifyExtractionError("pdf_image_only", "only 12 chars");
    expect(err).toBeInstanceOf(TerminalExtractionError);
    // It extends NonRetryableJobError so the reused decideFailureState routes it.
    expect(err).toBeInstanceOf(NonRetryableJobError);
    expect(err.errorCode).toBe("pdf_image_only");
  });

  it("classifies llm_invalid_json as TERMINAL and carries the raw excerpt", () => {
    const err = classifyExtractionError("llm_invalid_json", "JSON.parse failed", "<<raw model text>>");
    expect(err).toBeInstanceOf(TerminalExtractionError);
    expect(err).toBeInstanceOf(NonRetryableJobError);
    expect(err.errorCode).toBe("llm_invalid_json");
    expect(err.rawExcerpt).toBe("<<raw model text>>");
  });

  it.each(["pdf_unparseable", "llm_unavailable", "llm_failed"] as const)(
    "classifies %s as a TRANSIENT (retryable) error, NOT non-retryable",
    (code) => {
      const err = classifyExtractionError(code, "transient blip");
      expect(err).toBeInstanceOf(RetryableExtractionError);
      expect(err).not.toBeInstanceOf(NonRetryableJobError);
      expect(err.errorCode).toBe(code);
    },
  );
});

describe("vendor-extraction worker — decideFailureState routing", () => {
  const now = new Date("2026-06-20T00:00:00.000Z");

  it("routes a TERMINAL extraction error straight to 'failed' (no retry)", () => {
    const err = classifyExtractionError("pdf_image_only", "image only");
    const d = decideFailureState({ attempts: 1, max_attempts: 5 }, err, now);
    expect(d.status).toBe("failed");
    expect(d.nextAttemptAt).toBeNull();
  });

  it("requeues a TRANSIENT extraction error with backoff while attempts remain", () => {
    const err = classifyExtractionError("llm_unavailable", "key absent");
    const d = decideFailureState({ attempts: 2, max_attempts: 5 }, err, now);
    expect(d.status).toBe("queued");
    expect(d.nextAttemptAt?.toISOString()).toBe("2026-06-20T00:02:00.000Z");
  });

  it("dead-letters a TRANSIENT extraction error once attempts reach max", () => {
    const err = classifyExtractionError("llm_failed", "anthropic 500");
    const d = decideFailureState({ attempts: 5, max_attempts: 5 }, err, now);
    expect(d.status).toBe("dead_lettered");
    expect(d.nextAttemptAt).toBeNull();
  });
});
