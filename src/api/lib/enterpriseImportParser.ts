/**
 * enterpriseImportParser.ts — ECL Slice 3: spreadsheet → rows parser.
 *
 * Parses an uploaded CSV or XLSX buffer into header-keyed rows for the pure
 * `planImport` core. Reuses `exceljs` (already a dependency; also used by the
 * vendor-assurance exporter) — no new parsing dependency. Bounded (MAX_ROWS) as a
 * DoS guard; the per-org capacity cap is enforced separately downstream.
 *
 * Row shape matches `ImportRow` (header → string). Header keys are lowercased +
 * trimmed so column order/case in the sheet does not matter. Blank data rows are
 * skipped. All cell values are coerced to trimmed strings (the validators + the
 * import core interpret them).
 */

import ExcelJS from "exceljs";
import { Readable } from "node:stream";

import type { ImportRow } from "./enterpriseContextImport.js";

/** Hard cap on data rows parsed from one upload (DoS guard; the cap system limits commits). */
export const MAX_IMPORT_ROWS = 5000;

export interface ParsedImport {
  headers: string[];
  rows: ImportRow[];
  /** True when parsing stopped at MAX_IMPORT_ROWS (the file had more data rows). */
  truncated: boolean;
}

export type ParseResult =
  | { ok: true; parsed: ParsedImport }
  | { ok: false; error: string };

/** exceljs cell value → trimmed string, or "" for blank/formula/error cells. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  // Rich text / hyperlink / formula objects: prefer a text/result field if present.
  const o = value as { text?: unknown; result?: unknown; hyperlink?: unknown };
  if (typeof o.text === "string") return o.text.trim();
  if (typeof o.result === "string" || typeof o.result === "number") return String(o.result).trim();
  return "";
}

/** exceljs Row.values is 1-indexed with a leading hole; normalize to a 0-based array. */
function rowCells(row: ExcelJS.Row, width: number): string[] {
  const out: string[] = [];
  for (let c = 1; c <= width; c++) out.push(cellToString(row.getCell(c).value));
  return out;
}

export async function parseImportFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const isCsv = /\.csv$/i.test(filename);
  const wb = new ExcelJS.Workbook();
  try {
    if (isCsv) {
      await wb.csv.read(Readable.from(buffer));
    } else {
      // @types/node's Buffer and exceljs's Buffer are nominally incompatible (a lib
      // version skew — runtime-identical). Bridge via unknown to load()'s own param type.
      await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    }
  } catch {
    return { ok: false, error: "unparseable_file" };
  }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) return { ok: false, error: "empty_file" };

  const headerRow = ws.getRow(1);
  const width = ws.columnCount;
  const headers = rowCells(headerRow, width).map((h) => h.toLowerCase());
  const nonEmptyHeaders = headers.filter((h) => h.length > 0);
  if (nonEmptyHeaders.length === 0) return { ok: false, error: "missing_header_row" };

  const rows: ImportRow[] = [];
  let truncated = false;
  for (let r = 2; r <= ws.rowCount; r++) {
    if (rows.length >= MAX_IMPORT_ROWS) { truncated = true; break; }
    const cells = rowCells(ws.getRow(r), width);
    if (cells.every((c) => c.length === 0)) continue; // skip blank rows
    const row: ImportRow = {};
    headers.forEach((h, i) => { if (h.length > 0) row[h] = cells[i] ?? ""; });
    rows.push(row);
  }

  return { ok: true, parsed: { headers: nonEmptyHeaders, rows, truncated } };
}
