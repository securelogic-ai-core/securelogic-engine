import { describe, it, expect, vi, beforeEach } from "vitest";

const getTextSpy = vi.fn();
let throwOnConstruct = false;

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(_bytes: unknown) {
      if (throwOnConstruct) throw new Error("constructor blew up");
    }
    getText = getTextSpy;
  }
}));

import { extractPdfText } from "../lib/vendorAssurancePdfExtractor.js";

beforeEach(() => {
  getTextSpy.mockReset();
  throwOnConstruct = false;
});

describe("extractPdfText", () => {
  it("returns ok with text and pageCount on a successful parse", async () => {
    const longText = "A".repeat(500);
    getTextSpy.mockResolvedValueOnce({ text: longText, numpages: 42 });
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe(longText);
      expect(r.pageCount).toBe(42);
    }
  });

  it("returns pdf_image_only when extracted text is below threshold", async () => {
    getTextSpy.mockResolvedValueOnce({ text: "tiny", numpages: 5 });
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("pdf_image_only");
      expect(r.detail).toMatch(/threshold/);
    }
  });

  it("returns pdf_image_only when extracted text is empty", async () => {
    getTextSpy.mockResolvedValueOnce({ text: "", numpages: 5 });
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("pdf_image_only");
  });

  it("returns pdf_unparseable when pdf-parse constructor throws", async () => {
    throwOnConstruct = true;
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("pdf_unparseable");
      expect(r.detail).toMatch(/blew up/);
    }
  });

  it("returns pdf_unparseable when getText() rejects", async () => {
    getTextSpy.mockRejectedValueOnce(new Error("encrypted PDF"));
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("pdf_unparseable");
      expect(r.detail).toMatch(/encrypted/);
    }
  });

  it("returns pageCount=null when numpages is missing", async () => {
    getTextSpy.mockResolvedValueOnce({ text: "B".repeat(500) });
    const r = await extractPdfText(Buffer.from("pdf"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pageCount).toBeNull();
  });
});
