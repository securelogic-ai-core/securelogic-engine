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

/** Open findings are the ones that can still require action. */
export function isOpenStatus(status: string): boolean {
  return status === "open" || status === "in_progress";
}

/** Overdue = an open finding past its due date. */
export function isOverdue(f: Finding, nowMs: number): boolean {
  if (!f.due_date || !isOpenStatus(f.status)) return false;
  const t = Date.parse(f.due_date);
  return Number.isFinite(t) && t < nowMs;
}

/** Unassigned = an open finding with no owner. */
export function isUnassigned(f: Finding): boolean {
  return isOpenStatus(f.status) && !f.owner_user_id;
}

/** High-signal = an open High/Critical finding. */
export function isCriticalOpen(f: Finding): boolean {
  return isOpenStatus(f.status) && (f.severity === "Critical" || f.severity === "High");
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
  critical_open: "High & Critical — open",
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
  if (!isOpenStatus(f.status)) return "resolved";
  if (isOverdue(f, nowMs)) return "overdue";
  if (isUnassigned(f)) return "unassigned";
  if (isCriticalOpen(f)) return "critical_open";
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
    if (isOpenStatus(f.status)) openTotal++;
    if (isOverdue(f, nowMs)) overdue++;
    if (isUnassigned(f)) unassigned++;
    if (isCriticalOpen(f)) criticalOpen++;
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
