/**
 * vendorFrameworkProgress (lib) — the pure projection behind
 * GET /api/vendors/:id/framework-progress. Kept free of any database import so
 * it is unit-testable without a DATABASE_URL; the route owns the query.
 */
import { assessmentProgress } from "./frameworkCoverage.js";

export type VendorFrameworkProgressRow = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  total: string;
  pass: string;
  partial: string;
  fail: string;
  last_response_at: Date | string | null;
};

export type VendorFrameworkProgressEntry = {
  framework: { id: string; name: string; version: string };
  summary: {
    total: number;
    pass: number;
    partial: number;
    fail: number;
    not_assessed: number;
    /** 0–100 completion share — assessment progress, never readiness (O-5). */
    progress_pct: number;
    last_response_at: string | null;
  };
};

/** Pure projection of a query row into the response shape (unit-testable). */
export function projectProgressRow(row: VendorFrameworkProgressRow): VendorFrameworkProgressEntry {
  const total = Number(row.total);
  const pass = Number(row.pass);
  const partial = Number(row.partial);
  const fail = Number(row.fail);
  const assessed = pass + partial + fail;
  const last =
    row.last_response_at === null
      ? null
      : new Date(row.last_response_at as unknown as string).toISOString();
  return {
    framework: { id: row.framework_id, name: row.framework_name, version: row.framework_version },
    summary: {
      total,
      pass,
      partial,
      fail,
      not_assessed: total - assessed,
      progress_pct: assessmentProgress(assessed, total),
      last_response_at: last,
    },
  };
}
