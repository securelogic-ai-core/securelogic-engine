/**
 * vendorAssurancePdfExporter.ts — the .pdf export of a reviewed vendor-assurance
 * document, for hand-off to an auditor or auditee.
 *
 * `buildVendorAssurancePdf(bundle)` takes the export bundle (vendorAssuranceExportData.ts)
 * and returns the PDF bytes. It uses pdfkit (already an engine dependency) and the
 * standard Helvetica family only — no vendored fonts. There is no HTML template,
 * no headless browser, and no app round-trip: the engine builds the document
 * directly from its own data. Apart from the in-process pdfkit stream it does no I/O.
 *
 * Layout (A4, ~20mm margins):
 *   1. Cover page        — provenance (decision 7): prominent organization name,
 *                          report title, the RECORD PROVENANCE block, and the
 *                          "what this document represents" statement card.
 *   2. Document Fields   — the report's cover-sheet fields with any reviewer
 *                          corrections clearly marked.
 *   3. CUECs             — one card per CUEC, listing only the accepted control
 *                          mappings (the reviewed state, not the AI's draft) or a
 *                          "no applicable control" / "pending review" line.
 *   4. Exceptions        — one card per auditor exception with its management
 *                          response.
 * Every non-cover page carries a slim footer: "{Org} · {Vendor} · Exported {ts}"
 * on the left, "Page n of m" on the right (m counts content pages, not the cover).
 *
 * All timestamps render in UTC with an explicit "UTC" suffix (refinement 1).
 */

import PDFDocument from "pdfkit";
import {
  acceptedMappings,
  coverStatementText,
  cuecSummaryText,
  exportFilenameBase,
  fmtDateTimeUtc,
  fmtDateUtc,
  isNoApplicableControl,
  renderFieldValueForDisplay,
  reportPeriodText,
  reportTitle,
  reviewLine,
  reviewStateLabel,
  userName,
  vendorDisplayName,
  type VendorAssuranceExportBundle,
  type VendorAssuranceCuecRow
} from "./vendorAssuranceExportModel.js";

/* ---------- Geometry ---------- */
const PAGE = { w: 595.28, h: 841.89 }; // A4 in points
const MARGIN = 56;                       // ≈ 20mm
const CONTENT_W = PAGE.w - MARGIN * 2;
const BOTTOM_LIMIT = PAGE.h - MARGIN;    // y past which content must not flow

/* ---------- Palette (restrained — one thin teal accent, the rest slate) ---------- */
const C = {
  ink: "#0f172a",      // slate-900 — primary text
  ink2: "#334155",     // slate-700 — secondary text / values
  muted: "#64748b",    // slate-500 — labels
  faint: "#94a3b8",    // slate-400 — eyebrow / footer / hints
  hair: "#e2e8f0",     // slate-200 — hairline rules / card borders
  cardBg: "#f8fafc",   // slate-50  — card fill
  accent: "#0d9488",   // teal-600  — thin accent tick
  amber: "#92400e",    // amber-800 — "corrected" callouts
  green: "#166534",    // green-800 — "accepted" markers
};
const F = { reg: "Helvetica", bold: "Helvetica-Bold", ital: "Helvetica-Oblique", boldItal: "Helvetica-BoldOblique" };

/* ---------- Low-level helpers ---------- */

type Doc = PDFKit.PDFDocument;

/** Bottom of the usable content area on the current page. */
function bottomLimit(): number { return BOTTOM_LIMIT; }

/** Move to a fresh content page (uses the constructor margins). */
function newContentPage(doc: Doc): void { doc.addPage(); }

/** If `need` points won't fit before the bottom limit, start a new page. */
function ensureSpace(doc: Doc, need: number): void {
  if (doc.y + need > bottomLimit()) newContentPage(doc);
}

/** heightOfString with the same options we render with, so measure == draw. */
function measureText(doc: Doc, text: string, width: number, font: string, size: number): number {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width });
}

/** Draw a left-aligned text block at (x, y); returns the y just below it. */
function drawText(doc: Doc, text: string, x: number, y: number, width: number, font: string, size: number, color: string, opts: { align?: "left" | "right" | "center"; characterSpacing?: number } = {}): number {
  doc.font(font).fontSize(size).fillColor(color).text(text, x, y, { width, align: opts.align ?? "left", characterSpacing: opts.characterSpacing });
  return doc.y;
}

function hairline(doc: Doc, y: number, x1 = MARGIN, x2 = PAGE.w - MARGIN): void {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.75).strokeColor(C.hair).stroke();
}

/* ---------- Section header (top of each content page) ---------- */
function sectionHeader(doc: Doc, eyebrow: string, title: string): void {
  let y = MARGIN;
  doc.font(F.bold).fontSize(7.5).fillColor(C.faint).text(eyebrow.toUpperCase(), MARGIN, y, { characterSpacing: 1.4 });
  y = doc.y + 6;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + 28, y).lineWidth(2).strokeColor(C.accent).stroke();
  y += 8;
  doc.font(F.bold).fontSize(20).fillColor(C.ink).text(title, MARGIN, y, { width: CONTENT_W });
  y = doc.y + 8;
  hairline(doc, y);
  doc.y = y + 16;
}

/* ---------- Cover page ---------- */
function renderCover(doc: Doc, b: VendorAssuranceExportBundle): void {
  let y = MARGIN;

  doc.font(F.bold).fontSize(7.5).fillColor(C.faint).text("SECURELOGIC AI  ·  VENDOR ASSURANCE", MARGIN, y, { characterSpacing: 1.6 });
  y += 16;
  doc.font(F.bold).fontSize(19).fillColor(C.ink).text(b.organizationName, MARGIN, y, { width: CONTENT_W });
  y = doc.y + 8;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + 64, y).lineWidth(2).strokeColor(C.accent).stroke();
  y += 2;
  hairline(doc, y);

  // Title block
  y += 92;
  doc.font(F.bold).fontSize(30).fillColor(C.ink).text("Vendor Assurance Review", MARGIN, y, { width: CONTENT_W });
  y = doc.y + 10;
  doc.font(F.reg).fontSize(14).fillColor(C.ink2).text(vendorDisplayName(b), MARGIN, y, { width: CONTENT_W });
  y = doc.y + 4;
  doc.font(F.reg).fontSize(9.5).fillColor(C.muted).text(`${b.report.reportType ?? "SOC report"}  ·  Report period ${reportPeriodText(b)}`, MARGIN, y, { width: CONTENT_W });

  // RECORD PROVENANCE
  y += 64;
  doc.font(F.bold).fontSize(8).fillColor(C.faint).text("RECORD PROVENANCE", MARGIN, y, { characterSpacing: 1.4 });
  y += 14;
  hairline(doc, y);
  y += 14;

  const LABEL_W = 150;
  const VAL_X = MARGIN + LABEL_W;
  const VAL_W = CONTENT_W - LABEL_W;
  const metaRow = (label: string, value: string): void => {
    doc.font(F.reg).fontSize(9).fillColor(C.muted).text(label.toUpperCase(), MARGIN, y, { width: LABEL_W - 12, characterSpacing: 0.4 });
    const labelEnd = doc.y;
    doc.font(F.reg).fontSize(10).fillColor(C.ink2).text(value, VAL_X, y, { width: VAL_W });
    y = Math.max(labelEnd, doc.y) + 9;
  };

  metaRow("Source document", b.document.originalFilename);
  metaRow("Vendor", vendorDisplayName(b));
  // refinement 2: report period is already in the subtitle — keep type + issued date here only.
  metaRow("Report", `${b.report.reportType ?? "—"}  ·  issued ${fmtDateUtc(b.report.reportIssuedDate)}`);
  metaRow("Service auditor", b.report.auditorName ?? "—");
  metaRow("Uploaded", `${fmtDateTimeUtc(b.document.uploadedAt)}  ·  by ${b.document.uploadedByName ?? "—"}`);
  metaRow("Review state", reviewLine(b));
  metaRow("CUEC mapping", cuecSummaryText(b));
  metaRow("Exported", `${fmtDateTimeUtc(b.export.exportedAt)}  ·  by ${b.export.exportedByName ?? "—"}`);

  // "What this document represents" card
  y += 10;
  const statement = coverStatementText(b);
  const innerW = CONTENT_W - 28;
  const stmtH = measureText(doc, statement, innerW, F.ital, 9.5);
  const cardH = stmtH + 24;
  doc.roundedRect(MARGIN, y, CONTENT_W, cardH, 4).fillAndStroke(C.cardBg, C.hair);
  doc.font(F.ital).fontSize(9.5).fillColor(C.ink2).text(statement, MARGIN + 14, y + 12, { width: innerW });

  // (Footer for the cover is intentionally minimal; non-cover footers come from the post-pass.)
  // The footer lives in the page's bottom-margin band; drop the bottom margin to 0 on this
  // page first so pdfkit doesn't treat the footer text as overflow and spill it onto a new page.
  doc.page.margins.bottom = 0;
  const footY = PAGE.h - MARGIN + 8;
  hairline(doc, footY);
  doc.font(F.bold).fontSize(8).fillColor(C.faint).text("SecureLogic AI", MARGIN, footY + 8, { characterSpacing: 0.6 });
  doc.font(F.reg).fontSize(8).fillColor(C.faint).text(`Exported ${fmtDateTimeUtc(b.export.exportedAt)}`, MARGIN, footY + 8, { width: CONTENT_W, align: "right" });
}

/* ---------- Document Fields ---------- */

const COVER_SHEET_FIELD_ORDER = [
  "vendor_name",
  "report_type",
  "report_period_start",
  "report_period_end",
  "report_issued_date",
  "auditor_name",
  "auditor_opinion",
  "trust_services_criteria",
  "subservice_method",
  "subservice_organizations",
  "controls"
] as const;

function renderDocumentFields(doc: Doc, b: VendorAssuranceExportBundle): void {
  newContentPage(doc);
  sectionHeader(doc, "SecureLogic AI · Vendor Assurance", "Document Fields");

  const overrideByField = new Map(b.fieldOverrides.map((o) => [o.fieldName, o]));
  const labelFor = (name: string): string => b.materialFields.find((f) => f.name === name)?.label ?? name;

  const LABEL_W = 168;
  const VAL_X = MARGIN + LABEL_W;
  const VAL_W = CONTENT_W - LABEL_W;

  for (const name of COVER_SHEET_FIELD_ORDER) {
    const ov = overrideByField.get(name);
    const extField = b.extraction?.fields[name];
    const currentRendered = renderFieldValueForDisplay(name, ov ? ov.overrideValue : (extField?.value ?? null));

    // Measure the row up front so the label/value/callout stay together on one page.
    const labelH = measureText(doc, labelFor(name).toUpperCase(), LABEL_W - 12, F.reg, 9);
    const valH = measureText(doc, currentRendered, VAL_W, F.reg, 10.5);
    let calloutH = 0;
    let calloutText = "";
    if (ov) {
      const originalRendered = renderFieldValueForDisplay(name, ov.originalValue);
      calloutText = `Corrected by ${ov.overriddenByName ?? userName(b, ov.overriddenByUserId)} on ${fmtDateTimeUtc(ov.overriddenAt)} · was: ${originalRendered} · reason: ${ov.reason}`;
      calloutH = measureText(doc, calloutText, VAL_W, F.ital, 8.5) + 3;
    }
    const rowH = Math.max(labelH, valH) + calloutH + 12;
    ensureSpace(doc, rowH);

    const top = doc.y;
    doc.font(F.reg).fontSize(9).fillColor(C.muted).text(labelFor(name).toUpperCase(), MARGIN, top, { width: LABEL_W - 12, characterSpacing: 0.3 });
    let valBottom = drawText(doc, currentRendered, VAL_X, top, VAL_W, F.reg, 10.5, C.ink2);
    if (ov) {
      const cy = valBottom + 3;
      valBottom = drawText(doc, calloutText, VAL_X, cy, VAL_W, F.ital, 8.5, C.amber);
    }
    doc.y = Math.max(top + labelH, valBottom) + 12;
    // light separator between fields
    hairline(doc, doc.y - 6, MARGIN, PAGE.w - MARGIN);
  }

  // Cross-reference: CUECs and exceptions get their own sections.
  ensureSpace(doc, 28);
  doc.font(F.ital).fontSize(9).fillColor(C.faint).text(
    "Complementary user entity controls and auditor exceptions are detailed in the following sections.",
    MARGIN, doc.y + 4, { width: CONTENT_W }
  );
}

/* ---------- Cards (CUECs, Exceptions) ---------- */

interface CardLine {
  text: string;
  font: string;
  size: number;
  color: string;
  gapBefore?: number;
  indent?: number;
}

const CARD_PAD = 12;
const CARD_GAP = 10;
const ACCENT_BAR_W = 3;

function cardInnerWidth(): number { return CONTENT_W - 2 * CARD_PAD - (ACCENT_BAR_W + 2); }

function measureCard(doc: Doc, lines: CardLine[]): number {
  const innerW = cardInnerWidth();
  let h = CARD_PAD * 2;
  for (const ln of lines) {
    h += ln.gapBefore ?? 0;
    h += measureText(doc, ln.text, innerW - (ln.indent ?? 0), ln.font, ln.size);
  }
  return h + 4; // small slack so the border never clips
}

/** Draw a bordered/tinted card with a left accent bar. Splits to a new page if it doesn't fit;
 *  if it's taller than a fresh page, renders without the border so it can flow. */
function drawCard(doc: Doc, lines: CardLine[], accentColor: string): void {
  const h = measureCard(doc, lines);
  const freshPageRoom = bottomLimit() - MARGIN;
  if (h > freshPageRoom) {
    // Oversized: no bordered box (it would clip across a page break); accent bar + content flow.
    ensureSpace(doc, 24);
    const innerW = cardInnerWidth();
    const textX = MARGIN + CARD_PAD + ACCENT_BAR_W + 2;
    for (const ln of lines) {
      if (ln.gapBefore) doc.y += ln.gapBefore;
      ensureSpace(doc, measureText(doc, ln.text, innerW - (ln.indent ?? 0), ln.font, ln.size) + 4);
      doc.font(ln.font).fontSize(ln.size).fillColor(ln.color).text(ln.text, textX + (ln.indent ?? 0), doc.y, { width: innerW - (ln.indent ?? 0) });
    }
    doc.y += CARD_GAP;
    return;
  }
  ensureSpace(doc, h + CARD_GAP);
  const top = doc.y;
  doc.roundedRect(MARGIN, top, CONTENT_W, h, 4).fillAndStroke(C.cardBg, C.hair);
  doc.rect(MARGIN, top, ACCENT_BAR_W, h).fill(accentColor);
  const innerW = cardInnerWidth();
  const textX = MARGIN + CARD_PAD + ACCENT_BAR_W + 2;
  let cy = top + CARD_PAD;
  for (const ln of lines) {
    cy += ln.gapBefore ?? 0;
    doc.font(ln.font).fontSize(ln.size).fillColor(ln.color).text(ln.text, textX + (ln.indent ?? 0), cy, { width: innerW - (ln.indent ?? 0) });
    cy = doc.y;
  }
  doc.y = top + h + CARD_GAP;
}

/* ---------- CUECs ---------- */
function cuecCardLines(b: VendorAssuranceExportBundle, c: VendorAssuranceCuecRow): { lines: CardLine[]; accent: string } {
  const accepted = acceptedMappings(c);
  const lines: CardLine[] = [];
  // Header line: ordinal + state
  let stateLabel: string;
  let accent: string;
  if (accepted.length > 0) { stateLabel = `Mapped to ${accepted.length} control${accepted.length === 1 ? "" : "s"}`; accent = C.green; }
  else if (isNoApplicableControl(c)) { stateLabel = "No applicable control (reviewed)"; accent = C.amber; }
  else { stateLabel = "Pending review"; accent = C.faint; }
  lines.push({ text: `CUEC ${c.ordinal} · ${stateLabel}`, font: F.bold, size: 9, color: C.faint });
  // CUEC text
  lines.push({ text: c.cuec_text, font: F.reg, size: 10.5, color: C.ink, gapBefore: 5 });
  // Mappings / state detail
  if (accepted.length > 0) {
    for (const m of accepted) {
      const srcBits: string[] = [m.mapping_source === "manual" ? "manual mapping" : "automatic mapping"];
      if (m.mapping_score != null) srcBits.push(`match score ${m.mapping_score}`);
      const by = userName(b, m.updated_by_user_id ?? m.created_by_user_id);
      if (by !== "—") srcBits.push(`accepted by ${by}`);
      lines.push({ text: `•  ${m.control_name}`, font: F.bold, size: 9.5, color: C.ink2, gapBefore: 6, indent: 6 });
      lines.push({ text: `(${srcBits.join(" · ")})`, font: F.reg, size: 8.5, color: C.muted, gapBefore: 1, indent: 16 });
      if (m.reason && m.reason.trim() !== "") {
        lines.push({ text: `Reason: ${m.reason}`, font: F.ital, size: 8.5, color: C.muted, gapBefore: 1, indent: 16 });
      }
    }
  } else if (isNoApplicableControl(c)) {
    const reason = c.review_status_reason && c.review_status_reason.trim() !== "" ? c.review_status_reason : "No reason recorded.";
    const by = userName(b, c.review_status_updated_by_user_id);
    lines.push({ text: `Reviewer determined no control in the inventory applies. Reason: ${reason}`, font: F.reg, size: 9, color: C.ink2, gapBefore: 6, indent: 6 });
    if (by !== "—" || c.review_status_updated_at) {
      lines.push({ text: `Marked by ${by} on ${fmtDateTimeUtc(c.review_status_updated_at)}.`, font: F.ital, size: 8.5, color: C.muted, gapBefore: 1, indent: 6 });
    }
  } else {
    lines.push({ text: "This CUEC has not yet been mapped to a control or marked as having no applicable control.", font: F.ital, size: 9, color: C.muted, gapBefore: 6, indent: 6 });
  }
  return { lines, accent };
}

function renderCuecs(doc: Doc, b: VendorAssuranceExportBundle): void {
  newContentPage(doc);
  sectionHeader(doc, "SecureLogic AI · Vendor Assurance", "Complementary User Entity Controls");
  doc.font(F.reg).fontSize(9.5).fillColor(C.muted).text(cuecSummaryText(b), MARGIN, doc.y, { width: CONTENT_W });
  doc.y += 14;

  if (b.cuecs.length === 0) {
    doc.font(F.ital).fontSize(10).fillColor(C.faint).text("No complementary user entity controls were extracted from this report.", MARGIN, doc.y, { width: CONTENT_W });
    return;
  }
  for (const c of b.cuecs) {
    const { lines, accent } = cuecCardLines(b, c);
    drawCard(doc, lines, accent);
  }
}

/* ---------- Exceptions ---------- */
function renderExceptions(doc: Doc, b: VendorAssuranceExportBundle): void {
  newContentPage(doc);
  sectionHeader(doc, "SecureLogic AI · Vendor Assurance", "Exceptions and Deviations");

  if (b.exceptions.length === 0) {
    doc.font(F.ital).fontSize(10).fillColor(C.faint).text("No exceptions or deviations were noted in this report.", MARGIN, doc.y, { width: CONTENT_W });
    return;
  }
  b.exceptions.forEach((e, i) => {
    const lines: CardLine[] = [];
    lines.push({ text: `Exception ${i + 1}${e.controlId ? ` · ${e.controlId}` : ""}`, font: F.bold, size: 9, color: C.faint });
    lines.push({ text: e.description || "(no description recorded)", font: F.reg, size: 10.5, color: C.ink, gapBefore: 5 });
    lines.push({ text: "Auditor assessment", font: F.bold, size: 8.5, color: C.muted, gapBefore: 7 });
    lines.push({ text: e.auditorAssessment ?? "Not stated.", font: F.reg, size: 9, color: C.ink2, gapBefore: 1 });
    lines.push({ text: "Management response", font: F.bold, size: 8.5, color: C.muted, gapBefore: 7 });
    lines.push({ text: e.managementResponse ?? "Not stated.", font: F.reg, size: 9, color: C.ink2, gapBefore: 1 });
    drawCard(doc, lines, C.amber);
  });
}

/* ---------- Footer post-pass ---------- */
function paintFooters(doc: Doc, b: VendorAssuranceExportBundle): void {
  const range = doc.bufferedPageRange(); // { start, count }
  const contentPageCount = range.count - 1; // exclude the cover (index = range.start)
  if (contentPageCount <= 0) return;
  const left = `${b.organizationName}  ·  ${vendorDisplayName(b)}  ·  Exported ${fmtDateTimeUtc(b.export.exportedAt)}`;
  const footY = PAGE.h - 40;
  for (let i = range.start + 1; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Footer sits in the bottom-margin band — clear the bottom margin on each page so the
    // footer text isn't treated as overflow (which would spill it onto a brand-new page).
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGIN, footY).lineTo(PAGE.w - MARGIN, footY).lineWidth(0.75).strokeColor(C.hair).stroke();
    doc.font(F.reg).fontSize(7.5).fillColor(C.faint).text(left, MARGIN, footY + 6, { width: CONTENT_W - 90, lineBreak: false, ellipsis: true });
    doc.font(F.reg).fontSize(7.5).fillColor(C.faint).text(`Page ${i - range.start} of ${contentPageCount}`, MARGIN, footY + 6, { width: CONTENT_W, align: "right", lineBreak: false });
  }
}

/* ---------- Public API ---------- */

/** Build the vendor-assurance export PDF from the bundle. Resolves to the PDF bytes. */
export function buildVendorAssurancePdf(bundle: VendorAssuranceExportBundle): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `Vendor Assurance Review — ${reportTitle(bundle)}`,
        Author: "SecureLogic AI",
        Subject: `Reviewed-state export for ${vendorDisplayName(bundle)}`,
        Creator: "SecureLogic AI"
      }
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      renderCover(doc, bundle);
      renderDocumentFields(doc, bundle);
      renderCuecs(doc, bundle);
      renderExceptions(doc, bundle);
      paintFooters(doc, bundle);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

/** "<vendor>-<as-of>-soc-review.pdf" for the Content-Disposition header. */
export function pdfDownloadFilename(bundle: VendorAssuranceExportBundle): string {
  return `${exportFilenameBase(bundle)}.pdf`;
}
