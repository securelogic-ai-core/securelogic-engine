/**
 * vendorAssurancePdfExtractor.ts — pdf-parse wrapper.
 *
 * Returns a discriminated result so the caller can distinguish the three real
 * failure modes from a successful parse:
 *   - successfully parsed text  → { ok: true, text, pageCount }
 *   - PDF is image-only / has no extractable text → { ok: false, errorCode: 'pdf_image_only' }
 *   - pdf-parse throws (corrupt, password-protected, unsupported)
 *                              → { ok: false, errorCode: 'pdf_unparseable' }
 *
 * No OCR. Image-only PDFs are explicitly rejected; OCR is a future package
 * decision.
 */

import { PDFParse } from "pdf-parse";

const MIN_TEXT_CHARS = 200;

export type PdfExtractionResult =
  | { ok: true; text: string; pageCount: number | null }
  | { ok: false; errorCode: "pdf_image_only" | "pdf_unparseable"; detail: string };

export async function extractPdfText(bytes: Uint8Array | Buffer): Promise<PdfExtractionResult> {
  let result: { text: string; numpages?: number };
  try {
    // pdf-parse v2 explicitly throws on `instanceof Buffer`; pass a plain
    // Uint8Array view over the same memory.
    const pdfData: Uint8Array = Buffer.isBuffer(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : bytes;
    const parser = new PDFParse(pdfData);
    const parsed = await parser.getText();
    result = parsed as { text: string; numpages?: number };
  } catch (err) {
    return {
      ok: false,
      errorCode: "pdf_unparseable",
      detail: (err as Error)?.message ?? "pdf-parse threw"
    };
  }

  const text = (result.text ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) {
    return {
      ok: false,
      errorCode: "pdf_image_only",
      detail: `extracted only ${text.length} chars (threshold ${MIN_TEXT_CHARS})`
    };
  }

  const pageCount = typeof result.numpages === "number" && result.numpages > 0
    ? result.numpages
    : null;

  return { ok: true, text, pageCount };
}
