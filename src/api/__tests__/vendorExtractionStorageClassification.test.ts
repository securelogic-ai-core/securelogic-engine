/**
 * vendorExtractionStorageClassification.test.ts — SL-EVID-1.
 *
 * The extraction path fetches the PDF from object storage BEFORE it parses
 * anything. Both fetch sites (the in-process runner and the durable worker)
 * used to convert a failed fetch into `pdf_unparseable`, which is a statement
 * about a document nobody had read yet.
 *
 * These tests pin the two halves of the fix:
 *   - a fetch failure is recorded as a STORAGE fault, and the parser is never
 *     even invoked;
 *   - a genuine parser failure keeps its existing code, detail and terminal /
 *     retryable classification exactly as before.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy, writeAuditEventSpy, getPdfStreamSpy, extractPdfTextSpy, runSocExtractionSpy } =
  vi.hoisted(() => ({
    pgQuerySpy: vi.fn(),
    writeAuditEventSpy: vi.fn(),
    getPdfStreamSpy: vi.fn(),
    extractPdfTextSpy: vi.fn(),
    runSocExtractionSpy: vi.fn(),
  }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQuerySpy, connect: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: writeAuditEventSpy }));

vi.mock("../lib/vendorAssuranceStorage.js", () => ({
  getVendorAssurancePdfStream: (...a: unknown[]) => getPdfStreamSpy(...a),
}));

vi.mock("../lib/vendorAssurancePdfExtractor.js", () => ({
  extractPdfText: (...a: unknown[]) => extractPdfTextSpy(...a),
}));

vi.mock("../lib/claudeSocExtractor.js", () => ({
  runSocExtraction: (...a: unknown[]) => runSocExtractionSpy(...a),
  RAW_EXCERPT_BYTES: 4000,
}));

vi.mock("../lib/vendorAssuranceCuecMatcher.js", () => ({
  refreshCuecMappingsForDocument: vi.fn(),
}));

import { runExtraction } from "../lib/vendorAssuranceExtractionRunner.js";
import { BlobStorageNotConfiguredError } from "../lib/blobStorageConfig.js";
import {
  classifyExtractionError,
  TERMINAL_EXTRACTION_ERROR_CODES,
} from "../lib/vendorExtractionWorkerPolicy.js";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** The UPDATE that records a failure, with its bound parameters. */
function failureWrite(): { sql: string; code: string; detail: string } | null {
  const call = pgQuerySpy.mock.calls.find(
    (c) => typeof c[0] === "string" && /processing_status = 'extraction_failed'/.test(c[0] as string),
  );
  if (!call) return null;
  const params = call[1] as unknown[];
  return { sql: call[0] as string, code: String(params[2]), detail: String(params[3]) };
}

beforeEach(() => {
  pgQuerySpy.mockReset().mockResolvedValue({ rowCount: 1, rows: [] });
  writeAuditEventSpy.mockReset();
  getPdfStreamSpy.mockReset();
  extractPdfTextSpy.mockReset();
  runSocExtractionSpy.mockReset();
});

describe("runExtraction — a storage fetch failure is not a parse failure", () => {
  it("records storage_unavailable when storage is not configured, and never opens the parser", async () => {
    getPdfStreamSpy.mockRejectedValueOnce(new BlobStorageNotConfiguredError());

    await runExtraction({ documentId: DOC_ID, organizationId: ORG_ID, documentTypeHint: "soc2_type2" });

    const write = failureWrite();
    expect(write).not.toBeNull();
    expect(write!.code).toBe("storage_unavailable");
    expect(write!.code).not.toBe("pdf_unparseable");

    // The document was never read, so nothing may be asserted about its content.
    expect(extractPdfTextSpy).not.toHaveBeenCalled();
    expect(runSocExtractionSpy).not.toHaveBeenCalled();
  });

  it("records storage_error when storage is configured but the fetch is refused", async () => {
    getPdfStreamSpy.mockRejectedValueOnce(
      Object.assign(new Error("Access Denied"), { name: "AccessDenied" }),
    );

    await runExtraction({ documentId: DOC_ID, organizationId: ORG_ID, documentTypeHint: null });

    const write = failureWrite();
    expect(write!.code).toBe("storage_error");
    expect(extractPdfTextSpy).not.toHaveBeenCalled();
  });

  it("keeps infrastructure wording out of the persisted, customer-visible detail", async () => {
    getPdfStreamSpy.mockRejectedValueOnce(new BlobStorageNotConfiguredError());

    await runExtraction({ documentId: DOC_ID, organizationId: ORG_ID, documentTypeHint: null });

    const { detail } = failureWrite()!;
    expect(detail).not.toMatch(/R2_/);
    expect(detail).not.toMatch(/env var/i);
    expect(detail).not.toMatch(/blob/i);
    expect(detail.length).toBeGreaterThan(0);
  });
});

describe("runExtraction — genuine parser failures are unchanged", () => {
  it("still records pdf_unparseable when the PDF itself cannot be parsed", async () => {
    getPdfStreamSpy.mockResolvedValueOnce({ Body: [Buffer.from("%PDF-broken")] });
    extractPdfTextSpy.mockResolvedValueOnce({
      ok: false,
      errorCode: "pdf_unparseable",
      detail: "pdf-parse threw: bad xref",
    });

    await runExtraction({ documentId: DOC_ID, organizationId: ORG_ID, documentTypeHint: null });

    const write = failureWrite();
    expect(write!.code).toBe("pdf_unparseable");
    expect(write!.detail).toContain("bad xref");
    expect(extractPdfTextSpy).toHaveBeenCalledTimes(1);
  });

  it("still records pdf_image_only for a scanned document", async () => {
    getPdfStreamSpy.mockResolvedValueOnce({ Body: [Buffer.from("%PDF-scan")] });
    extractPdfTextSpy.mockResolvedValueOnce({
      ok: false,
      errorCode: "pdf_image_only",
      detail: "0 extractable characters",
    });

    await runExtraction({ documentId: DOC_ID, organizationId: ORG_ID, documentTypeHint: null });

    expect(failureWrite()!.code).toBe("pdf_image_only");
  });
});

describe("worker policy — storage faults are retryable, so an operator fix recovers the document", () => {
  it.each([["storage_unavailable"], ["storage_error"]] as const)(
    "classifies %s as retryable, not terminal",
    (code) => {
      const classified = classifyExtractionError(code, "storage");

      expect(TERMINAL_EXTRACTION_ERROR_CODES.has(code)).toBe(false);
      expect(classified.name).toBe("RetryableExtractionError");
      expect(classified.errorCode).toBe(code);
    },
  );

  it("leaves the two settled terminal content codes terminal", () => {
    expect(classifyExtractionError("pdf_image_only", "x").name).toBe("TerminalExtractionError");
    expect(classifyExtractionError("llm_invalid_json", "x").name).toBe("TerminalExtractionError");
  });
});
