/**
 * vendorAssuranceExportData.test.ts — buildExportBundle (with mocked pg), the
 * CUEC summary precedence (decision 5 / refinement 4), and the shared formatters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy } = vi.hoisted(() => ({ pgQuerySpy: vi.fn() }));
vi.mock("../infra/postgres.js", () => ({ pg: { query: pgQuerySpy } }));

import {
  buildExportBundle,
  summarizeCuecs,
  acceptedMappings,
  isNoApplicableControl,
  fmtDateUtc,
  fmtDateTimeUtc,
  reviewStateLabel,
  exportFilenameBase,
  renderFieldValueForDisplay,
  coverStatementText,
  type VendorAssuranceCuecRow
} from "../lib/vendorAssuranceExportData.js";
import { makeExportBundle } from "./fixtures/vendorAssuranceExportBundle.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function cuecRow(p: Partial<VendorAssuranceCuecRow> & Pick<VendorAssuranceCuecRow, "id" | "ordinal" | "cuec_text">): VendorAssuranceCuecRow {
  return {
    review_status: "pending", review_status_reason: null, review_status_updated_by_user_id: null, review_status_updated_at: null,
    created_at: "2026-05-08T00:00:00Z", updated_at: "2026-05-08T00:00:00Z", mappings: [], ...p
  };
}
function acceptedMapping(): VendorAssuranceCuecRow["mappings"][number] {
  return {
    id: "m", cuec_id: "c", control_id: "ctl", mapping_status: "accepted", mapping_score: 80, mapping_source: "auto", reason: null,
    created_by_user_id: null, updated_by_user_id: null, created_at: "2026-05-08T00:00:00Z", updated_at: "2026-05-08T00:00:00Z",
    control_name: "Ctl", control_description: null, control_status: "active"
  };
}

beforeEach(() => { pgQuerySpy.mockReset(); });

describe("buildExportBundle", () => {
  it("returns null when the document does not belong to the organization", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // doc query
    const bundle = await buildExportBundle(DOC, ORG);
    expect(bundle).toBeNull();
    expect(pgQuerySpy).toHaveBeenCalledTimes(1);
  });

  it("assembles a bundle for a document with no extraction / overrides / cuecs", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: DOC, organization_id: ORG, vendor_id: "v1", uploaded_by_user_id: "u-up",
          original_filename: "report.pdf", byte_size: 1024, sha256: "abc", document_type_hint: null,
          processing_status: "approved", created_at: "2026-05-01T00:00:00Z",
          approved_at: "2026-05-02T08:00:00Z", approved_by_user_id: "u-rev", finalized_at: null, finalized_by_user_id: null,
          uploaded_by_name: "Up Loader", approved_by_name: "Re Viewer", finalized_by_name: null,
          organization_name: "Org Inc.", vendor_record_name: "Vendor LLC"
        }]
      }) // doc
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // extraction (none)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // overrides (none)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });  // cuec rows (none → loadCuecsWithMappings returns [] without the mappings query)
    const bundle = await buildExportBundle(DOC, ORG);
    expect(bundle).not.toBeNull();
    expect(bundle!.organizationName).toBe("Org Inc.");
    expect(bundle!.document.processingStatus).toBe("approved");
    expect(bundle!.document.uploadedByName).toBe("Up Loader");
    expect(bundle!.extraction).toBeNull();
    expect(bundle!.fieldOverrides).toEqual([]);
    expect(bundle!.cuecs).toEqual([]);
    expect(bundle!.cuecSummary).toEqual({ total: 0, mapped: 0, noApplicableControl: 0, pending: 0 });
    expect(bundle!.review).toEqual({ state: "approved", reviewerUserId: "u-rev", reviewerName: "Re Viewer", reviewedAt: "2026-05-02T08:00:00Z" });
    expect(bundle!.report.vendorName).toBeNull();
    // no exportedByUserId passed → no exporting-user query; no extra cuec/mapping users → no batch query.
    expect(pgQuerySpy).toHaveBeenCalledTimes(4);
  });

  it("looks up the reviewer/timestamp from the audit log for manual_review_requested", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: DOC, organization_id: ORG, vendor_id: "v1", uploaded_by_user_id: null,
          original_filename: "r.pdf", byte_size: 1, sha256: "x", document_type_hint: null,
          processing_status: "manual_review_requested", created_at: "2026-05-01T00:00:00Z",
          approved_at: null, approved_by_user_id: null, finalized_at: null, finalized_by_user_id: null,
          uploaded_by_name: null, approved_by_name: null, finalized_by_name: null,
          organization_name: "Org", vendor_record_name: null
        }]
      }) // doc
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // extraction
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // overrides
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // cuec rows
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ actor_user_id: "u-mr", created_at: "2026-05-04T12:00:00Z", actor_name: "Mr Reviewer" }] }); // audit-log lookup
    const bundle = await buildExportBundle(DOC, ORG);
    expect(bundle!.review).toEqual({ state: "manual_review_requested", reviewerUserId: "u-mr", reviewerName: "Mr Reviewer", reviewedAt: "2026-05-04T12:00:00Z" });
    const auditQuerySql = String(pgQuerySpy.mock.calls[4]![0]);
    expect(auditQuerySql).toContain("security_audit_log");
    expect(pgQuerySpy.mock.calls[4]![1]).toEqual([ORG, DOC, "vendor_assurance.document.manual_review_requested"]);
  });
});

describe("summarizeCuecs — accepted-mapping-first precedence", () => {
  it("counts mapped / no-applicable-control / pending correctly", () => {
    const rows: VendorAssuranceCuecRow[] = [
      cuecRow({ id: "a", ordinal: 1, cuec_text: "a", mappings: [acceptedMapping()] }),                                  // mapped
      cuecRow({ id: "b", ordinal: 2, cuec_text: "b", mappings: [{ ...acceptedMapping(), mapping_status: "suggested" }] }), // only suggested → pending
      cuecRow({ id: "c", ordinal: 3, cuec_text: "c", review_status: "reviewed_no_match" }),                              // no accepted + reviewed → noApplicableControl
      cuecRow({ id: "d", ordinal: 4, cuec_text: "d" }),                                                                  // pending
      // edge: reviewed_no_match BUT has an accepted mapping → accepted wins → mapped
      cuecRow({ id: "e", ordinal: 5, cuec_text: "e", review_status: "reviewed_no_match", mappings: [acceptedMapping()] })
    ];
    expect(summarizeCuecs(rows)).toEqual({ total: 5, mapped: 2, noApplicableControl: 1, pending: 2 });
  });

  it("acceptedMappings returns only accepted mappings; isNoApplicableControl requires zero accepted + reviewed flag", () => {
    const withAcceptedAndReviewed = cuecRow({ id: "e", ordinal: 1, cuec_text: "e", review_status: "reviewed_no_match", mappings: [acceptedMapping(), { ...acceptedMapping(), mapping_status: "dismissed" }] });
    expect(acceptedMappings(withAcceptedAndReviewed)).toHaveLength(1);
    expect(isNoApplicableControl(withAcceptedAndReviewed)).toBe(false);
    const reviewedOnly = cuecRow({ id: "c", ordinal: 1, cuec_text: "c", review_status: "reviewed_no_match" });
    expect(isNoApplicableControl(reviewedOnly)).toBe(true);
  });
});

describe("formatters", () => {
  it("renders dates and datetimes in UTC with an explicit suffix", () => {
    expect(fmtDateUtc("2025-09-30")).toBe("September 30, 2025");
    expect(fmtDateTimeUtc("2026-05-12T22:06:00Z")).toBe("May 12, 2026 · 22:06 UTC");
    expect(fmtDateUtc(null)).toBe("—");
    expect(fmtDateUtc("not-a-date")).toBe("not-a-date");
  });

  it("labels review states", () => {
    expect(reviewStateLabel("approved")).toBe("Approved");
    expect(reviewStateLabel("manual_review_requested")).toBe("Manual review requested");
    expect(reviewStateLabel("weird_state")).toBe("weird_state");
  });

  it("builds a slugged, dated download filename base", () => {
    const b = makeExportBundle();
    expect(exportFilenameBase(b)).toBe("acme-cloud-infrastructure-inc-2025-09-30-soc-review");
    const noPeriod = makeExportBundle({ report: { ...b.report, reportPeriodEnd: null, reportIssuedDate: "2025-11-14" } });
    expect(exportFilenameBase(noPeriod)).toBe("acme-cloud-infrastructure-inc-2025-11-14-soc-review");
  });

  it("renders material field values for display (scalars, arrays, cross-references)", () => {
    expect(renderFieldValueForDisplay("report_type", "SOC 2 Type II")).toBe("SOC 2 Type II");
    expect(renderFieldValueForDisplay("trust_services_criteria", ["Security", "Availability"])).toBe("Security; Availability");
    expect(renderFieldValueForDisplay("cuecs", ["one", "two"])).toContain("2 CUECs");
    expect(renderFieldValueForDisplay("exceptions", [{ description: "x" }])).toContain("1 exception");
    expect(renderFieldValueForDisplay("controls", [])).toBe("—");
    expect(renderFieldValueForDisplay("vendor_name", null)).toBe("—");
    // Dated scalar fields render human-formatted (like the cover), not raw ISO.
    expect(renderFieldValueForDisplay("report_issued_date", "2025-11-14")).toBe("November 14, 2025");
    expect(renderFieldValueForDisplay("report_period_start", "2024-10-01")).toBe("October 1, 2024");
    expect(renderFieldValueForDisplay("report_issued_date", "not-a-date")).toBe("not-a-date");
  });

  it("weaves the org name + report title into the cover statement", () => {
    const b = makeExportBundle();
    const s = coverStatementText(b);
    expect(s).toContain("Northwind Health Systems, Inc.");
    expect(s).toContain("SOC 2 Type II — Acme Cloud Infrastructure, Inc.");
    expect(s).toContain("auditable in the SecureLogic platform");
  });
});
