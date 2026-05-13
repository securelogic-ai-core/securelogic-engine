/**
 * vendorAssurancePdfExporter.test.ts — buildVendorAssurancePdf produces a
 * non-trivial PDF without throwing, for both a rich bundle and a sparse one.
 * Layout assertions are intentionally light (magic bytes, byte length, filename).
 */

import { describe, it, expect } from "vitest";
import { buildVendorAssurancePdf, pdfDownloadFilename } from "../lib/vendorAssurancePdfExporter.js";
import { makeExportBundle } from "./fixtures/vendorAssuranceExportBundle.js";

describe("buildVendorAssurancePdf", () => {
  it("renders a multi-section PDF for a rich bundle", async () => {
    const buf = await buildVendorAssurancePdf(makeExportBundle());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(4000);
    // %%EOF marker present.
    expect(buf.subarray(buf.length - 1024).toString("latin1")).toContain("%%EOF");
  });

  it("renders without throwing for a sparse bundle (no extraction, no cuecs, no exceptions)", async () => {
    const sparse = makeExportBundle({
      extraction: null,
      fieldOverrides: [],
      report: {
        vendorName: null, reportType: null, reportPeriodStart: null, reportPeriodEnd: null, reportIssuedDate: null,
        auditorName: null, auditorOpinion: null, trustServicesCriteria: [], subserviceMethod: null, subserviceOrganizations: []
      },
      controls: [],
      exceptions: [],
      cuecs: [],
      cuecSummary: { total: 0, mapped: 0, noApplicableControl: 0, pending: 0 },
      review: { state: "rejected", reviewerUserId: null, reviewerName: null, reviewedAt: null }
    });
    const buf = await buildVendorAssurancePdf(sparse);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1500);
  });

  it("yields a slugged .pdf filename", () => {
    expect(pdfDownloadFilename(makeExportBundle())).toMatch(/^acme-cloud-infrastructure-inc-2025-09-30-soc-review\.pdf$/);
  });
});
