"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { updateFindingStatus } from "@/app/actions/updateFindingStatus";
import { buildDecisionHref } from "@/app/findings/queueHandoff";
import type { Finding } from "@/lib/api";
import { useRiskScale } from "@/hooks/useRiskScale";
import {
  GovernanceStateBadge,
  OperationalStateBadge,
  lifecycleSummary,
} from "@/lib/findingLifecycleVocab";

const SEVERITY_FALLBACK: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)", color: "#fca5a5" },
  in_progress: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  closed:      { background: "rgba(34,197,94,0.12)", color: "#86efac" },
  accepted:    { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
};

// Left-edge accent (workspace only) — a stronger Open vs In Progress signal than
// the pill alone (MW-2). Legacy cards render no accent (unchanged).
const STATUS_ACCENT: Record<string, string> = {
  open:        "#ef4444",
  in_progress: "#3b82f6",
  closed:      "#22c55e",
  accepted:    "#8b5cf6",
};

const STATUS_TRANSITIONS: Record<string, Array<{ value: "open" | "in_progress" | "closed"; label: string }>> = {
  open:        [{ value: "in_progress", label: "Start" }, { value: "closed", label: "Close" }],
  in_progress: [{ value: "closed", label: "Resolve" }, { value: "open", label: "Reopen" }],
  closed:      [{ value: "open", label: "Reopen" }],
  accepted:    [{ value: "open", label: "Reopen" }],
};

const STATUS_LABELS: Record<string, string> = {
  open:        "Open",
  in_progress: "In Progress",
  closed:      "Closed",
  accepted:    "Accepted",
};

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr).getTime() - now.getTime()) / 86400000);
}

type Props = {
  finding: Finding;
  revalidateUrl: string;
  // ERIP decision-queue framing (RISK_WORKSPACE). When true, the row surfaces
  // governance/operational state, the real owner, due urgency, and an explicit
  // Decision-Workspace drill-through. Off = the legacy card, byte-for-byte unchanged.
  workspace?: boolean;
  // Scalable Risk Findings queue: force the explicit due-status label
  // (Overdue by N / Due today / Due in N days / No due date) even when the
  // workspace flag is off, and label the no-due-date case (never blank).
  showDueStatus?: boolean;
  // Resolved owner display name (workspace only). Absent → "Unassigned".
  ownerName?: string | null;
  // Why this finding appears in the user's My Work queue (workspace only, MW-7).
  reason?: string | null;
  // The queue this card was opened from, preserved into the Decision Workspace
  // (R-19). e.g. "ready_to_close" → drives the governance-handoff framing.
  queueContext?: string | null;
};

export function FindingCard({ finding, revalidateUrl, workspace = false, showDueStatus = false, ownerName, reason, queueContext }: Props) {
  const router = useRouter();
  // The current queue URL (path + search: filters, sort, page, bucket) so the
  // handoff can carry an exact `return` — a new tab restores the queue from the
  // URL alone, not from browser history or client memory.
  const pathname = usePathname();
  const currentQuery = useSearchParams().toString();
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(finding.status);
  const [error, setError] = useState<string | null>(null);
  /** Deep link to the blocking remediation, set when a close is refused by the gate. */
  const [blockedHref, setBlockedHref] = useState<string | null>(null);
  const { getLevelByValue } = useRiskScale();

  const severityRaw = finding.severity ?? "";
  const scaleLevel = getLevelByValue(severityRaw);
  const severityStyle: React.CSSProperties = scaleLevel
    ? { background: `${scaleLevel.color}26`, color: scaleLevel.color }
    : (SEVERITY_FALLBACK[severityRaw] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" });
  const severityLabel = scaleLevel?.label ?? severityRaw;
  const statusStyle = STATUS_STYLES[optimisticStatus] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const transitions = STATUS_TRANSITIONS[optimisticStatus] ?? [];

  const isReadyToClose = queueContext === "ready_to_close";
  const decisionHref = buildDecisionHref(finding.id, queueContext, pathname, currentQuery);

  function handleStatusChange(status: "open" | "in_progress" | "closed") {
    const previous = optimisticStatus;
    setOptimisticStatus(status);
    setError(null);
    setBlockedHref(null);
    startTransition(async () => {
      const result = await updateFindingStatus(finding.id, status, revalidateUrl);
      if (result && "error" in result) {
        // The optimistic close is rolled back — the server refused it, so the card must
        // not keep claiming the finding is closed.
        setOptimisticStatus(previous);
        setError(result.error);
        setBlockedHref(result.remediationHref ?? null);
      }
    });
  }

  function handleCardClick() {
    router.push(decisionHref);
  }

  // Due date display. The queue (showDueStatus) and workspace both use the
  // explicit urgency wording — never a bare date the reader has to interpret.
  const richDue = workspace || showDueStatus;
  let dueDateNode: React.ReactNode = null;
  if (finding.due_date) {
    const days = daysUntil(finding.due_date);
    const dueDateStr = fmt(finding.due_date);
    if (richDue) {
      // MW-5: explicit urgency — Due today / Due in N days / Overdue by N days.
      if (days < 0) {
        dueDateNode = <span style={{ color: "#fca5a5", fontWeight: 600 }}>Overdue by {-days} day{-days === 1 ? "" : "s"}</span>;
      } else if (days === 0) {
        dueDateNode = <span style={{ color: "#fcd34d", fontWeight: 600 }}>Due today</span>;
      } else if (days <= 7) {
        dueDateNode = <span style={{ color: "#fcd34d" }}>Due in {days} day{days === 1 ? "" : "s"}</span>;
      } else {
        dueDateNode = <span style={{ color: "#94a3b8" }}>Due {dueDateStr}</span>;
      }
    } else {
      if (days < 0) {
        dueDateNode = <span style={{ color: "#fca5a5" }}>Was due {dueDateStr}</span>;
      } else if (days <= 7) {
        dueDateNode = <span style={{ color: "#fcd34d" }}>Due {dueDateStr}</span>;
      } else {
        dueDateNode = <span style={{ color: "#94a3b8" }}>Due {dueDateStr}</span>;
      }
    }
  } else if (showDueStatus) {
    // Every queue card carries an explicit due-status label, including the
    // absence of a deadline (never a blank).
    dueDateNode = <span style={{ color: "#64748b" }}>No due date</span>;
  }

  // Governance next-step framing when remediation is complete (R-7 / R-22).
  const life = workspace
    ? lifecycleSummary(finding.operational_status, finding.decision_state)
    : null;

  const cardStyle: React.CSSProperties = {
    background: "var(--color-brand-surface, #111827)",
    borderColor: "#1e293b",
    ...(workspace ? { borderLeft: `3px solid ${STATUS_ACCENT[optimisticStatus] ?? "#334155"}` } : {}),
  };

  return (
    <div
      className="rounded-xl border p-4 cursor-pointer transition-colors"
      style={cardStyle}
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {finding.severity && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={severityStyle}>
              {severityLabel}
            </span>
          )}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={statusStyle}
          >
            {STATUS_LABELS[optimisticStatus] ?? optimisticStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
          {finding.action_count > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={{ background: "rgba(0,196,180,0.1)", color: "#00c4b4" }}
            >
              {finding.action_count} action{finding.action_count !== 1 ? "s" : ""}
            </span>
          )}
          {/* MW-3: governance + operational state, canonically labeled and never
              conflated with the legacy status pill above. */}
          {workspace && <GovernanceStateBadge value={finding.decision_state} />}
          {workspace && finding.operational_status && (
            <OperationalStateBadge value={finding.operational_status} />
          )}
        </div>
        <span className="text-xs shrink-0" style={{ color: "#64748b" }}>
          {fmt(finding.created_at)}
        </span>
      </div>

      <p className="text-sm font-medium mb-1" style={{ color: "#f1f5f9" }}>
        {finding.title}
      </p>

      {finding.description && (
        <p className="text-xs mb-2" style={{ color: "#94a3b8" }}>
          {finding.description}
        </p>
      )}

      {finding.recommendation && (
        <p className="text-xs mb-2 line-clamp-1" style={{ color: "#475569" }}>
          → {finding.recommendation}
        </p>
      )}

      {(dueDateNode || finding.domain) && (
        <div className="flex items-center gap-3 text-xs mb-2" style={{ color: "#64748b" }}>
          {dueDateNode}
          {dueDateNode && finding.domain && <span>·</span>}
          {finding.domain && <span>{finding.domain}</span>}
        </div>
      )}

      {/* Workspace meta row: real owner (MW-4) + why-in-my-work reason (MW-7). */}
      {workspace && (
        <div className="flex items-center gap-3 text-xs mb-2 flex-wrap" style={{ color: "#64748b" }}>
          <span>
            {finding.owner_user_id ? (
              <>Owner: <span style={{ color: "#cbd5e1" }}>{ownerName ?? "Assigned"}</span></>
            ) : (
              <span style={{ color: "#fcd34d" }}>Unassigned</span>
            )}
          </span>
          {reason && (
            <>
              <span>·</span>
              <span style={{ color: "#94a3b8" }}>{reason}</span>
            </>
          )}
        </div>
      )}

      {/* Ready-to-Close / governance handoff context (R-16 / R-22): make explicit
          that remediation is DONE and a governance decision is the next step, and
          name the decision owner — instead of an indistinguishable status pill. */}
      {workspace && (isReadyToClose || finding.operational_status === "remediated") && (
        <div
          className="rounded-lg px-3 py-2 mb-2 text-xs"
          style={{ background: "rgba(0,196,180,0.06)", border: "1px solid rgba(0,196,180,0.2)", color: "#94a3b8" }}
        >
          <div style={{ color: "#00c4b4", fontWeight: 600 }}>Remediation complete — governance decision required</div>
          <div className="mt-0.5">
            Decision owner: {finding.owner_user_id ? (ownerName ?? "assigned owner") : "unassigned — assign to yourself to decide"}
          </div>
          {/* Evidence status (R-16): the decision-maker sees whether remediation
              proof is attached BEFORE opening the record. Older engine payloads
              omit the count — say nothing rather than claim zero. */}
          {typeof finding.evidence_count === "number" && (
            <div className="mt-0.5">
              {finding.evidence_count > 0 ? (
                <>Evidence: {finding.evidence_count} item{finding.evidence_count !== 1 ? "s" : ""} attached</>
              ) : (
                <span style={{ color: "#fcd34d" }}>No evidence attached yet — review remediation proof before deciding</span>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>
          {error}
          {/* Say what to do AND where to do it. A refusal with no route to the blocking
              work leaves the customer stuck on the card that refused them. */}
          {blockedHref && (
            <>
              {" "}
              <a
                href={blockedHref}
                onClick={(e) => e.stopPropagation()}
                className="underline"
                style={{ color: "#93c5fd" }}
              >
                View remediation
              </a>
            </>
          )}
        </p>
      )}

      {/* Legacy (flag-off): status transitions only, byte-for-byte unchanged. */}
      {!workspace && transitions.length > 0 && (
        <div
          className="flex items-center gap-2 flex-wrap mt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={(e) => { e.stopPropagation(); handleStatusChange(t.value); }}
              disabled={isPending}
              className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: "rgba(148,163,184,0.08)", color: "#94a3b8", border: "1px solid #1e293b" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Workspace (RISK_WORKSPACE): the Decision Workspace is the PRIMARY action
          (MW-8) — that is where the governed close, risk acceptance, business
          impact, evidence, and intelligence live. Ambiguous inline Close/Resolve
          controls are intentionally NOT exposed here (MW-1 / MW-6): closure is a
          governance decision made in the workspace, not a one-click card button.
          The only inline quick action is the non-destructive "Start". */}
      {workspace && (
        <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {optimisticStatus === "open" && (
              <button
                onClick={(e) => { e.stopPropagation(); handleStatusChange("in_progress"); }}
                disabled={isPending}
                className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: "rgba(148,163,184,0.08)", color: "#94a3b8", border: "1px solid #1e293b" }}
                title="Mark that work has started (operational status). Does not close the finding."
              >
                Start work
              </button>
            )}
          </div>
          {/* A real link, not a router.push button: the href carries the
              ?from= queue context (R-19), so open-in-new-tab and copy-link
              preserve the handoff exactly like a click. */}
          <Link
            href={decisionHref}
            onClick={(e) => e.stopPropagation()}
            className="px-3 py-1 rounded text-xs font-semibold transition-colors inline-block"
            style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }}
          >
            {life && life.stage === "Governance" ? "Open governance decision →" : "Open decision →"}
          </Link>
        </div>
      )}
    </div>
  );
}
