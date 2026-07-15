/**
 * findingLifecycleVocab.tsx — the ONE canonical vocabulary for a finding's two
 * lifecycle axes, shared by every findings surface (operations center, My Work
 * cards, Ready-to-Close queue, Decision Workspace).
 *
 * Before this module the human labels for `decision_state` and
 * `operational_status` were re-declared per screen (DecisionWorkspace,
 * workQueues, BulkBucketList) and drifted. The walkthrough surfaced the cost: a
 * customer could not tell governance state ("Accepted Risk") from operational
 * state ("In Mitigation"), and ambiguous "Resolve" controls implied an immediate
 * close. This module fixes the words in one place.
 *
 * The two axes are ORTHOGONAL and must never be collapsed (CANONICAL_DOMAIN_MODEL
 * §"Two-axis model"):
 *   - operational_status  — SYSTEM-DERIVED from linked Actions: open | in_progress
 *                           | remediated | closed. "Operational Status" axis.
 *   - decision_state      — HUMAN-GOVERNED: needs_review | mitigating |
 *                           accepted_risk | resolved. "Governance Decision" axis.
 *
 * Presentational only (no hooks, no I/O) so it is usable from both server and
 * client components.
 */

import type React from "react";

// ── Axis names (DW-1) ───────────────────────────────────────────────────────

/** The human-governed axis. Was labeled the ambiguous "Decision" in the UI. */
export const GOVERNANCE_AXIS_LABEL = "Governance Decision";
/** The system-derived axis. Previously an unlabeled chip / a bare "Status". */
export const OPERATIONAL_AXIS_LABEL = "Operational Status";

// ── Canonical labels ────────────────────────────────────────────────────────

/** decision_state → human label (governance axis). */
export const DECISION_STATE_LABELS: Record<string, string> = {
  needs_review: "Needs Review",
  mitigating: "Mitigating",
  accepted_risk: "Accepted Risk",
  resolved: "Resolved",
};

/**
 * operational_status → human label (operational axis). Deliberately verbal
 * ("Remediation complete", not "Remediated") so a non-engineer reads state, and
 * so it can never be mistaken for the governance decision.
 */
export const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  open: "Work not started",
  in_progress: "Work in progress",
  remediated: "Remediation complete",
  closed: "Closed",
};

/** A one-line meaning for each governance state (tooltips / secondary copy). */
export const DECISION_STATE_MEANINGS: Record<string, string> = {
  needs_review: "No governance decision recorded yet — this finding needs a risk-treatment decision.",
  mitigating: "A remediation plan is accepted and underway.",
  accepted_risk: "Leadership formally accepted this risk — an audited governance override.",
  resolved: "Closed by a governance decision. The only terminal state.",
};

export function decisionStateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return DECISION_STATE_LABELS[value] ?? value;
}

export function operationalStatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return OPERATIONAL_STATUS_LABELS[value] ?? value;
}

// ── Badges ──────────────────────────────────────────────────────────────────

const DECISION_STYLES: Record<string, React.CSSProperties> = {
  needs_review: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  mitigating: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  accepted_risk: { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
  resolved: { background: "rgba(34,197,94,0.15)", color: "#86efac" },
};

const OPERATIONAL_STYLES: Record<string, React.CSSProperties> = {
  open: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  in_progress: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  remediated: { background: "rgba(0,196,180,0.12)", color: "#00c4b4" },
  closed: { background: "rgba(34,197,94,0.12)", color: "#86efac" },
};

const CHIP =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium";

/**
 * Governance-decision badge. Prefixed "Governance:" so it can never be read as
 * an operational state on a dense card (F-3 / MW-3).
 */
export function GovernanceStateBadge({
  value,
  showAxis = true,
}: {
  value: string | null | undefined;
  showAxis?: boolean;
}) {
  if (!value) return null;
  const style = DECISION_STYLES[value] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  return (
    <span className={CHIP} style={style} title={DECISION_STATE_MEANINGS[value] ?? undefined}>
      {showAxis && <span style={{ opacity: 0.7, fontWeight: 600 }}>Governance:</span>}
      {decisionStateLabel(value)}
    </span>
  );
}

/** Operational-status badge (the system-derived axis). */
export function OperationalStateBadge({
  value,
  showAxis = true,
}: {
  value: string | null | undefined;
  showAxis?: boolean;
}) {
  if (!value) return null;
  const style = OPERATIONAL_STYLES[value] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  return (
    <span className={CHIP} style={style} title={`Operational status — ${operationalStatusLabel(value)}`}>
      {showAxis && <span style={{ opacity: 0.7, fontWeight: 600 }}>Ops:</span>}
      {operationalStatusLabel(value)}
    </span>
  );
}

// ── Lifecycle indicator (R-21) ──────────────────────────────────────────────

export const LIFECYCLE_STAGES = [
  "Detected",
  "Assessed",
  "Remediation",
  "Governance",
  "Closed",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/**
 * The current lifecycle stage a finding has REACHED, derived from the two axes.
 * A compact detected→assessed→remediation→governance→closed progression so a
 * customer sees where a finding is at a glance instead of decoding two chips.
 *
 * `governance` means remediation is done (or risk accepted) and a human decision
 * is the next step — the crux the walkthrough found invisible (R-22 / R-7).
 */
export function lifecycleStageIndex(
  operationalStatus: string | null | undefined,
  decisionState: string | null | undefined,
): number {
  if (decisionState === "resolved" || operationalStatus === "closed") return 4; // Closed
  if (operationalStatus === "remediated" || decisionState === "accepted_risk") return 3; // Governance
  if (operationalStatus === "in_progress" || decisionState === "mitigating") return 2; // Remediation
  return 1; // Assessed (every persisted finding is scored)
}

/** Human summary of the lifecycle stage + the next required action. */
export function lifecycleSummary(
  operationalStatus: string | null | undefined,
  decisionState: string | null | undefined,
): { stage: LifecycleStage; nextAction: string } {
  const idx = lifecycleStageIndex(operationalStatus, decisionState);
  const stage = LIFECYCLE_STAGES[idx]!;
  let nextAction = "";
  switch (idx) {
    case 4:
      nextAction = "Closed — no action required.";
      break;
    case 3:
      nextAction =
        decisionState === "accepted_risk"
          ? "Risk accepted — review on the acceptance's expiry date."
          : "Remediation complete. Governance decision required — review for closure.";
      break;
    case 2:
      nextAction = "Remediation in progress — track work to completion.";
      break;
    default:
      nextAction = "Assess and record a risk-treatment decision.";
  }
  return { stage, nextAction };
}

/** Compact horizontal stepper. Reached stages are lit; the current one is bold. */
export function LifecycleIndicator({
  operationalStatus,
  decisionState,
  className,
}: {
  operationalStatus: string | null | undefined;
  decisionState: string | null | undefined;
  className?: string;
}) {
  const current = lifecycleStageIndex(operationalStatus, decisionState);
  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${className ?? ""}`}
      role="list"
      aria-label="Finding lifecycle"
    >
      {LIFECYCLE_STAGES.map((stage, i) => {
        const reached = i <= current;
        const isCurrent = i === current;
        return (
          <span key={stage} className="flex items-center gap-1" role="listitem">
            <span
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{
                background: isCurrent ? "rgba(0,196,180,0.15)" : "transparent",
                color: isCurrent ? "#00c4b4" : reached ? "#94a3b8" : "#334155",
                fontWeight: isCurrent ? 700 : 500,
              }}
              aria-current={isCurrent ? "step" : undefined}
            >
              {stage}
            </span>
            {i < LIFECYCLE_STAGES.length - 1 && (
              <span style={{ color: i < current ? "#94a3b8" : "#334155" }}>→</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Queue overlap disclosure (F-2) ──────────────────────────────────────────

export const QUEUE_OVERLAP_NOTE =
  "Queues overlap by design: one finding can appear in several at once (for example, both Overdue and Needs Governance Decision). Totals count each queue independently.";

// ── "Why is this in my work?" (MW-7) ────────────────────────────────────────

/**
 * The reason a finding appears in a user's My Work queue. My Work resolves the
 * literal finding owner (owner_user_id = me) — never a client-supplied id
 * (CANONICAL_DOMAIN_MODEL Contract 1). We surface the supported reasons the list
 * payload can prove; richer roles (approver / remediation owner) live on their
 * own surfaces and are linked, not asserted here without data.
 */
export function whyInMyWork(
  finding: { owner_user_id: string | null; decision_state?: string; operational_status?: string },
  myUserId: string | null,
): string | null {
  if (myUserId && finding.owner_user_id === myUserId) return "You own this finding";
  return null;
}
