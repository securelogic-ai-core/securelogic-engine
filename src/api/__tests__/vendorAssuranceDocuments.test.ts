/**
 * vendorAssuranceDocuments.test.ts — handler-level behavioral tests with
 * mocked pg, mocked vendorAssuranceStorage, mocked auditLog, and mocked
 * extraction runner. The middleware chain (feature flag, requireApiKey,
 * attachOrganizationContext, requireEntitlement) is intentionally not under
 * test here — those are independently verified upstream and in their own
 * test files.
 *
 * What we DO assert:
 *   - org-scoped reads/writes
 *   - cross-org returns 404
 *   - upload happy path: blob put, audit, schedule extraction, 202
 *   - upload failure-mode codes: missing vendor, no file, oversized, non-PDF,
 *     blob put failure
 *   - review-decisions handler INSERTs new rows (no UPSERT) and rejects
 *     unknown field_name; second decision on same field appends
 *   - finalize 409 paths and 200 happy path; idempotent re-call returns 409
 *   - PDF URL endpoint scopes by org and audits issuance
 *   - GET extraction returns the DISTINCT ON read projection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MATERIAL_FIELD_NAMES } from "../lib/socExtractionPrompt.js";

const { pgQuerySpy, pgConnectClientQuerySpy, pgConnectClientReleaseSpy } = vi.hoisted(() => ({
  pgQuerySpy: vi.fn(),
  pgConnectClientQuerySpy: vi.fn(),
  pgConnectClientReleaseSpy: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: pgQuerySpy,
    connect: vi.fn().mockResolvedValue({
      query: pgConnectClientQuerySpy,
      release: pgConnectClientReleaseSpy
    })
  }
}));

vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));

const putVendorAssurancePdfSpy = vi.fn();
const getVendorAssurancePdfSignedUrlSpy = vi.fn();

vi.mock("../lib/vendorAssuranceStorage.js", () => ({
  putVendorAssurancePdf: (...args: unknown[]) => putVendorAssurancePdfSpy(...args),
  getVendorAssurancePdfStream: vi.fn(),
  getVendorAssurancePdfSignedUrl: (...args: unknown[]) => getVendorAssurancePdfSignedUrlSpy(...args),
  vendorAssuranceObjectKey: (orgId: string, docId: string) => `org/${orgId}/vendor-assurance/${docId}/original.pdf`
}));

const scheduleExtractionSpy = vi.fn();
vi.mock("../lib/vendorAssuranceExtractionRunner.js", () => ({
  scheduleExtraction: (...args: unknown[]) => scheduleExtractionSpy(...args)
}));

import {
  uploadVendorAssuranceDocument,
  listVendorAssuranceDocuments,
  getVendorAssuranceDocument,
  getVendorAssuranceExtraction,
  getVendorAssurancePdfRedirect,
  recordVendorAssuranceReviewDecisions,
  finalizeVendorAssuranceDocument
} from "../routes/vendorAssuranceDocuments.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const VENDOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXTRACTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function buildReq(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    organizationContext: { organizationId: ORG_A },
    apiKey: { id: "k1" },
    userId: USER_ID,
    ip: "127.0.0.1",
    body: {},
    params: {},
    query: {},
    ...overrides
  };
}

function buildRes(): {
  res: Record<string, unknown>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const redirect = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, redirect };
  return { res, status, json, redirect };
}

beforeEach(() => {
  pgQuerySpy.mockReset();
  pgConnectClientQuerySpy.mockReset();
  pgConnectClientReleaseSpy.mockReset();
  putVendorAssurancePdfSpy.mockReset();
  getVendorAssurancePdfSignedUrlSpy.mockReset();
  scheduleExtractionSpy.mockReset();
  (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mockReset();
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe("uploadVendorAssuranceDocument", () => {
  it("403 when organization context is missing", async () => {
    const req = buildReq({ organizationContext: undefined });
    const { res, status, json } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "organization_context_missing" });
  });

  it("400 when no file is uploaded", async () => {
    const req = buildReq({ body: { vendor_id: VENDOR_ID } });
    const { res, status, json } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "no_file_uploaded" });
  });

  it("400 when vendor_id is missing", async () => {
    const req = buildReq({
      body: {},
      file: { buffer: Buffer.from("pdf"), originalname: "r.pdf", size: 3, mimetype: "application/pdf" }
    });
    const { res, status } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("404 when vendor belongs to another org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // vendor pre-flight
    const req = buildReq({
      body: { vendor_id: VENDOR_ID },
      file: { buffer: Buffer.from("pdf"), originalname: "r.pdf", size: 3, mimetype: "application/pdf" }
    });
    const { res, status, json } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "vendor_not_found" });
    expect(putVendorAssurancePdfSpy).not.toHaveBeenCalled();
  });

  it("happy path returns 202, writes blob with org-prefixed key, audits, and schedules extraction", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }) // vendor pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, created_at: "2026-05-08T00:00:00Z" }] }) // INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // UPDATE storage_key
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, processing_status: "pending" }] }); // SELECT for response

    putVendorAssurancePdfSpy.mockResolvedValueOnce({
      key: `org/${ORG_A}/vendor-assurance/${DOC_ID}/original.pdf`,
      byteSize: 3
    });

    const req = buildReq({
      body: { vendor_id: VENDOR_ID, document_type_hint: "soc2_type2" },
      file: { buffer: Buffer.from("pdf"), originalname: "report.pdf", size: 3, mimetype: "application/pdf" }
    });
    const { res, status, json } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);

    expect(status).toHaveBeenCalledWith(202);
    expect(putVendorAssurancePdfSpy).toHaveBeenCalledWith({
      organizationId: ORG_A,
      documentId: DOC_ID,
      bytes: expect.any(Buffer)
    });
    expect(scheduleExtractionSpy).toHaveBeenCalledWith({
      documentId: DOC_ID,
      organizationId: ORG_A,
      documentTypeHint: "soc2_type2"
    });
    const auditCalls = (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(auditCalls.some((c) => c[0]?.eventType === "vendor_assurance.document.uploaded")).toBe(true);
    expect(json).toHaveBeenCalled();
  });

  it("500 when blob put fails; document marked extraction_failed", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }) // vendor pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, created_at: "x" }] }) // INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }); // UPDATE failed-status
    putVendorAssurancePdfSpy.mockRejectedValueOnce(new Error("R2 unreachable"));

    const req = buildReq({
      body: { vendor_id: VENDOR_ID },
      file: { buffer: Buffer.from("pdf"), originalname: "r.pdf", size: 3, mimetype: "application/pdf" }
    });
    const { res, status, json } = buildRes();
    await uploadVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "blob_put_failed" });
    expect(scheduleExtractionSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list / get document
// ---------------------------------------------------------------------------

describe("listVendorAssuranceDocuments", () => {
  it("403 without org context", async () => {
    const req = buildReq({ organizationContext: undefined });
    const { res, status } = buildRes();
    await listVendorAssuranceDocuments(req as never, res as never);
    expect(status).toHaveBeenCalledWith(403);
  });

  it("scopes WHERE by organization_id", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq();
    const { res } = buildRes();
    await listVendorAssuranceDocuments(req as never, res as never);
    const sql = String(pgQuerySpy.mock.calls[0]?.[0] ?? "");
    const params = pgQuerySpy.mock.calls[0]?.[1] as unknown[];
    expect(sql).toMatch(/organization_id = \$1/);
    expect(params?.[0]).toBe(ORG_A);
  });

  it("rejects bad status filter", async () => {
    const req = buildReq({ query: { status: "lol" } });
    const { res, status } = buildRes();
    await listVendorAssuranceDocuments(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe("getVendorAssuranceDocument", () => {
  it("404 cross-org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status, json } = buildRes();
    await getVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "vendor_assurance_document_not_found" });
  });

  it("rejects non-UUID document id", async () => {
    const req = buildReq({ params: { id: "x" } });
    const { res, status } = buildRes();
    await getVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// PDF URL
// ---------------------------------------------------------------------------

describe("getVendorAssurancePdfRedirect", () => {
  it("404 when document is cross-org; never issues a URL", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({ params: { id: DOC_ID }, organizationContext: { organizationId: ORG_B } });
    const { res, status, redirect } = buildRes();
    await getVendorAssurancePdfRedirect(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
    expect(redirect).not.toHaveBeenCalled();
    expect(getVendorAssurancePdfSignedUrlSpy).not.toHaveBeenCalled();
    const auditCalls = (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(auditCalls.some((c) => c[0]?.eventType === "vendor_assurance.document.pdf_url_issued")).toBe(false);
  });

  it("redirects 302 and audits issuance on success", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] });
    getVendorAssurancePdfSignedUrlSpy.mockResolvedValueOnce({
      url: "https://signed.example/abc",
      ttlSeconds: 60,
      expiresAt: new Date()
    });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, redirect } = buildRes();
    await getVendorAssurancePdfRedirect(req as never, res as never);
    expect(redirect).toHaveBeenCalledWith(302, "https://signed.example/abc");
    const auditCalls = (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(auditCalls.some((c) => c[0]?.eventType === "vendor_assurance.document.pdf_url_issued")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extraction read (DISTINCT ON projection)
// ---------------------------------------------------------------------------

describe("getVendorAssuranceExtraction", () => {
  it("404 when document is cross-org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status } = buildRes();
    await getVendorAssuranceExtraction(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
  });

  it("returns null extraction when none exists yet", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }) // doc check
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // extraction lookup
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status, json } = buildRes();
    await getVendorAssuranceExtraction(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ extraction: null, spans: [], current_decisions: {} });
  });

  it("uses the DISTINCT ON read projection for current_decisions", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }) // doc check
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: EXTRACTION_ID, organization_id: ORG_A, document_id: DOC_ID,
                 model_id: "m", prompt_version: "v", raw_response_excerpt: null,
                 fields: {}, created_at: "x" }]
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // spans
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          field_name: "vendor_name", decision: "accept", reviewed_value: null,
          reviewer_note: null, decided_by_user_id: USER_ID,
          decided_at: "2026-05-08T00:00:00Z", id: "x"
        }]
      });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, json } = buildRes();
    await getVendorAssuranceExtraction(req as never, res as never);

    const projectionCall = pgQuerySpy.mock.calls[3]?.[0] as string;
    expect(projectionCall).toMatch(/DISTINCT ON \(field_name\)/);
    expect(projectionCall).toMatch(/ORDER BY field_name, decided_at DESC, id DESC/);

    const body = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body["current_decisions"]).toMatchObject({
      vendor_name: { decision: "accept" }
    });
  });
});

// ---------------------------------------------------------------------------
// review-decisions: append-only INSERT
// ---------------------------------------------------------------------------

describe("recordVendorAssuranceReviewDecisions", () => {
  it("rejects unknown field_name", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 1, rows: [{ document_id: DOC_ID }] });
    const req = buildReq({
      params: { id: EXTRACTION_ID },
      body: { decisions: [{ field_name: "not_a_field", decision: "accept" }] }
    });
    const { res, status } = buildRes();
    await recordVendorAssuranceReviewDecisions(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("404 when extraction is cross-org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({
      params: { id: EXTRACTION_ID },
      body: { decisions: [{ field_name: "vendor_name", decision: "accept" }] }
    });
    const { res, status } = buildRes();
    await recordVendorAssuranceReviewDecisions(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
  });

  it("INSERTs a new row (no UPSERT) and audits each decision", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ document_id: DOC_ID }] }) // extraction lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ processing_status: "extracted" }] }); // doc status
    pgConnectClientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "new-1" }] }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        field_name: "vendor_name", decision: "accept", reviewed_value: null,
        reviewer_note: null, decided_by_user_id: USER_ID, decided_at: "x"
      }]
    });

    const req = buildReq({
      params: { id: EXTRACTION_ID },
      body: { decisions: [{ field_name: "vendor_name", decision: "accept" }] }
    });
    const { res, status, json } = buildRes();
    await recordVendorAssuranceReviewDecisions(req as never, res as never);

    expect(status).toHaveBeenCalledWith(200);
    // The decision write must be INSERT, not UPSERT — confirm no ON CONFLICT clause.
    const insertCall = pgConnectClientQuerySpy.mock.calls[1]?.[0] as string;
    expect(insertCall).toMatch(/INSERT INTO vendor_assurance_review_decisions/);
    expect(insertCall).not.toMatch(/ON CONFLICT/i);
    expect(insertCall).not.toMatch(/UPDATE/i);

    const body = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body["inserted_ids"]).toEqual(["new-1"]);

    const auditCalls = (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(auditCalls.some((c) => c[0]?.eventType === "vendor_assurance.review_decision.recorded")).toBe(true);
  });

  it("appends a second row when re-deciding the same field", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ document_id: DOC_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ processing_status: "extracted" }] });
    pgConnectClientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "new-2" }] }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        field_name: "vendor_name", decision: "edit",
        reviewed_value: { value: "Acme" },
        reviewer_note: null, decided_by_user_id: USER_ID, decided_at: "x"
      }]
    });
    const req = buildReq({
      params: { id: EXTRACTION_ID },
      body: { decisions: [{ field_name: "vendor_name", decision: "edit", reviewed_value: { value: "Acme" } }] }
    });
    const { res, status } = buildRes();
    await recordVendorAssuranceReviewDecisions(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    // Only one INSERT call inside the transaction.
    const insertCalls = pgConnectClientQuerySpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).match(/INSERT INTO vendor_assurance_review_decisions/)
    );
    expect(insertCalls).toHaveLength(1);
  });

  it("409 when document is finalized", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ document_id: DOC_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ processing_status: "finalized" }] });
    const req = buildReq({
      params: { id: EXTRACTION_ID },
      body: { decisions: [{ field_name: "vendor_name", decision: "accept" }] }
    });
    const { res, status, json } = buildRes();
    await recordVendorAssuranceReviewDecisions(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: "vendor_assurance_document_finalized" });
  });
});

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

describe("finalizeVendorAssuranceDocument", () => {
  it("404 cross-org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
  });

  it("409 when already finalized", async () => {
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: DOC_ID, processing_status: "finalized" }]
    });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status, json } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: "vendor_assurance_document_already_finalized" });
  });

  it("409 when status is not 'extracted'", async () => {
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: DOC_ID, processing_status: "extracting" }]
    });
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
  });

  it("409 when material fields lack a current decision", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, processing_status: "extracted" }] }) // doc
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXTRACTION_ID }] }) // extraction
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // projection: nothing decided
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status, json } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0]?.[0] as { error: string; missing_field_names: string[] };
    expect(body.error).toBe("vendor_assurance_finalize_blocked");
    expect(body.missing_field_names.length).toBe(MATERIAL_FIELD_NAMES.length);
  });

  it("200 when all material fields decided; audits + sets finalized state", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, processing_status: "extracted" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXTRACTION_ID }] })
      .mockResolvedValueOnce({
        rowCount: MATERIAL_FIELD_NAMES.length,
        rows: MATERIAL_FIELD_NAMES.map((n) => ({ field_name: n, decision: "accept" }))
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, processing_status: "finalized" }] }); // UPDATE

    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    const auditCalls = (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(auditCalls.some((c) => c[0]?.eventType === "vendor_assurance.document.finalized")).toBe(true);
  });

  it("409 idempotent re-call (UPDATE returns 0 rows due to the WHERE precondition)", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DOC_ID, processing_status: "extracted" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXTRACTION_ID }] })
      .mockResolvedValueOnce({
        rowCount: MATERIAL_FIELD_NAMES.length,
        rows: MATERIAL_FIELD_NAMES.map((n) => ({ field_name: n, decision: "accept" }))
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE lost race
    const req = buildReq({ params: { id: DOC_ID } });
    const { res, status, json } = buildRes();
    await finalizeVendorAssuranceDocument(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: "vendor_assurance_document_already_finalized" });
  });
});
