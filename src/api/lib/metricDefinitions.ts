/**
 * metricDefinitions.ts — the Metric Contract: ONE authoritative definition for
 * every work-metric term, shared by every aggregate endpoint.
 *
 * The operational-architecture audit found the same business words computed
 * differently per surface — "open actions" had three definitions (dashboard
 * `status='open'`; actions summary `open|in_progress|blocked`; the ring total
 * `open+in_progress`), and "overdue" mixed `NOW()` (timestamp) with
 * `CURRENT_DATE` (midnight), so a due-today action was overdue on one screen
 * and on-time on another. Dashboard tiles and their destination pages could
 * not reconcile BY CONSTRUCTION.
 *
 * This module is the single source of truth. Rules:
 *   - Aggregate endpoints (dashboard.ts, findings.ts summary, actions.ts
 *     summary) build their FILTER/WHERE fragments from here — never hand-roll
 *     a status list or an overdue predicate.
 *   - ACTIVE means "still requires work". For findings: open | in_progress
 *     (legacy axis; the derived operational axis is spec'd separately). For
 *     actions: open | in_progress | blocked — blocked work is STILL work.
 *   - OVERDUE means "active AND due_date strictly before today (CURRENT_DATE)".
 *     Date-typed due dates compare against dates, never NOW().
 *   - Fragments are compile-time constants; column names come from the const
 *     tables below (never request input) — same interpolation discipline as
 *     findingContextResolver.
 */

// ── Canonical status sets ───────────────────────────────────────────────────

/** Finding statuses that still require work (legacy axis). */
export const FINDING_ACTIVE_STATUSES = ["open", "in_progress"] as const;

/** Action statuses that still require work. Blocked work is still work. */
export const ACTION_ACTIVE_STATUSES = ["open", "in_progress", "blocked"] as const;

/** Action statuses that mean the work item is finished. */
export const ACTION_TERMINAL_STATUSES = ["closed", "accepted"] as const;

export function isFindingActive(status: string | null | undefined): boolean {
  return (FINDING_ACTIVE_STATUSES as readonly string[]).includes(status ?? "");
}

export function isActionActive(status: string | null | undefined): boolean {
  return (ACTION_ACTIVE_STATUSES as readonly string[]).includes(status ?? "");
}

// ── SQL fragments (constants in, constants out) ─────────────────────────────

function quotedList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}

/**
 * `<col> IN ('open', 'in_progress')` — the one definition of an active finding.
 * `col` is a compile-time constant at every call site (e.g. "status" or
 * "f.status"); never pass request input.
 */
export function sqlFindingActive(col = "status"): string {
  return `${col} IN (${quotedList(FINDING_ACTIVE_STATUSES)})`;
}

/** `<col> IN ('open', 'in_progress', 'blocked')` — the one definition of an active action. */
export function sqlActionActive(col = "status"): string {
  return `${col} IN (${quotedList(ACTION_ACTIVE_STATUSES)})`;
}

/**
 * Overdue finding: active AND due strictly before today. DATE comparison
 * (CURRENT_DATE), never NOW() — a due-today item is NOT overdue anywhere.
 */
export function sqlFindingOverdue(statusCol = "status", dueCol = "due_date"): string {
  return `${sqlFindingActive(statusCol)} AND ${dueCol} IS NOT NULL AND ${dueCol} < CURRENT_DATE`;
}

/** Overdue action: active AND due strictly before today (CURRENT_DATE). */
export function sqlActionOverdue(statusCol = "status", dueCol = "due_date"): string {
  return `${sqlActionActive(statusCol)} AND ${dueCol} IS NOT NULL AND ${dueCol} < CURRENT_DATE`;
}
