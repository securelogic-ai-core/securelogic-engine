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
 *   - ACTIVE means "still requires work". For findings: operational_status
 *     <> 'closed' (the authoritative axis — product ruling 2026-07-12; the
 *     legacy `status` predicate is retained only as a compat/migration proof).
 *     Remediated findings are ACTIVE: the work is done but not yet validated.
 *     For actions: open | in_progress | blocked — blocked work is STILL work.
 *   - OVERDUE means "active AND due_date strictly before today (CURRENT_DATE)".
 *     Date-typed due dates compare against dates, never NOW().
 *   - Fragments are compile-time constants; column names come from the const
 *     tables below (never request input) — same interpolation discipline as
 *     findingContextResolver.
 */

// ── Canonical status sets ───────────────────────────────────────────────────

/**
 * LEGACY finding statuses that still require work. Retained ONLY for the compat
 * axis and its tests. The authoritative definition is now the operational one
 * below — do not build new predicates from this.
 */
export const FINDING_ACTIVE_STATUSES = ["open", "in_progress"] as const;

/**
 * The one terminal state of the authoritative operational axis.
 *
 * ACTIVE FINDING = operational_status <> 'closed'   (product ruling 2026-07-12)
 *
 * Everything else is Active, INCLUDING `remediated` — remediation completed but
 * awaiting validation/governance closure is still live work, and a surface that
 * drops it would tell a customer the work is done when nobody has validated it.
 */
export const FINDING_CLOSED_STATUS = "closed" as const;

/** Action statuses that still require work. Blocked work is still work. */
export const ACTION_ACTIVE_STATUSES = ["open", "in_progress", "blocked"] as const;

/** Action statuses that mean the work item is finished. */
export const ACTION_TERMINAL_STATUSES = ["closed", "accepted"] as const;

/**
 * Decision-axis states that mean governance has reached a TERMINAL call — the finding
 * is no longer awaiting a human decision. `resolved` closes it; `accepted_risk` closes it
 * via the accepted-risk path. A finding at `remediated` whose decision_state is NOT one of
 * these is awaiting the governance decision (finding-lifecycle-spec §1.3).
 */
export const DECISION_TERMINAL_STATES = ["resolved", "accepted_risk"] as const;

/**
 * Risk statuses that mean the risk is off the books. An ACTIVE risk is anything
 * else — the register's own framing ("open risks"), which includes accepted and
 * mitigating risks because they are still carried.
 */
export const RISK_TERMINAL_STATUSES = ["closed", "transferred"] as const;

/**
 * Is this finding Active? Takes the OPERATIONAL status (the authoritative axis).
 * Anything that is not 'closed' is Active — remediated included.
 *
 * A null/absent operational_status is treated as Active, not inactive: absence of
 * evidence of closure is not evidence of closure, and a resolver failure must
 * never silently retire a live finding from the count.
 */
export function isFindingActive(operationalStatus: string | null | undefined): boolean {
  return operationalStatus !== FINDING_CLOSED_STATUS;
}

/** The legacy predicate, kept for the compat axis only. Do not use for metrics. */
export function isFindingActiveLegacyStatus(status: string | null | undefined): boolean {
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
 * `<col> <> 'closed'` — THE definition of an Active Finding (ruling 2026-07-12).
 *
 * `col` is the OPERATIONAL axis (operational_status), not the legacy `status`.
 * It is a compile-time constant at every call site (e.g. "operational_status" or
 * "f.operational_status"); never pass request input.
 *
 * Why `<> 'closed'` and not an IN-list of the active states: an IN-list has to be
 * updated every time the lifecycle grows a state, and the day someone adds one
 * and forgets, that state silently vanishes from every count in the product. The
 * negative predicate fails safe — a new operational state is Active until someone
 * deliberately decides it is closure.
 *
 * NOT NULL in the schema (default 'open'), so no null-guard is needed here.
 */
export function sqlFindingActive(col = "operational_status"): string {
  return `${col} <> '${FINDING_CLOSED_STATUS}'`;
}

/**
 * The LEGACY compat predicate over `status`. Retained so the migration can prove
 * the two axes select the identical population; not for product metrics.
 */
export function sqlFindingActiveLegacyStatus(col = "status"): string {
  return `${col} IN (${quotedList(FINDING_ACTIVE_STATUSES)})`;
}

/**
 * `<col> = 'closed'` — the complement of Active, on the SAME axis.
 *
 * Exists because the complement kept getting hand-rolled as `status != 'open'`,
 * which counts an in_progress finding as CLOSED — work in flight reported as
 * work done. Closed is the one terminal state; deriving it from the same
 * constant as sqlFindingActive() makes Active + Closed exhaustive by
 * construction, so the two can never drift apart again.
 */
export function sqlFindingClosed(col = "operational_status"): string {
  return `${col} = '${FINDING_CLOSED_STATUS}'`;
}

/**
 * `<col> = 'open'` — STRICTLY OPEN: untouched work, nobody has started it.
 *
 * This is a genuine LIFECYCLE filter and a legitimate thing to ask for ("what
 * has nobody picked up yet?"). It is NOT the enterprise population and must
 * never back an enterprise metric — a Critical finding under active remediation
 * is still a Critical finding, and a tile built on this predicate empties itself
 * the moment someone starts working, rewarding inaction.
 *
 * Deliberately on the LEGACY axis: `open` is a legacy-status value, and the
 * operational axis's own `open` is derived from the linked Actions rather than
 * being the user-facing lifecycle state. The DB CHECK `findings_closure_axes_agree`
 * keeps the two consistent.
 */
export function sqlFindingStrictlyOpen(col = "status"): string {
  return `${col} = 'open'`;
}

/** `<col> IN ('open', 'in_progress', 'blocked')` — the one definition of an active action. */
export function sqlActionActive(col = "status"): string {
  return `${col} IN (${quotedList(ACTION_ACTIVE_STATUSES)})`;
}

/**
 * Pending Independent Review / ready-for-decision: remediation is DERIVED complete
 * (`operational_status = 'remediated'`) but no terminal governance decision has been made
 * (`decision_state NOT IN ('resolved','accepted_risk')`). This is the "ready-for-decision"
 * population from finding-lifecycle-spec §1.3; it is ALSO the independent-governance-review
 * population when the org enforces `require_finding_closure_sod`.
 *
 * THE single definition — previously copied inline in the /findings list filter and the
 * /findings/summary count. Both operational and decision columns are compile-time constants
 * at every call site (e.g. "operational_status" / "f.operational_status"); never request input.
 */
export function sqlFindingPendingIndependentReview(
  operationalCol = "operational_status",
  decisionCol = "decision_state"
): string {
  return `${operationalCol} = 'remediated' AND ${decisionCol} NOT IN (${quotedList(
    DECISION_TERMINAL_STATES
  )})`;
}

/**
 * `<col> NOT IN ('closed', 'transferred')` — the one definition of an active risk,
 * i.e. a risk still on the register. The dashboard tile already counted this; the
 * /risks list applied NO status filter at all, so the destination listed closed and
 * transferred risks under a tile that promised open ones.
 */
export function sqlRiskActive(col = "status"): string {
  return `${col} NOT IN (${quotedList(RISK_TERMINAL_STATUSES)})`;
}

/**
 * Overdue finding: ACTIVE (operational axis) AND due strictly before today. DATE
 * comparison (CURRENT_DATE), never NOW() — a due-today item is NOT overdue anywhere.
 */
export function sqlFindingOverdue(
  operationalCol = "operational_status",
  dueCol = "due_date"
): string {
  return `${sqlFindingActive(operationalCol)} AND ${dueCol} IS NOT NULL AND ${dueCol} < CURRENT_DATE`;
}

/** Overdue action: active AND due strictly before today (CURRENT_DATE). */
export function sqlActionOverdue(statusCol = "status", dueCol = "due_date"): string {
  return `${sqlActionActive(statusCol)} AND ${dueCol} IS NOT NULL AND ${dueCol} < CURRENT_DATE`;
}

/**
 * Overdue obligation: ACTIVE (waived / not_applicable are decided — a decided
 * obligation cannot be overdue) AND due strictly before today. DATE comparison
 * (CURRENT_DATE), never NOW() — a due-today obligation is NOT overdue anywhere.
 */
export function sqlObligationOverdue(statusCol = "status", dueCol = "due_date"): string {
  return `${statusCol} = 'active' AND ${dueCol} IS NOT NULL AND ${dueCol} < CURRENT_DATE`;
}

// ── Vendor assessment state ─────────────────────────────────────────────────

/**
 * ASSESSED VENDOR = at least one row in vendor_assessments for that vendor in
 * that org.  (product ruling 2026-08-09)
 *
 * This module exists because the same business word was computed differently
 * per surface. "Assessed" had reached THREE definitions:
 *   * ≥1 row in vendor_assessments        — /vendors, /vendors/risk
 *   * last_reviewed_at IS NOT NULL        — the legacy ?reviewed=never filter
 *   * current_risk_score IS NOT NULL      — ask.ts
 *
 * Only the first is ratified. The second reads a column NOTHING in the product
 * writes, so it reported effectively every vendor as unreviewed. The third
 * counts a SCORE: `GET /api/vendors/:id/risk-score` computes and persists one
 * on demand, so a vendor nobody has ever assessed acquires a risk score and
 * starts counting as assessed.
 *
 * No status, type, or recency qualifier is implied — GET /api/vendor-assessments
 * applies none, so neither does this. A cadence-based "due for review" filter is
 * a separate product concept and is deliberately NOT expressible here.
 *
 * Org scoping lives INSIDE the correlation, not merely on the outer query: the
 * subquery would otherwise be free to see another tenant's assessment rows even
 * though the vendor it hangs off is correctly scoped.
 */
export function sqlVendorAssessmentScope(
  vendorTable = "vendors",
  va = "va"
): string {
  return `FROM vendor_assessments ${va}
   WHERE ${va}.vendor_id = ${vendorTable}.id
     AND ${va}.organization_id = ${vendorTable}.organization_id`;
}

/** `EXISTS (…)` — the vendor has been assessed at least once. */
export function sqlVendorAssessed(vendorTable = "vendors", va = "va"): string {
  return `EXISTS (SELECT 1 ${sqlVendorAssessmentScope(vendorTable, va)})`;
}

/**
 * `NOT EXISTS (…)` — the vendor has never been assessed. The complement of
 * sqlVendorAssessed on the SAME axis, derived from the same scope, so the two
 * are exhaustive by construction.
 *
 * Surfaces that print a count of this population AND link to a list of it
 * (the "Never assessed" pill on /vendors) must build both from this function.
 * An authoritative count that navigates to a differently-defined list is worse
 * than a capped count: both halves look equally trustworthy.
 */
export function sqlVendorNeverAssessed(vendorTable = "vendors", va = "va"): string {
  return `NOT EXISTS (SELECT 1 ${sqlVendorAssessmentScope(vendorTable, va)})`;
}

// ── Finding provenance groupings ────────────────────────────────────────────
//
// "How many of my findings came from vendor work / from external intelligence?"
// is a question several surfaces answer, and each one that hand-rolls its own
// source_type list drifts the moment a new type is added to the DB CHECK.
// Ask did exactly that: it counted `source_type = 'vendor_review'` and
// `source_type = 'signal'` as if those were the whole story, so vendor review
// CYCLES and every finding the matcher wrote as 'cyber_signal' — plus the newer
// 'intelligence_event' — were silently reported as zero.
//
// Keep these in lockstep with FINDING_SOURCE_TYPES (findingValidation.ts) and
// the findings_source_type_check CHECK constraint.

/** Findings that originated in a vendor assessment or review workflow. */
export const VENDOR_SOURCED_FINDING_TYPES = [
  "vendor_review",        // point-in-time vendor_assessments
  "vendor_cycle_review"   // mutable vendor_reviews cycles
] as const;

/** Findings that originated in the external-intelligence pipeline. */
export const SIGNAL_SOURCED_FINDING_TYPES = [
  "signal",              // legacy matcher write
  "cyber_signal",        // current matcher dual-write
  "intelligence_event"   // normalized event projection
] as const;

function sqlInList(col: string, values: readonly string[]): string {
  return `${col} IN (${values.map((v) => `'${v}'`).join(", ")})`;
}

/** SQL predicate: the finding came from a vendor workflow. */
export function sqlFindingVendorSourced(col = "source_type"): string {
  return sqlInList(col, VENDOR_SOURCED_FINDING_TYPES);
}

/** SQL predicate: the finding came from the intelligence pipeline. */
export function sqlFindingSignalSourced(col = "source_type"): string {
  return sqlInList(col, SIGNAL_SOURCED_FINDING_TYPES);
}

// ── Vendor-assurance document review state ──────────────────────────────────

/**
 * The terminal states meaning A HUMAN HAS ACCEPTED THIS EXTRACTION.
 *
 * TWO values, not one, and that is the whole point. Migration 20260612
 * (`vendor_assurance_document_presentation`) replaced the per-field
 * Accept/Edit/Reject + Finalize flow with a document-level review whose accept
 * state is `approved`; its own comment records that "no new code path writes
 * 'finalized'". But `finalized` stayed a legal value for the rows written
 * before that change, and those rows are real customer review decisions.
 *
 * So "reviewed" is `approved OR finalized`, and any surface that wants "the
 * latest reviewed assurance document" MUST use this set. Hardcoding either
 * value alone is a defect in one direction or the other:
 *   - `finalized` alone  → the surface is dead for every org on the current
 *     flow (this was the live bug on /vendors/[id]: the card queried
 *     `status: "finalized"`, which nothing writes, so it rendered the empty
 *     state forever after a reviewer approved a SOC report);
 *   - `approved` alone   → legacy reviewed documents silently disappear.
 */
export const ASSURANCE_REVIEWED_STATUSES = ["approved", "finalized"] as const;

/** True when a document's processing_status means a human accepted the extraction. */
export function isAssuranceReviewed(processingStatus: string | null | undefined): boolean {
  return (ASSURANCE_REVIEWED_STATUSES as readonly string[]).includes(
    processingStatus ?? ""
  );
}

/**
 * SQL predicate for the reviewed population. Compile-time constant — the column
 * name comes from the caller's own literal, never from request input.
 */
export function sqlAssuranceReviewed(col = "processing_status"): string {
  const list = ASSURANCE_REVIEWED_STATUSES.map((s) => `'${s}'`).join(", ");
  return `${col} IN (${list})`;
}
