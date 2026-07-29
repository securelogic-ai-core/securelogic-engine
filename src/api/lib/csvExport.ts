/**
 * csvExport.ts — shared RFC 4180 CSV serialization for register exports.
 *
 * Every register export (findings, risks, obligations, controls, …) must
 * escape identically or a title containing a quote breaks one export and
 * not another. findingsExport/risksExport predate this module and carry
 * local copies; new exports use this one, and the older two can migrate
 * in a cleanup pass.
 */

/** RFC 4180 cell: wrap in double quotes, escape inner quotes by doubling. */
export function csvCell(val: string | null | undefined): string {
  const s = val == null ? "" : String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

/** Date-only cell (YYYY-MM-DD) from a timestamp/date value, null-safe. */
export function csvDate(val: string | null | undefined): string | null {
  return val ? new Date(val).toISOString().slice(0, 10) : null;
}
