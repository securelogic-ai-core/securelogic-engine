/**
 * vendorAssuranceExcelExporter.ts — the .xlsx export of a reviewed vendor-assurance
 * document, for hand-off to an auditor or auditee.
 *
 * `buildVendorAssuranceWorkbook(bundle)` is a pure function: it takes the export
 * bundle (vendorAssuranceExportData.ts) and returns an exceljs Workbook. It does
 * no I/O — the engine route serializes it (`workbook.xlsx.writeBuffer()`) and
 * streams the bytes. Unit-testable with a hand-built bundle.
 *
 * Four sheets:
 *   1. "Cover Sheet"     — provenance (decision 7): label/value pairs.
 *   2. "Document Fields"  — one row per material field: label, original value,
 *                          current value, override applied?, override reason,
 *                          confidence, reviewer, reviewed at.
 *   3. "CUECs"            — one row per (CUEC, accepted control) mapping pair (the
 *                          auditor-handover shape). A CUEC with no accepted mappings
 *                          gets one row (empty control columns); a CUEC marked
 *                          "reviewed_no_match" gets one row stating "No applicable
 *                          control" + the reviewer's reason. Suggested/dismissed
 *                          mappings do not appear — this is the reviewed state, not
 *                          the AI's draft (decision 5).
 *   4. "Exceptions"       — one row per auditor exception: control id, description,
 *                          auditor assessment, management response.
 *
 * Every sheet: header row frozen + bolded + filled, autofilter on the header,
 * sensible column widths, wrap-text on the long-text columns with row heights
 * capped so a runaway cell can't blow up the layout.
 */

import ExcelJS from "exceljs";
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
  reviewStateLabel,
  userName,
  vendorDisplayName,
  type VendorAssuranceExportBundle
} from "./vendorAssuranceExportModel.js";

const C = {
  headerFill: "FFF1F5F9",   // slate-50  — header row fill
  headerText: "FF0F172A",   // slate-900 — header row text
  hair: "FFE2E8F0",         // slate-200 — cell grid
  sectionFill: "FFF8FAFC",  // slate-50  — Cover Sheet "section" rows
};
const ROW_HEIGHT_CAP = 120;
const LINE_HEIGHT = 15;

const HAIR_BORDER = {
  top: { style: "hair" as const, color: { argb: C.hair } },
  left: { style: "hair" as const, color: { argb: C.hair } },
  bottom: { style: "hair" as const, color: { argb: C.hair } },
  right: { style: "hair" as const, color: { argb: C.hair } }
};

interface ColSpec {
  header: string;
  key: string;
  width: number;
  /** Long-text column: wrap text and let the row grow (capped). */
  wrap?: boolean;
}

function styleHeaderRow(ws: ExcelJS.Worksheet, colCount: number): void {
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: C.headerText } };
  hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerFill } };
  hdr.alignment = { vertical: "middle", wrapText: true };
  hdr.height = 20;
  for (let c = 1; c <= colCount; c += 1) hdr.getCell(c).border = HAIR_BORDER;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
}

/** Estimate how many wrapped lines `text` occupies in a column `widthChars` wide. */
function estimateLines(text: string, widthChars: number): number {
  if (!text) return 1;
  const per = Math.max(8, Math.floor(widthChars * 0.95));
  let total = 0;
  for (const seg of String(text).split("\n")) total += Math.max(1, Math.ceil(seg.length / per));
  return total;
}

/** After rows are added, apply wrap-text + a capped height to each data row, and a hair border to every cell. */
function finishDataRows(ws: ExcelJS.Worksheet, cols: ColSpec[]): void {
  const wrapKeys = cols.filter((c) => c.wrap).map((c) => c.key);
  const widthByKey = new Map(cols.map((c) => [c.key, c.width]));
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    let maxLines = 1;
    for (let c = 1; c <= cols.length; c += 1) {
      const cell = row.getCell(c);
      cell.border = HAIR_BORDER;
      cell.alignment = { vertical: "top", wrapText: wrapKeys.includes(cols[c - 1]!.key) };
    }
    for (const key of wrapKeys) {
      const v = row.getCell(key).value;
      const text = v == null ? "" : String(v);
      maxLines = Math.max(maxLines, estimateLines(text, widthByKey.get(key) ?? 40));
    }
    row.height = Math.max(LINE_HEIGHT, Math.min(ROW_HEIGHT_CAP, maxLines * LINE_HEIGHT));
  });
}

function applyColumns(ws: ExcelJS.Worksheet, cols: ColSpec[]): void {
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
}

/* =========================================================
   Sheet 1 — Cover Sheet (provenance, label/value pairs)
   ========================================================= */
function buildCoverSheet(wb: ExcelJS.Workbook, b: VendorAssuranceExportBundle): void {
  const cols: ColSpec[] = [
    { header: "Field", key: "field", width: 30 },
    { header: "Value", key: "value", width: 96, wrap: true }
  ];
  const ws = wb.addWorksheet("Cover Sheet");
  applyColumns(ws, cols);

  const ext = b.extraction;
  const rows: Array<[string, string]> = [
    ["Organization", b.organizationName],
    ["Source document", b.document.originalFilename],
    ["Vendor (per SOC report)", b.report.vendorName ?? "—"],
    ["Vendor (platform record)", b.vendorRecordName ?? "—"],
    ["Report type", b.report.reportType ?? "—"],
    ["Report period", reportPeriodText(b)],
    ["Report issued", fmtDateUtc(b.report.reportIssuedDate)],
    ["Service auditor", b.report.auditorName ?? "—"],
    ["Auditor opinion", b.report.auditorOpinion ?? "—"],
    ["Trust Services Criteria", b.report.trustServicesCriteria.length ? b.report.trustServicesCriteria.join("; ") : "—"],
    ["Subservice method", b.report.subserviceMethod ?? "—"],
    ["Subservice organizations", b.report.subserviceOrganizations.length ? b.report.subserviceOrganizations.join("; ") : "—"],
    ["Controls tested", b.controls.length ? `${b.controls.length}` : "—"],
    ["Exceptions noted", `${b.exceptions.length}`],
    ["CUEC mapping summary", cuecSummaryText(b)],
    ["Uploaded", `${fmtDateTimeUtc(b.document.uploadedAt)} · by ${b.document.uploadedByName ?? "—"}`],
    [
      "Review state",
      b.review.reviewerName || b.review.reviewedAt
        ? `${reviewStateLabel(b.review.state)} · ${b.review.reviewerName ?? "—"} · ${fmtDateTimeUtc(b.review.reviewedAt)}`
        : reviewStateLabel(b.review.state)
    ],
    ["Field corrections applied", `${b.fieldOverrides.length} field${b.fieldOverrides.length === 1 ? "" : "s"}`],
    [
      "Extraction provenance",
      ext ? `${ext.modelId} (${ext.promptVersion}) · extracted ${fmtDateTimeUtc(ext.createdAt)}` : "no extraction on record"
    ],
    ["Source document SHA-256", b.document.sha256],
    ["Exported", `${fmtDateTimeUtc(b.export.exportedAt)} · by ${b.export.exportedByName ?? "—"}`],
    ["What this document represents", coverStatementText(b)]
  ];
  for (const [field, value] of rows) ws.addRow({ field, value });

  styleHeaderRow(ws, cols.length);
  finishDataRows(ws, cols);
  // Field column: bold; "section-ish" emphasis on the closing statement row.
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.getCell("field").font = { bold: true };
  });
  const stmtRow = ws.lastRow;
  if (stmtRow) {
    stmtRow.getCell("value").font = { italic: true };
    stmtRow.getCell("field").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionFill } };
    stmtRow.getCell("value").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.sectionFill } };
  }
}

/* =========================================================
   Sheet 2 — Document Fields (one row per material field)
   ========================================================= */
function buildDocumentFieldsSheet(wb: ExcelJS.Workbook, b: VendorAssuranceExportBundle): void {
  const cols: ColSpec[] = [
    { header: "Field", key: "field", width: 24 },
    { header: "Original value", key: "original", width: 42, wrap: true },
    { header: "Current value", key: "current", width: 42, wrap: true },
    { header: "Override applied?", key: "override_applied", width: 16 },
    { header: "Override reason", key: "override_reason", width: 40, wrap: true },
    { header: "Confidence", key: "confidence", width: 11 },
    { header: "Reviewer", key: "reviewer", width: 22 },
    { header: "Reviewed at", key: "reviewed_at", width: 26 }
  ];
  const ws = wb.addWorksheet("Document Fields");
  applyColumns(ws, cols);

  const overrideByField = new Map(b.fieldOverrides.map((o) => [o.fieldName, o]));
  for (const spec of b.materialFields) {
    const name = spec.name;
    const ov = overrideByField.get(name);
    const extField = b.extraction?.fields[name];
    const extractionValue = extField?.value ?? null;
    const confidence = extField?.confidence;
    ws.addRow({
      field: spec.label,
      original: renderFieldValueForDisplay(name, ov ? ov.originalValue : extractionValue),
      current: renderFieldValueForDisplay(name, ov ? ov.overrideValue : extractionValue),
      override_applied: ov ? "Yes" : "No",
      override_reason: ov ? ov.reason : "",
      confidence: confidence === null || confidence === undefined ? "" : Number(confidence).toFixed(2),
      reviewer: ov ? (ov.overriddenByName ?? userName(b, ov.overriddenByUserId)) : "",
      reviewed_at: ov ? fmtDateTimeUtc(ov.overriddenAt) : ""
    });
  }

  styleHeaderRow(ws, cols.length);
  finishDataRows(ws, cols);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.getCell("field").font = { bold: true };
    if (row.getCell("override_applied").value === "Yes") {
      row.getCell("override_applied").font = { bold: true, color: { argb: "FF92400E" } }; // amber-800
    }
  });
}

/* =========================================================
   Sheet 3 — CUECs (one row per (CUEC, accepted control) mapping pair)
   ========================================================= */
function buildCuecsSheet(wb: ExcelJS.Workbook, b: VendorAssuranceExportBundle): void {
  const cols: ColSpec[] = [
    { header: "CUEC ordinal", key: "ordinal", width: 13 },
    { header: "CUEC text", key: "cuec_text", width: 55, wrap: true },
    { header: "Mapped control", key: "control", width: 34, wrap: true },
    { header: "Mapping source", key: "source", width: 15 },
    { header: "Mapping score", key: "score", width: 13 },
    { header: "Mapping status", key: "status", width: 26 },
    { header: "Reason", key: "reason", width: 40, wrap: true },
    { header: "Mapped at", key: "mapped_at", width: 26 },
    { header: "Mapped by", key: "mapped_by", width: 22 }
  ];
  const ws = wb.addWorksheet("CUECs");
  applyColumns(ws, cols);

  for (const c of b.cuecs) {
    const accepted = acceptedMappings(c);
    if (accepted.length > 0) {
      for (const m of accepted) {
        ws.addRow({
          ordinal: c.ordinal,
          cuec_text: c.cuec_text,
          control: m.control_name,
          source: m.mapping_source === "manual" ? "Manual" : "Automatic",
          score: m.mapping_score == null ? "" : m.mapping_score,
          status: "Accepted",
          reason: m.reason ?? "",
          mapped_at: fmtDateTimeUtc(m.updated_at),
          mapped_by: userName(b, m.updated_by_user_id ?? m.created_by_user_id)
        });
      }
    } else if (isNoApplicableControl(c)) {
      ws.addRow({
        ordinal: c.ordinal,
        cuec_text: c.cuec_text,
        control: "No applicable control",
        source: "—",
        score: "",
        status: "No applicable control (reviewed)",
        reason: c.review_status_reason ?? "",
        mapped_at: fmtDateTimeUtc(c.review_status_updated_at),
        mapped_by: userName(b, c.review_status_updated_by_user_id)
      });
    } else {
      ws.addRow({
        ordinal: c.ordinal,
        cuec_text: c.cuec_text,
        control: "",
        source: "",
        score: "",
        status: "Pending review",
        reason: "",
        mapped_at: "",
        mapped_by: ""
      });
    }
  }

  styleHeaderRow(ws, cols.length);
  finishDataRows(ws, cols);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const status = String(row.getCell("status").value ?? "");
    if (status.startsWith("Accepted")) row.getCell("status").font = { color: { argb: "FF166534" } }; // green-800
    else if (status.startsWith("No applicable")) row.getCell("status").font = { color: { argb: "FF92400E" } }; // amber-800
    else if (status.startsWith("Pending")) row.getCell("status").font = { italic: true, color: { argb: "FF64748B" } }; // slate-500
  });
}

/* =========================================================
   Sheet 4 — Exceptions (one row per auditor exception)
   ========================================================= */
function buildExceptionsSheet(wb: ExcelJS.Workbook, b: VendorAssuranceExportBundle): void {
  const cols: ColSpec[] = [
    { header: "#", key: "n", width: 6 },
    { header: "Control ID", key: "control_id", width: 22, wrap: true },
    { header: "Description", key: "description", width: 55, wrap: true },
    { header: "Auditor assessment", key: "auditor_assessment", width: 45, wrap: true },
    { header: "Management response", key: "management_response", width: 45, wrap: true }
  ];
  const ws = wb.addWorksheet("Exceptions");
  applyColumns(ws, cols);

  b.exceptions.forEach((e, i) => {
    ws.addRow({
      n: i + 1,
      control_id: e.controlId ?? "—",
      description: e.description || "—",
      auditor_assessment: e.auditorAssessment ?? "—",
      management_response: e.managementResponse ?? "—"
    });
  });
  // Keep the sheet non-empty / self-explanatory when there are no exceptions.
  if (b.exceptions.length === 0) {
    ws.addRow({ n: "", control_id: "", description: "No exceptions or deviations were noted in this report.", auditor_assessment: "", management_response: "" });
  }

  styleHeaderRow(ws, cols.length);
  finishDataRows(ws, cols);
}

/* =========================================================
   Public API
   ========================================================= */

/** Build the four-sheet vendor-assurance export workbook from the bundle. Pure — no I/O. */
export function buildVendorAssuranceWorkbook(bundle: VendorAssuranceExportBundle): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SecureLogic AI";
  wb.created = new Date(bundle.export.exportedAt);
  wb.title = `Vendor Assurance Review — ${reportTitle(bundle)}`;
  wb.company = bundle.organizationName;
  wb.description = `Reviewed-state export for ${vendorDisplayName(bundle)}; exported ${fmtDateTimeUtc(bundle.export.exportedAt)}.`;

  buildCoverSheet(wb, bundle);
  buildDocumentFieldsSheet(wb, bundle);
  buildCuecsSheet(wb, bundle);
  buildExceptionsSheet(wb, bundle);
  return wb;
}

/** Convenience for the engine route: build + serialize to a Buffer. */
export async function buildVendorAssuranceWorkbookBuffer(bundle: VendorAssuranceExportBundle): Promise<Buffer> {
  const wb = buildVendorAssuranceWorkbook(bundle);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

/** "<vendor>-<as-of>-soc-review.xlsx" for the Content-Disposition header. */
export function workbookDownloadFilename(bundle: VendorAssuranceExportBundle): string {
  return `${exportFilenameBase(bundle)}.xlsx`;
}
