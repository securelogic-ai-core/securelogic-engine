import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// Mocks must be hoisted before the route module is imported. The route
// transitively imports middleware that touches postgres at module-load.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));
vi.mock("../lib/jwt.js", () => ({
  verifyJwt: vi.fn()
}));

const constructorSpy = vi.fn();
const getTextSpy = vi.fn();

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(bytes: unknown) {
      constructorSpy(bytes);
    }
    getText = getTextSpy;
  }
}));

const analyzeSpy = vi.fn();
vi.mock("../lib/claudeAssessmentAnalyzer.js", () => ({
  analyzeAssessmentDocument: (...args: unknown[]) => analyzeSpy(...args)
}));

vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

import { analyzeAssessmentDocumentHandler } from "../routes/vendorAssessmentAnalysis.js";

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockImplementation(() => ({ json }));
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

function makeReq(file: Express.Multer.File | undefined, body: Record<string, string> = {}): Request {
  return {
    file,
    body,
    organizationContext: { organizationId: "org_123" }
  } as unknown as Request;
}

beforeEach(() => {
  constructorSpy.mockReset();
  getTextSpy.mockReset();
  analyzeSpy.mockReset();
});

describe("analyzeAssessmentDocumentHandler — pdf-parse Uint8Array invariant", () => {
  it("normalizes multer Buffer to a plain Uint8Array before PDFParse (pdf-parse v2 rejects Buffer)", async () => {
    getTextSpy.mockResolvedValueOnce({ text: "extracted text from pdf" });
    analyzeSpy.mockResolvedValueOnce({ findings: [] });

    const buf = Buffer.from("%PDF-1.4 fake pdf bytes for test");
    const file = {
      fieldname: "document",
      originalname: "soc2.pdf",
      mimetype: "application/pdf",
      buffer: buf,
      size: buf.length,
      encoding: "7bit",
      destination: "",
      filename: "",
      path: "",
      stream: undefined as unknown as NodeJS.ReadableStream
    } as unknown as Express.Multer.File;

    const { res, status, json } = mockRes();
    await analyzeAssessmentDocumentHandler(
      makeReq(file, { vendor_name: "Acme" }),
      res
    );

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    const passed = constructorSpy.mock.calls[0]?.[0];
    expect(passed).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(passed)).toBe(false);
    // sanity: same bytes
    expect((passed as Uint8Array).byteLength).toBe(buf.byteLength);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ analysis: { findings: [] } });
  });

  it("does not invoke PDFParse for non-PDF uploads (text/plain passes through)", async () => {
    analyzeSpy.mockResolvedValueOnce({ findings: [] });

    const buf = Buffer.from("plain text body");
    const file = {
      fieldname: "document",
      originalname: "notes.txt",
      mimetype: "text/plain",
      buffer: buf,
      size: buf.length,
      encoding: "7bit",
      destination: "",
      filename: "",
      path: "",
      stream: undefined as unknown as NodeJS.ReadableStream
    } as unknown as Express.Multer.File;

    const { res } = mockRes();
    await analyzeAssessmentDocumentHandler(
      makeReq(file, { vendor_name: "Acme" }),
      res
    );

    expect(constructorSpy).not.toHaveBeenCalled();
  });
});
