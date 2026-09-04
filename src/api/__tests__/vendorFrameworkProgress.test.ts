/**
 * projectProgressRow — the aggregate's per-row projection agrees with the
 * requirements route's summary arithmetic (not_assessed = total − assessed,
 * progress_pct from assessmentProgress, ISO last_response_at or null).
 */
import { describe, expect, it } from "vitest";
import { projectProgressRow } from "../routes/vendorFrameworkProgress.js";

describe("projectProgressRow", () => {
  it("counts a stored not_assessed as unassessed and derives progress from pass+partial+fail", () => {
    const entry = projectProgressRow({
      framework_id: "fw-1", framework_name: "SOC 2", framework_version: "2017",
      total: "4", pass: "2", partial: "0", fail: "1",
      last_response_at: new Date("2026-09-04T10:00:00.000Z"),
    });
    expect(entry.framework).toEqual({ id: "fw-1", name: "SOC 2", version: "2017" });
    expect(entry.summary).toEqual({
      total: 4, pass: 2, partial: 0, fail: 1, not_assessed: 1, progress_pct: 75,
      last_response_at: "2026-09-04T10:00:00.000Z",
    });
  });

  it("no responses yet → 0% and a null timestamp (bigint counts arrive as strings)", () => {
    const entry = projectProgressRow({
      framework_id: "fw-2", framework_name: "NIST CSF", framework_version: "2.0",
      total: "10", pass: "0", partial: "0", fail: "0", last_response_at: null,
    });
    expect(entry.summary).toMatchObject({ total: 10, not_assessed: 10, progress_pct: 0, last_response_at: null });
  });
});
