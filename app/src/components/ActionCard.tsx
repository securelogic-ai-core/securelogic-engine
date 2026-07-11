"use client";

import { useState, useTransition } from "react";
import type { Action } from "@/lib/api";

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress: { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  blocked:     { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  closed:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  accepted:    { background: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
};

const STATUS_LABELS: Record<string, string> = {
  open:        "Open",
  in_progress: "In Progress",
  blocked:     "Blocked",
  closed:      "Closed",
  accepted:    "Accepted",
};

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  near_term: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  planned:   { background: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

const PRIORITY_LABELS: Record<string, string> = {
  immediate: "Immediate",
  near_term: "Near Term",
  planned:   "Planned",
  watch:     "Watch",
};

type Transition = { value: Action["status"]; label: string };

const STATUS_TRANSITIONS: Record<string, Transition[]> = {
  open:        [{ value: "in_progress", label: "Start" }],
  in_progress: [{ value: "closed", label: "Complete" }, { value: "blocked", label: "Block" }],
  blocked:     [{ value: "in_progress", label: "Unblock" }],
  closed:      [{ value: "open", label: "Re-open" }],
  accepted:    [],
};

const BUTTON_STYLE: React.CSSProperties = {
  border: "1px solid #1e293b",
  color: "#94a3b8",
  padding: "3px 10px",
  borderRadius: "6px",
  fontSize: "12px",
  background: "transparent",
  cursor: "pointer",
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

const PRIORITY_OPTIONS = ["immediate", "near_term", "planned", "watch"] as const;

const FIELD_STYLE: React.CSSProperties = {
  background: "#0f1722",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  fontSize: 12,
  borderRadius: 6,
  padding: "3px 6px",
};

export interface ActionOwnerOption {
  id: string;
  label: string;
}

interface Props {
  action: Action;
  findingId: string;
  onStatusChange: (actionId: string, newStatus: Action["status"]) => Promise<void>;
  /**
   * Owner/priority/due-date edit. Optional: when omitted the card is exactly the
   * status-only card it has always been, so any other caller is unaffected.
   */
  onPlanChange?: (
    actionId: string,
    patch: { owner_user_id?: string | null; priority?: string; due_date?: string | null }
  ) => Promise<void>;
  owners?: ActionOwnerOption[];
}

export function ActionCard({
  action,
  findingId: _findingId,
  onStatusChange,
  onPlanChange,
  owners,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(action.status);
  // "Start" used to be the end of the road: you could begin a piece of work but not
  // say who was doing it, how urgent it was, or when it was due — and you could
  // never change your mind. The engine has accepted all three since 20260410; only
  // the UI never sent them. Collapsed by default so the card stays scannable.
  const [planOpen, setPlanOpen] = useState(false);

  const transitions = STATUS_TRANSITIONS[optimisticStatus] ?? [];
  const canPlan = typeof onPlanChange === "function";

  function handleTransition(newStatus: Action["status"]) {
    const prev = optimisticStatus;
    setOptimisticStatus(newStatus);
    startTransition(async () => {
      try {
        await onStatusChange(action.id, newStatus);
      } catch {
        setOptimisticStatus(prev);
      }
    });
  }

  function handlePlan(patch: {
    owner_user_id?: string | null;
    priority?: string;
    due_date?: string | null;
  }) {
    if (!onPlanChange) return;
    startTransition(async () => {
      await onPlanChange(action.id, patch);
    });
  }

  const ownerLabel =
    owners?.find((o) => o.id === action.owner_user_id)?.label ??
    (action.owner_user_id ? "Assigned" : "Unassigned");

  let dueDateNode: React.ReactNode = null;
  if (action.due_date && optimisticStatus !== "closed") {
    const days = daysUntil(action.due_date);
    const dateStr = fmt(action.due_date);
    if (days < 0) {
      dueDateNode = <span style={{ color: "#fca5a5" }}>Overdue · {dateStr}</span>;
    } else if (days <= 7) {
      dueDateNode = <span style={{ color: "#fcd34d" }}>Due {dateStr}</span>;
    } else {
      dueDateNode = <span>Due {dateStr}</span>;
    }
  }

  return (
    <div
      className="rounded-lg transition-colors"
      style={{
        background: "rgba(15,23,42,0.6)",
        border: "1px solid #1e293b",
        padding: "12px",
      }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
          style={STATUS_STYLES[optimisticStatus] ?? STATUS_STYLES["open"]}
        >
          {STATUS_LABELS[optimisticStatus] ?? optimisticStatus}
        </span>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
          style={PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES["watch"]}
        >
          {PRIORITY_LABELS[action.priority] ?? action.priority}
        </span>
      </div>

      <p className="text-sm font-medium mb-1" style={{ color: "#f1f5f9" }}>
        {action.title}
      </p>

      {action.description && (
        <p className="text-xs mb-2 line-clamp-2" style={{ color: "#94a3b8" }}>
          {action.description}
        </p>
      )}

      {(dueDateNode || optimisticStatus === "closed") && (
        <div className="text-xs mb-2" style={{ color: "#64748b" }}>
          {optimisticStatus === "closed" && action.completed_at
            ? <span>Completed {fmt(action.completed_at)}</span>
            : dueDateNode}
        </div>
      )}

      {/* Who is doing this. An unowned action is a wish, not a plan — so the owner
          is stated on the face of the card, not hidden behind the editor. */}
      {canPlan && (
        <div className="text-xs mb-2" style={{ color: action.owner_user_id ? "#94a3b8" : "#64748b" }}>
          {action.owner_user_id ? `Owner: ${ownerLabel}` : "Unassigned"}
        </div>
      )}

      {(transitions.length > 0 || canPlan) && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTransition(t.value)}
              disabled={isPending}
              style={BUTTON_STYLE}
              className="transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-slate-200"
            >
              {t.label}
            </button>
          ))}
          {canPlan && (
            <button
              onClick={() => setPlanOpen((o) => !o)}
              disabled={isPending}
              style={BUTTON_STYLE}
              className="transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-slate-200"
            >
              {planOpen ? "Done" : action.owner_user_id ? "Reassign / reschedule" : "Assign"}
            </button>
          )}
        </div>
      )}

      {canPlan && planOpen && (
        <div
          className="mt-3 pt-3 flex flex-wrap gap-3 items-center"
          style={{ borderTop: "1px solid #1e293b" }}
        >
          <label className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "#64748b" }}>Owner</span>
            <select
              value={action.owner_user_id ?? ""}
              disabled={isPending}
              onChange={(e) => handlePlan({ owner_user_id: e.target.value || null })}
              style={FIELD_STYLE}
            >
              <option value="">Unassigned</option>
              {(owners ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "#64748b" }}>Priority</span>
            <select
              value={action.priority}
              disabled={isPending}
              onChange={(e) => handlePlan({ priority: e.target.value })}
              style={FIELD_STYLE}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "#64748b" }}>Due</span>
            <input
              type="date"
              defaultValue={action.due_date ?? ""}
              disabled={isPending}
              onChange={(e) => handlePlan({ due_date: e.target.value || null })}
              style={FIELD_STYLE}
            />
          </label>
        </div>
      )}
    </div>
  );
}
