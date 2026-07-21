/**
 * findingsQueueOrdering.ts — pure SQL-fragment builders for the scalable Risk
 * Findings queue (search / filter / sort / due-status).
 *
 * Same interpolation discipline as metricDefinitions.ts and findingEntitySearch:
 * every value that reaches a fragment here is a COMPILE-TIME CONSTANT (column
 * names default to the `f`-aliased findings columns; the sort/due keys are
 * validated against the Sets below before use). Request input is NEVER
 * interpolated — it is bound as a parameter by the caller.
 *
 * The due-status buckets and the urgency ordering reuse the Metric Contract
 * predicates (sqlFindingActive / sqlFindingOverdue) so "overdue" and "active"
 * mean exactly what every other surface means. Dates compare against
 * CURRENT_DATE (midnight), never NOW() — a due-today finding is NOT overdue.
 */

import { sqlFindingActive, sqlFindingOverdue } from "./metricDefinitions.js";

/**
 * "Due soon" window, in days after today (exclusive of today itself, which is
 * its own bucket). Matches the client card's `days <= 7` urgency treatment so
 * the server order and the card label agree.
 */
export const DUE_SOON_DAYS = 7;

/** The queue's due-status filter values. */
export const DUE_STATUSES = ["overdue", "today", "soon", "none"] as const;
export type DueStatus = (typeof DUE_STATUSES)[number];
export const VALID_DUE_STATUSES: ReadonlySet<string> = new Set(DUE_STATUSES);

/** The queue's user-facing sort modes (the legacy keyset `created` is separate). */
export const QUEUE_SORTS = ["urgency", "severity", "due_date", "newest", "oldest"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];
export const VALID_QUEUE_SORTS: ReadonlySet<string> = new Set(QUEUE_SORTS);

/** Default column handles (the list route aliases findings as `f`). */
export interface QueueColumns {
  operationalCol: string;
  dueCol: string;
  severityCol: string;
  createdCol: string;
  idCol: string;
}

export const DEFAULT_QUEUE_COLUMNS: QueueColumns = {
  operationalCol: "f.operational_status",
  dueCol: "f.due_date",
  severityCol: "f.severity",
  createdCol: "f.created_at",
  idCol: "f.id",
};

/** `CASE <sev> WHEN 'Critical' THEN 0 … END` — Critical highest urgency (0). */
function severityRank(col: string): string {
  return `CASE ${col} WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Moderate' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END`;
}

/** Active AND due within [today, today + DUE_SOON_DAYS] — the "due today / due soon" tier. */
function dueTodayOrSoon(operationalCol: string, dueCol: string): string {
  return (
    `${sqlFindingActive(operationalCol)} AND ${dueCol} IS NOT NULL ` +
    `AND ${dueCol} >= CURRENT_DATE AND ${dueCol} <= CURRENT_DATE + INTERVAL '${DUE_SOON_DAYS} days'`
  );
}

/**
 * The SQL predicate for one due-status bucket. Buckets are mutually exclusive
 * (overdue < today < soon < none), so a `due` filter selects a clean partition.
 * `overdue` and `soon` are also gated on ACTIVE (a closed finding is never in an
 * SLA queue); `today` and `none` are pure date facts.
 */
export function dueStatusCondition(
  bucket: DueStatus,
  cols: QueueColumns = DEFAULT_QUEUE_COLUMNS
): string {
  const { operationalCol, dueCol } = cols;
  switch (bucket) {
    case "overdue":
      return sqlFindingOverdue(operationalCol, dueCol);
    case "today":
      return `${dueCol} = CURRENT_DATE`;
    case "soon":
      return (
        `${sqlFindingActive(operationalCol)} AND ${dueCol} IS NOT NULL ` +
        `AND ${dueCol} > CURRENT_DATE AND ${dueCol} <= CURRENT_DATE + INTERVAL '${DUE_SOON_DAYS} days'`
      );
    case "none":
      return `${dueCol} IS NULL`;
  }
}

/**
 * The ORDER BY body (no leading "ORDER BY") for a queue sort mode. Every mode
 * ends in a deterministic (created_at, id) tiebreak so OFFSET paging is stable.
 *
 * `urgency` (the queue default) implements the ratified order:
 *   1 overdue · 2 due today/soon · 3 critical · 4 high · 5 nearest due · 6 oldest
 */
export function queueOrderBy(
  sort: QueueSort,
  cols: QueueColumns = DEFAULT_QUEUE_COLUMNS
): string {
  const { operationalCol, dueCol, severityCol, createdCol, idCol } = cols;
  switch (sort) {
    case "urgency":
      return [
        // Active (unresolved) work always precedes closed — the queue is a
        // triage surface; a closed finding never outranks live work.
        `(CASE WHEN ${sqlFindingActive(operationalCol)} THEN 0 ELSE 1 END)`,
        `(CASE WHEN ${sqlFindingOverdue(operationalCol, dueCol)} THEN 0 ELSE 1 END)`,
        `(CASE WHEN ${dueTodayOrSoon(operationalCol, dueCol)} THEN 0 ELSE 1 END)`,
        severityRank(severityCol),
        `${dueCol} ASC NULLS LAST`,
        `${createdCol} ASC`,
        `${idCol} ASC`,
      ].join(", ");
    case "severity":
      return `${severityRank(severityCol)}, ${createdCol} DESC, ${idCol} DESC`;
    case "due_date":
      return `${dueCol} ASC NULLS LAST, ${createdCol} ASC, ${idCol} ASC`;
    case "newest":
      return `${createdCol} DESC, ${idCol} DESC`;
    case "oldest":
      return `${createdCol} ASC, ${idCol} ASC`;
  }
}
