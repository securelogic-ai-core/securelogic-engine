/**
 * workQueues.ts — pure logic for the work-first Findings page (ERIP).
 *
 * SecureLogic is a decision-support platform, not a record browser: the primary
 * page optimizes for WORK COMPLETION. This module defines the operational queues
 * and decision buckets the page is organized around; individual findings are
 * supporting objects reached by drilling into a queue (or via entity search).
 *
 * Dependency-free (no React) so it is unit-testable without a DOM/RTL harness.
 * Reuses existing Finding fields + decisionQueue predicates — no new data model.
 */

import type { Finding, FindingsSummary } from "@/lib/api";
import { isOpenStatus, isOverdue, isUnassigned, isCriticalOpen, urgencyBucket, URGENCY_ORDER } from "./decisionQueue";

export type WorkQueueId =
  | "overdue"
  | "unassigned"
  | "needs_review"
  | "critical_open"
  | "mitigating"
  | "accepted_risk"
  | "all";

export interface WorkQueueDef {
  id: WorkQueueId;
  label: string;
  /** The question the queue answers — work framing, not record framing. */
  ask: string;
  /** Whether a non-zero count means work is due (drives urgency styling). */
  urgent: boolean;
}

/** The operational queues, most-urgent-first. `all` is the browse escape hatch. */
export const WORK_QUEUES: readonly WorkQueueDef[] = [
  { id: "overdue", label: "Overdue SLA", ask: "Past due — act or re-negotiate the date", urgent: true },
  { id: "unassigned", label: "Unassigned", ask: "No owner — assign accountability", urgent: true },
  { id: "needs_review", label: "Needs decision", ask: "No business decision yet — triage", urgent: true },
  { id: "critical_open", label: "High & Critical", ask: "Highest severity still open", urgent: true },
  { id: "mitigating", label: "In mitigation", ask: "Remediation underway — track to done", urgent: false },
  { id: "accepted_risk", label: "Accepted risk", ask: "Decisions on record — periodic review", urgent: false },
];

/** Parse a ?queue= param. `all` is the explicit browse view; unknown → null (home). */
export function workQueueFromParam(v: string | undefined): WorkQueueId | null {
  if (v === "all") return "all";
  return WORK_QUEUES.some((q) => q.id === v) ? (v as WorkQueueId) : null;
}

/** Membership predicate: does this finding belong to the queue right now? */
export function inWorkQueue(f: Finding, queue: WorkQueueId, nowMs: number): boolean {
  switch (queue) {
    case "overdue":
      return isOverdue(f, nowMs);
    case "unassigned":
      return isUnassigned(f);
    case "needs_review":
      return isOpenStatus(f.status) && (f.decision_state ?? "needs_review") === "needs_review";
    case "critical_open":
      return isCriticalOpen(f);
    case "mitigating":
      return isOpenStatus(f.status) && f.decision_state === "mitigating";
    case "accepted_risk":
      return f.decision_state === "accepted_risk";
    case "all":
      return true;
  }
}

/** Filter a findings page-load to one queue's members (server order preserved). */
export function queueMembers(findings: Finding[], queue: WorkQueueId, nowMs: number): Finding[] {
  return findings.filter((f) => inWorkQueue(f, queue, nowMs));
}

/**
 * Server-truth queue counts from the extended /findings/summary. Falls back to
 * counting the fetched page when a count is absent (older engine build) — the
 * fallback undercounts beyond the page limit but never lies about zero.
 */
export function queueCounts(
  summary: FindingsSummary | undefined,
  findings: Finding[],
  nowMs: number
): Record<Exclude<WorkQueueId, "all">, number> {
  const fallback = (q: Exclude<WorkQueueId, "all">) => queueMembers(findings, q, nowMs).length;
  return {
    overdue: summary?.overdue_open ?? fallback("overdue"),
    unassigned: summary?.unassigned_open ?? fallback("unassigned"),
    needs_review: summary?.needs_review_open ?? fallback("needs_review"),
    critical_open: (summary?.critical_open ?? 0) + (summary?.high_open ?? 0) || fallback("critical_open"),
    mitigating: summary?.mitigating_open ?? fallback("mitigating"),
    accepted_risk: summary?.accepted_risk_total ?? fallback("accepted_risk"),
  };
}

/**
 * "Next up" — the small set of most-urgent findings shown on the work-first home
 * so the top of the queue is one click away without browsing. Ordered by the
 * decisionQueue urgency buckets, then server order. Resolved findings excluded.
 */
export function nextUp(findings: Finding[], nowMs: number, limit = 5): Finding[] {
  const rank = new Map(URGENCY_ORDER.map((b, i) => [b, i]));
  return findings
    .filter((f) => isOpenStatus(f.status))
    .map((f, i) => ({ f, i, r: rank.get(urgencyBucket(f, nowMs)) ?? URGENCY_ORDER.length }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.f);
}

/** Total open work items (for the "all clear" state). */
export function openWorkCount(counts: Record<Exclude<WorkQueueId, "all">, number>): number {
  return counts.overdue + counts.unassigned + counts.needs_review + counts.critical_open + counts.mitigating;
}
