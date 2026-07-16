/**
 * reportBranding.ts — shared branding + footer helpers for PDF report routes
 * (gap report, audit package, executive report).
 *
 * Logo: the canonical SecureLogic AI logo shipped with the engine at
 * src/api/public/assets/logo.png (copied to dist/api/public/assets by the
 * build). Reports embed this image; when the asset is missing the caller
 * falls back to the text wordmark so PDF generation never fails on branding.
 *
 * Footers: pdfkit starts a new page whenever text is written below
 * page.maxY() (the bottom margin line). Footer stamping writes at
 * pageH - 28 — inside the 50pt bottom margin — so every footer write used
 * to spawn a trailing artifact page containing only the footer text.
 * inFooterZone() zeroes the bottom margin for the duration of the write,
 * which disables that implicit page break.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __libDir = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__libDir, "..", "public", "assets", "logo.png");

let cachedLogo: Buffer | null | undefined;

/** The SecureLogic AI logo PNG, or null when the asset is unavailable. */
export function secureLogicLogo(): Buffer | null {
  if (cachedLogo === undefined) {
    try {
      cachedLogo = readFileSync(LOGO_PATH);
    } catch {
      cachedLogo = null;
    }
  }
  return cachedLogo;
}

/**
 * Run `draw` with the current page's bottom margin zeroed so writes in the
 * footer zone cannot trigger pdfkit's implicit page break.
 */
export function inFooterZone(doc: PDFKit.PDFDocument, draw: () => void): void {
  const prevBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  try {
    draw();
  } finally {
    doc.page.margins.bottom = prevBottom;
  }
}

/**
 * Stamp a rule + "<leftText>" + "Page N of TOTAL" footer on every buffered
 * page. Must be called after all content pages exist and before doc.end();
 * the document must be created with bufferPages: true.
 */
export function stampFooters(
  doc: PDFKit.PDFDocument,
  opts: { leftText: string; textColor?: string; ruleColor?: string }
): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const textColor = opts.textColor ?? "#64748B";
  const ruleColor = opts.ruleColor ?? "#CBD5E1";

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    inFooterZone(doc, () => {
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const margin = doc.page.margins.left;
      const contentW = pageW - margin * 2;
      const footerY = pageH - 28;

      doc.rect(margin, footerY - 8, contentW, 0.5).fill(ruleColor);
      doc
        .fillColor(textColor)
        .font("Helvetica")
        .fontSize(8)
        .text(opts.leftText, margin, footerY, {
          width: contentW / 2,
          lineBreak: false,
        });
      doc
        .fillColor(textColor)
        .font("Helvetica")
        .fontSize(8)
        .text(`Page ${i + 1} of ${total}`, margin + contentW / 2, footerY, {
          width: contentW / 2,
          align: "right",
          lineBreak: false,
        });
    });
  }
}
