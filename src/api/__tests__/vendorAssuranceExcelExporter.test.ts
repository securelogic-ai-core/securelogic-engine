/**
 * vendorAssuranceExcelExporter.test.ts — buildVendorAssuranceWorkbook structure:
 * the four sheets, frozen + autofiltered headers, and the CUECs sheet's
 * one-row-per-(CUEC, accepted control) shape (decision 5).
 */

import { describe, it, expect } from "vitest";
import { buildVendorAssuranceWorkbook, buildVendorAssuranceWorkbookBuffer, workbookDownloadFilename } from "../lib/vendorAssuranceExcelExporter.js";
import { makeExportBundle } from "./fixtures/vendorAssuranceExportBundle.js";

describe("buildVendorAssuranceWorkbook", () => {
  it("produces the four named sheets, each with a frozen + autofiltered header row", () => {
    const wb = buildVendorAssuranceWorkbook(makeExportBundle());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cover Sheet", "Document Fields", "CUECs", "Exceptions"]);
    for (const ws of wb.worksheets) {
      expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(ws.autoFilter).toBeTruthy();
      expect(ws.getRow(1).font?.bold).toBe(true);
    }
  });

  it("Document Fields has one row per material field", () => {
    const b = makeExportBundle();
    const ws = buildVendorAssuranceWorkbook(b).getWorksheet("Document Fields")!;
    expect(ws.rowCount).toBe(1 + b.materialFields.length);
    // The overridden field is marked.
    const overriddenName = b.fieldOverrides[0]!.fieldName;
    const label = b.materialFields.find((f) => f.name === overriddenName)!.label;
    const row = ws.getRows(2, ws.rowCount - 1)!.find((r) => r.getCell("field").value === label)!;
    expect(row.getCell("override_applied").value).toBe("Yes");
    expect(String(row.getCell("override_reason").value)).toContain("ampersand");
  });

  it("CUECs sheet emits one row per accepted mapping; a 'no applicable control' row; and a 'pending' row", () => {
    const b = makeExportBundle(); // cuec-1: 2 accepted mappings; cuec-2: reviewed_no_match (0 accepted); cuec-3: pending
    const ws = buildVendorAssuranceWorkbook(b).getWorksheet("CUECs")!;
    expect(ws.rowCount).toBe(1 + 2 + 1 + 1); // header + 2 + 1 + 1
    const dataRows = ws.getRows(2, ws.rowCount - 1)!;
    const statuses = dataRows.map((r) => String(r.getCell("status").value));
    expect(statuses.filter((s) => s.startsWith("Accepted"))).toHaveLength(2);
    expect(statuses.filter((s) => s.startsWith("No applicable"))).toHaveLength(1);
    expect(statuses.filter((s) => s.startsWith("Pending"))).toHaveLength(1);
    // The dismissed/suggested mappings on cuec-1 / cuec-2 must NOT appear.
    const controls = dataRows.map((r) => String(r.getCell("control").value));
    expect(controls).not.toContain("Clean Desk Policy");
    expect(controls).not.toContain("Identity & Access Management");
    expect(controls).toContain("Physical Facility Access Control");
    expect(controls).toContain("Datacenter Colocation Oversight");
    expect(controls).toContain("No applicable control");
    // Manual mapping has no score; auto mapping has one.
    const manualRow = dataRows.find((r) => r.getCell("control").value === "Datacenter Colocation Oversight")!;
    expect(manualRow.getCell("source").value).toBe("Manual");
    expect(manualRow.getCell("score").value === "" || manualRow.getCell("score").value == null).toBe(true);
  });

  it("a CUEC with no accepted mappings still appears as one row (empty control columns)", () => {
    const b = makeExportBundle({
      cuecs: [
        {
          id: "only", ordinal: 1, cuec_text: "Lonely CUEC", review_status: "pending", review_status_reason: null,
          review_status_updated_by_user_id: null, review_status_updated_at: null, created_at: "2026-05-08T00:00:00Z", updated_at: "2026-05-08T00:00:00Z",
          mappings: [{ id: "s", cuec_id: "only", control_id: "c", mapping_status: "suggested", mapping_score: 70, mapping_source: "auto", reason: null, created_by_user_id: null, updated_by_user_id: null, created_at: "2026-05-08T00:00:00Z", updated_at: "2026-05-08T00:00:00Z", control_name: "Suggested Only", control_description: null, control_status: "active" }]
        }
      ],
      cuecSummary: { total: 1, mapped: 0, noApplicableControl: 0, pending: 1 }
    });
    const ws = buildVendorAssuranceWorkbook(b).getWorksheet("CUECs")!;
    expect(ws.rowCount).toBe(2); // header + 1 row
    expect(String(ws.getRow(2).getCell("status").value)).toContain("Pending");
    expect(ws.getRow(2).getCell("control").value === "" || ws.getRow(2).getCell("control").value == null).toBe(true);
  });

  it("Exceptions sheet has one row per exception; falls back to an explanatory row when there are none", () => {
    const withExc = buildVendorAssuranceWorkbook(makeExportBundle()).getWorksheet("Exceptions")!;
    expect(withExc.rowCount).toBe(1 + 1);
    const none = buildVendorAssuranceWorkbook(makeExportBundle({ exceptions: [] })).getWorksheet("Exceptions")!;
    expect(none.rowCount).toBe(2);
    expect(String(none.getRow(2).getCell("description").value)).toContain("No exceptions");
  });

  it("serializes to a non-empty .xlsx buffer and yields a slugged filename", async () => {
    const b = makeExportBundle();
    const buf = await buildVendorAssuranceWorkbookBuffer(b);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
    // .xlsx is a zip — starts with "PK".
    expect(buf.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(workbookDownloadFilename(b)).toMatch(/^acme-cloud-infrastructure-inc-2025-09-30-soc-review\.xlsx$/);
  });
});
