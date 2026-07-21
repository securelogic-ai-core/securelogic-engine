/**
 * decisionQueue.ts — pure logic that turns a flat findings list into an
 * enterprise decision queue (ERIP launch-readiness, PR-A). Dependency-free (no
 * React) so it is unit-testable without a DOM/RTL harness the app does not have.
 *
 * The decision-queue view answers "what requires action now?": attention tiles
 * (overdue SLA, unassigned, high/critical open) plus an urgency-ordered grouping.
 * It reuses existing Finding fields only — no engine change, no new data. It is
 * shown ONLY under SECURELOGIC_RISK_WORKSPACE_ENABLED; flag-off is the unchanged
 * domain-grouped list (byte-identical). Rows link into the Decision Workspace,
 * where per-finding business impact / affected assets / evidence live.
 */

import type { Finding } from "@/lib/api";

/**
 * ACTIVE findings are the ones that can still require action — the client-side
 * twin of the engine's sqlFindingActive() (operational_status <> 'closed').
 *
 * Expressed over the LEGACY `status` axis because that is the field the list
 * payload carries. The DB CHECK `findings_closure_axes_agree` makes the two
 * identical: status IN ('open','in_progress') ⟺ operational_status <> 'closed'.
 * ('blocked' is an Action status; a Finding can never hold it.)
 */
export function isActiveStatus(status: string): boolean {
  return status === "open" || status === "in_progress";
}

/**
 * Day-0 / first-time empty: the org has NO findings at all AND no filter is active.
 * Distinct from filtered-empty ("no findings match your filters") so the new-customer
 * experience can orient instead of dead-ending. Mirrors the Queue's isFirstTimeEmpty.
 */
export function isFirstTimeEmpty(totalCount: number, hasFilters: boolean, hasActionsOnly: boolean): boolean {
  return totalCount === 0 && !hasFilters && !hasActionsOnly;
}

/** Overdue = an ACTIVE finding past its due date. */
export function isOverdue(f: Finding, nowMs: number): boolean {
  if (!f.due_date || !isActiveStatus(f.status)) return false;
  const t = Date.parse(f.due_date);
  return Number.isFinite(t) && t < nowMs;
}

/** Unassigned = an ACTIVE finding with no owner. */
export function isUnassigned(f: Finding): boolean {
  return isActiveStatus(f.status) && !f.owner_user_id;
}

/** High-signal = an ACTIVE High/Critical finding. */
export function isCriticalActive(f: Finding): boolean {
  return isActiveStatus(f.status) && (f.severity === "Critical" || f.severity === "High");
}

export type UrgencyBucket =
  | "overdue"
  | "unassigned"
  | "critical_open"
  | "in_progress"
  | "open"
  | "resolved";

/** Most-urgent-first ordering for the grouped queue. */
export const URGENCY_ORDER: readonly UrgencyBucket[] = [
  "overdue",
  "unassigned",
  "critical_open",
  "in_progress",
  "open",
  "resolved",
];

export const URGENCY_LABELS: Record<UrgencyBucket, string> = {
  overdue: "Overdue",
  unassigned: "Unassigned",
  critical_open: "High & Critical — active",
  in_progress: "In progress",
  open: "Open",
  resolved: "Resolved / closed",
};

/**
 * Assign each finding to exactly ONE bucket — the most urgent that applies, in
 * URGENCY_ORDER. (Attention tiles below count categories independently and may
 * overlap; the grouping is exclusive so every finding appears once.)
 */
export function urgencyBucket(f: Finding, nowMs: number): UrgencyBucket {
  if (!isActiveStatus(f.status)) return "resolved";
  if (isOverdue(f, nowMs)) return "overdue";
  if (isUnassigned(f)) return "unassigned";
  if (isCriticalActive(f)) return "critical_open";
  if (f.status === "in_progress") return "in_progress";
  return "open";
}

export type AttentionSummary = {
  overdue: number;
  unassigned: number;
  criticalOpen: number;
  openTotal: number;
};

/**
 * Counts for the "what needs attention now" tiles. Categories are INDEPENDENT
 * (a finding can be both overdue and unassigned), unlike the exclusive grouping.
 */
export function attentionSummary(findings: Finding[], nowMs: number): AttentionSummary {
  let overdue = 0;
  let unassigned = 0;
  let criticalOpen = 0;
  let openTotal = 0;
  for (const f of findings) {
    if (isActiveStatus(f.status)) openTotal++;
    if (isOverdue(f, nowMs)) overdue++;
    if (isUnassigned(f)) unassigned++;
    if (isCriticalActive(f)) criticalOpen++;
  }
  return { overdue, unassigned, criticalOpen, openTotal };
}

/**
 * Group findings into urgency buckets, ordered most-urgent-first, dropping empty
 * buckets. Within a bucket, findings keep their incoming (server) order.
 */
export function groupByUrgency(
  findings: Finding[],
  nowMs: number,
): Array<{ bucket: UrgencyBucket; label: string; findings: Finding[] }> {
  const map = new Map<UrgencyBucket, Finding[]>();
  for (const f of findings) {
    const b = urgencyBucket(f, nowMs);
    (map.get(b) ?? map.set(b, []).get(b)!).push(f);
  }
  return URGENCY_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
    bucket: b,
    label: URGENCY_LABELS[b],
    findings: map.get(b)!,
  }));
}
