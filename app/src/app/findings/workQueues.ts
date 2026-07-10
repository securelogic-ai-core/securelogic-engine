/**
 * workQueues.ts — pure logic for the Findings operations center (ERIP).
 *
 * SecureLogic customers manage WORK, not records: the landing experience is a set
 * of decision buckets — workflow work (Needs Assignment, SLA Breached, Needs
 * Decision, Awaiting Approval, Review Suggested Links) and risk-domain work
 * (Active Exploitation, Regulatory Impact, AI Risk, Third-Party Risk). Clicking a
 * bucket opens a SUBORDINATE, SERVER-FILTERED findings view (or the owning
 * surface: /approvals, /queue). Counts are server truth from /findings/summary —
 * never client-side filtering of a page, so buckets stay correct at 20k findings.
 *
 * Dependency-free (no React) so it is unit-testable without a DOM/RTL harness.
 * No new data model: buckets map onto existing fields, the risk lifecycle
 * (risk_approvals), the matcher queue, and the intelligence pipeline's
 * exploitation evidence.
 */

import type { FindingsSummary, FindingsParams } from "@/lib/api";

export type OpsBucketId =
  | "needs_assignment"
  | "sla_breached"
  | "needs_decision"
  | "awaiting_approval"
  | "review_links"
  | "active_exploitation"
  | "regulatory"
  | "ai_risk"
  | "third_party"
  | "in_mitigation"
  | "accepted_risk";

export type OpsBucketGroup = "decisions" | "domains" | "tracking";

export interface OpsBucketDef {
  id: OpsBucketId;
  label: string;
  /** The work the bucket represents — decision framing, not record framing. */
  ask: string;
  group: OpsBucketGroup;
  /** Non-zero count means work is due now (drives urgency styling). */
  urgent: boolean;
  /**
   * Where the bucket opens. `findings` buckets open the subordinate findings view
   * with SERVER-side filters; `href` buckets open the surface that owns that work.
   */
  target: { kind: "findings"; params: FindingsParams } | { kind: "href"; href: string };
}

/** The operations-center buckets, grouped. Order within a group = display order. */
export const OPS_BUCKETS: readonly OpsBucketDef[] = [
  // ── Decision work ─────────────────────────────────────────────
  { id: "sla_breached", label: "SLA Breached", ask: "Past the committed date — act or renegotiate", group: "decisions", urgent: true, target: { kind: "findings", params: { overdue: true } } },
  { id: "needs_assignment", label: "Needs Assignment", ask: "No accountable owner yet", group: "decisions", urgent: true, target: { kind: "findings", params: { unassigned: true } } },
  { id: "needs_decision", label: "Needs Decision", ask: "No business decision recorded — triage", group: "decisions", urgent: true, target: { kind: "findings", params: { decision_state: "needs_review", status: "open" } } },
  { id: "awaiting_approval", label: "Awaiting Approval", ask: "Risk treatments pending executive sign-off", group: "decisions", urgent: true, target: { kind: "href", href: "/approvals" } },
  { id: "review_links", label: "Review Suggested Links", ask: "Intelligence matched your entities — confirm or dismiss", group: "decisions", urgent: true, target: { kind: "href", href: "/queue" } },
  // ── Risk domains ──────────────────────────────────────────────
  { id: "active_exploitation", label: "Active Exploitation", ask: "Exploitation observed in the wild — highest urgency", group: "domains", urgent: true, target: { kind: "findings", params: { exploited: true } } },
  { id: "regulatory", label: "Regulatory Impact", ask: "Compliance obligations exposed", group: "domains", urgent: false, target: { kind: "findings", params: { domain: "Regulatory" } } },
  { id: "ai_risk", label: "AI Risk", ask: "AI systems under governance exposure", group: "domains", urgent: false, target: { kind: "findings", params: { domain: "AI Governance" } } },
  { id: "third_party", label: "Third-Party Risk", ask: "Vendor and supply-chain exposure", group: "domains", urgent: false, target: { kind: "findings", params: { domain: "Vendor Risk" } } },
  // ── Tracking ──────────────────────────────────────────────────
  { id: "in_mitigation", label: "In Mitigation", ask: "Remediation underway — track to done", group: "tracking", urgent: false, target: { kind: "findings", params: { decision_state: "mitigating" } } },
  { id: "accepted_risk", label: "Accepted Risk", ask: "Decisions on record — periodic review", group: "tracking", urgent: false, target: { kind: "findings", params: { decision_state: "accepted_risk" } } },
];

export const OPS_GROUP_LABELS: Record<OpsBucketGroup, string> = {
  decisions: "Decision work",
  domains: "Risk domains",
  tracking: "Tracking",
};

export function opsBucket(id: string | undefined): OpsBucketDef | null {
  return OPS_BUCKETS.find((b) => b.id === id) ?? null;
}

/** Buckets in display order for one group. */
export function bucketsInGroup(group: OpsBucketGroup): OpsBucketDef[] {
  return OPS_BUCKETS.filter((b) => b.group === group);
}

/** The /findings URL that opens a bucket's subordinate view (or the owning surface). */
export function bucketHref(b: OpsBucketDef): string {
  return b.target.kind === "href" ? b.target.href : `/findings?bucket=${b.id}`;
}

/** The server-side list params for a findings bucket (null for href buckets). */
export function bucketListParams(b: OpsBucketDef): FindingsParams | null {
  return b.target.kind === "findings" ? { ...b.target.params, limit: 100 } : null;
}

export interface OpsCounts {
  counts: Record<OpsBucketId, number>;
  /** Ids whose count came from a missing summary field (shown as em-dash, never a fake 0). */
  unknown: OpsBucketId[];
}

/**
 * Server-truth counts for every bucket from the extended /findings/summary (+ the
 * matcher queue's pending total). A missing field (older engine) is reported as
 * UNKNOWN rather than a lying zero.
 */
export function opsCounts(
  summary: FindingsSummary | undefined,
  pendingSuggestions: number | null
): OpsCounts {
  const counts = {} as Record<OpsBucketId, number>;
  const unknown: OpsBucketId[] = [];
  const take = (id: OpsBucketId, v: number | null | undefined) => {
    if (typeof v === "number") counts[id] = v;
    else {
      counts[id] = 0;
      unknown.push(id);
    }
  };
  take("sla_breached", summary?.overdue_open);
  take("needs_assignment", summary?.unassigned_open);
  take("needs_decision", summary?.needs_review_open);
  take("awaiting_approval", summary?.pending_risk_approvals);
  take("review_links", pendingSuggestions);
  take("active_exploitation", summary?.exploited_open);
  take("regulatory", summary?.regulatory_open);
  take("ai_risk", summary?.ai_governance_open);
  take("third_party", summary?.vendor_risk_open);
  take("in_mitigation", summary?.mitigating_open);
  take("accepted_risk", summary?.accepted_risk_total);
  return { counts, unknown };
}

/** Total items of due decision work (drives the all-clear state). */
export function dueWorkCount(c: Record<OpsBucketId, number>): number {
  return OPS_BUCKETS.filter((b) => b.urgent).reduce((n, b) => n + (c[b.id] ?? 0), 0);
}
