/**
 * enterpriseImportParser.test.ts — ECL Slice 3: real CSV + XLSX round-trip parsing.
 */

import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseImportFile } from "../lib/enterpriseImportParser.js";

describe("parseImportFile — CSV", () => {
  it("parses headers (lowercased) + data rows, skipping blank rows", async () => {
    const csv = "Name,Criticality\nweb-01,high\n\ndb,low\n";
    const r = await parseImportFile(Buffer.from(csv), "assets.csv");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.headers).toEqual(["name", "criticality"]);
      expect(r.parsed.rows).toEqual([
        { name: "web-01", criticality: "high" },
        { name: "db", criticality: "low" }
      ]);
      expect(r.parsed.truncated).toBe(false);
    }
  });

  it("empty file → error", async () => {
    const r = await parseImportFile(Buffer.from(""), "x.csv");
    expect(r.ok).toBe(false);
  });
});

describe("parseImportFile — XLSX", () => {
  it("parses an xlsx workbook's first sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("sheet");
    ws.addRow(["name", "use_case"]);
    ws.addRow(["Support Copilot", "ticket triage"]);
    ws.addRow(["", ""]); // blank → skipped
    const buf = await wb.xlsx.writeBuffer();

    const r = await parseImportFile(Buffer.from(buf), "ai-systems.xlsx");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.headers).toEqual(["name", "use_case"]);
      expect(r.parsed.rows).toEqual([{ name: "Support Copilot", use_case: "ticket triage" }]);
    }
  });
});
