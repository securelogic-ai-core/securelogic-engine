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

// R-6: what each transition DOES downstream, shown on the control so a state change
// is never a mystery click. Completing all of a finding's actions advances the
// finding to "remediated" (ready for a governance decision).
const TRANSITION_EFFECT: Record<string, string> = {
  Start: "Marks work as in progress. Does not close the finding.",
  Complete:
    "Marks this action done. When every action on the finding is done, the finding becomes Remediation complete and moves to the governance decision.",
  Block: "Records this action as blocked, with the blocker details, so it stops counting as work in flight.",
  Unblock: "Returns this action to In Progress.",
  "Re-open": "Reopens this completed action; the finding regresses from remediated if it had advanced.",
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

/** R-13: a due date must not precede the day the action was created. Returns an
 *  error string when invalid, else null. Empty (cleared) is always valid. */
function dueDateError(due: string, createdAt: string): string | null {
  if (!due) return null;
  const created = createdAt.slice(0, 10); // YYYY-MM-DD
  if (due < created) return `Due date can't be before the action was created (${fmt(createdAt)}).`;
  return null;
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

/** A patch the card can apply. Extended for R-10 (block metadata) — the plan editor
 *  and the block dialog both go through onPlanChange so the whole change is ONE
 *  guarded PATCH. */
export type ActionPatch = {
  status?: Action["status"];
  owner_user_id?: string | null;
  priority?: string;
  due_date?: string | null;
  blocked_reason?: string | null;
  blocked_dependency?: string | null;
  blocked_owner_user_id?: string | null;
  blocked_expected_unblock_date?: string | null;
};

interface Props {
  action: Action;
  findingId: string;
  onStatusChange: (actionId: string, newStatus: Action["status"]) => Promise<void>;
  /**
   * Owner/priority/due-date + block-metadata edit. Optional: when omitted the card
   * is the status-only card it has always been (legacy callers unaffected).
   */
  onPlanChange?: (actionId: string, patch: ActionPatch) => Promise<void>;
  /**
   * Explicit Unblock transition (Blocked → In Progress). Optional: when omitted
   * the card keeps the legacy bare status flip (no confirmation), so status-only
   * callers are unaffected. When provided, Unblock opens a Confirm/Cancel dialog
   * and calls the dedicated engine endpoint, which preserves blocker history.
   */
  onUnblock?: (actionId: string) => Promise<void>;
  owners?: ActionOwnerOption[];
}

export function ActionCard({
  action,
  findingId: _findingId,
  onStatusChange,
  onPlanChange,
  onUnblock,
  owners,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(action.status);
  // One editor open at a time: reassign/reschedule, block, or unblock-confirm.
  const [editor, setEditor] = useState<null | "plan" | "block" | "unblock">(null);

  // R-11: staged edit state — nothing commits until Save (no more auto-commit onChange).
  const [planOwner, setPlanOwner] = useState<string>(action.owner_user_id ?? "");
  const [planPriority, setPlanPriority] = useState<string>(action.priority);
  const [planDue, setPlanDue] = useState<string>(action.due_date ?? "");
  const [planError, setPlanError] = useState<string | null>(null);

  // R-10: block dialog state.
  const [blkReason, setBlkReason] = useState<string>(action.blocked_reason ?? "");
  const [blkDependency, setBlkDependency] = useState<string>(action.blocked_dependency ?? "");
  const [blkOwner, setBlkOwner] = useState<string>(action.blocked_owner_user_id ?? "");
  const [blkUnblock, setBlkUnblock] = useState<string>(action.blocked_expected_unblock_date ?? "");
  const [blkError, setBlkError] = useState<string | null>(null);

  const transitions = STATUS_TRANSITIONS[optimisticStatus] ?? [];
  const canPlan = typeof onPlanChange === "function";
  const canConfirmUnblock = typeof onUnblock === "function";

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

  // The Block button: with the planning capability, open the structured dialog
  // (R-10); without it (legacy status-only card), keep the bare status flip.
  function handleBlockClick() {
    if (canPlan) {
      setPlanError(null);
      setEditor("block");
    } else {
      handleTransition("blocked");
    }
  }

  // Unblock is an explicit, auditable transition. With the confirm capability,
  // open a Confirm/Cancel dialog (nothing changes until Confirm, and Cancel
  // leaves the action blocked). Without it (legacy status-only card), keep the
  // bare status flip so those callers are byte-identical.
  function handleUnblockClick() {
    if (canConfirmUnblock) {
      setEditor("unblock");
    } else {
      handleTransition("in_progress");
    }
  }

  function confirmUnblock() {
    if (!onUnblock) return;
    const prev = optimisticStatus;
    setOptimisticStatus("in_progress");
    startTransition(async () => {
      try {
        await onUnblock(action.id);
        setEditor(null);
      } catch {
        // The transition failed on the server (e.g. no longer blocked) — revert
        // the optimistic flip and leave the dialog so the user can retry/cancel.
        setOptimisticStatus(prev);
      }
    });
  }

  function openPlan() {
    setPlanOwner(action.owner_user_id ?? "");
    setPlanPriority(action.priority);
    setPlanDue(action.due_date ?? "");
    setPlanError(null);
    setEditor("plan");
  }

  function savePlan() {
    if (!onPlanChange) return;
    const err = dueDateError(planDue, action.created_at);
    if (err) {
      setPlanError(err);
      return;
    }
    startTransition(async () => {
      await onPlanChange(action.id, {
        owner_user_id: planOwner || null,
        priority: planPriority,
        due_date: planDue || null,
      });
      setEditor(null);
    });
  }

  function saveBlock() {
    if (!onPlanChange) return;
    if (!blkReason.trim()) {
      setBlkError("A blocker reason is required.");
      return;
    }
    // An expected unblock date is a forecast — a date already in the past is
    // never a valid forecast at entry time.
    if (blkUnblock && blkUnblock < new Date().toISOString().slice(0, 10)) {
      setBlkError("Expected unblock date can't be in the past.");
      return;
    }
    setOptimisticStatus("blocked");
    startTransition(async () => {
      await onPlanChange(action.id, {
        status: "blocked",
        blocked_reason: blkReason.trim(),
        blocked_dependency: blkDependency.trim() || null,
        blocked_owner_user_id: blkOwner || null,
        blocked_expected_unblock_date: blkUnblock || null,
      });
      setEditor(null);
    });
  }

  const ownerLabel =
    owners?.find((o) => o.id === action.owner_user_id)?.label ??
    (action.owner_user_id ? "Assigned" : "Unassigned");
  const blockOwnerLabel =
    owners?.find((o) => o.id === action.blocked_owner_user_id)?.label ?? "—";

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

      {/* Who is doing this. An unowned action is a wish, not a plan. */}
      {canPlan && (
        <div className="text-xs mb-2" style={{ color: action.owner_user_id ? "#94a3b8" : "#64748b" }}>
          {action.owner_user_id ? `Owner: ${ownerLabel}` : "Unassigned"}
        </div>
      )}

      {/* R-10: when blocked, show WHY — the blocker details, not just a red pill. */}
      {optimisticStatus === "blocked" && (action.blocked_reason || action.blocked_dependency || action.blocked_owner_user_id || action.blocked_expected_unblock_date) && (
        <div
          className="text-xs mb-2 p-2 rounded"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#94a3b8" }}
        >
          {action.blocked_reason && <div><span style={{ color: "#fca5a5" }}>Blocked:</span> {action.blocked_reason}</div>}
          {action.blocked_dependency && <div>Depends on: {action.blocked_dependency}</div>}
          {action.blocked_owner_user_id && <div>Blocker owner: {blockOwnerLabel}</div>}
          {action.blocked_expected_unblock_date && <div>Expected unblock: {fmt(action.blocked_expected_unblock_date)}</div>}
        </div>
      )}

      {(transitions.length > 0 || canPlan) && editor === null && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() =>
                t.value === "blocked"
                  ? handleBlockClick()
                  : t.label === "Unblock"
                    ? handleUnblockClick()
                    : handleTransition(t.value)
              }
              disabled={isPending}
              style={BUTTON_STYLE}
              title={TRANSITION_EFFECT[t.label] ?? undefined}
              className="transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-slate-200"
            >
              {t.label}
            </button>
          ))}
          {canPlan && (
            <button
              onClick={openPlan}
              disabled={isPending}
              style={BUTTON_STYLE}
              title="Open a dialog to change the owner, priority, or due date. Nothing changes until you Save."
              className="transition-colors disabled:opacity-50 hover:border-slate-500 hover:text-slate-200"
            >
              {action.owner_user_id ? "Reassign / reschedule" : "Assign"}
            </button>
          )}
        </div>
      )}

      {/* R-11: reassign / reschedule DIALOG — explicit Save / Cancel, no auto-commit. */}
      {canPlan && editor === "plan" && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e293b" }}>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#64748b" }}>Owner</span>
              <select value={planOwner} disabled={isPending} onChange={(e) => setPlanOwner(e.target.value)} style={FIELD_STYLE}>
                <option value="">Unassigned</option>
                {(owners ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#64748b" }}>Priority</span>
              <select value={planPriority} disabled={isPending} onChange={(e) => setPlanPriority(e.target.value)} style={FIELD_STYLE}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#64748b" }}>Due</span>
              <input type="date" value={planDue} disabled={isPending} onChange={(e) => setPlanDue(e.target.value)} style={FIELD_STYLE} />
            </label>
          </div>
          {planError && <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{planError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={savePlan} disabled={isPending} style={{ ...BUTTON_STYLE, borderColor: "#00c4b4", color: "#00c4b4" }}>Save</button>
            <button onClick={() => { setEditor(null); setPlanError(null); }} disabled={isPending} style={BUTTON_STYLE}>Cancel</button>
          </div>
        </div>
      )}

      {/* R-10: block DIALOG — capture the blocker's structured metadata. */}
      {canPlan && editor === "block" && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e293b" }}>
          <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>Blocking this action — record why so it stops counting as active work.</p>
          <label className="block text-xs mb-1" style={{ color: "#64748b" }}>Blocker reason<span style={{ color: "#fca5a5" }}> *</span></label>
          <input value={blkReason} disabled={isPending} onChange={(e) => setBlkReason(e.target.value)} placeholder="e.g. Waiting on vendor patch" className="w-full mb-2" style={{ ...FIELD_STYLE, padding: "5px 8px" }} />
          <label className="block text-xs mb-1" style={{ color: "#64748b" }}>Dependency (optional)</label>
          <input value={blkDependency} disabled={isPending} onChange={(e) => setBlkDependency(e.target.value)} placeholder="e.g. CR-1042 / upstream ticket" className="w-full mb-2" style={{ ...FIELD_STYLE, padding: "5px 8px" }} />
          <div className="flex flex-wrap gap-3 items-center mb-1">
            <label className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#64748b" }}>Blocker owner</span>
              <select value={blkOwner} disabled={isPending} onChange={(e) => setBlkOwner(e.target.value)} style={FIELD_STYLE}>
                <option value="">—</option>
                {(owners ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#64748b" }}>Expected unblock</span>
              <input type="date" value={blkUnblock} disabled={isPending} onChange={(e) => setBlkUnblock(e.target.value)} style={FIELD_STYLE} />
            </label>
          </div>
          {blkError && <p className="text-xs mt-1" style={{ color: "#fca5a5" }}>{blkError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={saveBlock} disabled={isPending} style={{ ...BUTTON_STYLE, borderColor: "#fca5a5", color: "#fca5a5" }}>Block action</button>
            <button onClick={() => { setEditor(null); setBlkError(null); }} disabled={isPending} style={BUTTON_STYLE}>Cancel</button>
          </div>
        </div>
      )}

      {/* Unblock CONFIRMATION — an explicit Confirm/Cancel step. Cancel leaves the
          action Blocked; Confirm transitions it to In Progress via the dedicated
          endpoint, which records the unblock and preserves the blocker below in
          the activity history. */}
      {canConfirmUnblock && editor === "unblock" && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e293b" }}>
          <p className="text-xs mb-2" style={{ color: "#93c5fd" }}>
            Unblock this action? It returns to In Progress. The blocker is preserved in the activity history.
          </p>
          {(action.blocked_reason || action.blocked_dependency || action.blocked_owner_user_id || action.blocked_expected_unblock_date) && (
            <div
              className="text-xs mb-2 p-2 rounded"
              style={{ background: "rgba(148,163,184,0.06)", border: "1px solid #1e293b", color: "#94a3b8" }}
            >
              {action.blocked_reason && <div><span style={{ color: "#fca5a5" }}>Resolving blocker:</span> {action.blocked_reason}</div>}
              {action.blocked_dependency && <div>Depends on: {action.blocked_dependency}</div>}
              {action.blocked_owner_user_id && <div>Blocker owner: {blockOwnerLabel}</div>}
              {action.blocked_expected_unblock_date && <div>Expected unblock: {fmt(action.blocked_expected_unblock_date)}</div>}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={confirmUnblock} disabled={isPending} style={{ ...BUTTON_STYLE, borderColor: "#93c5fd", color: "#93c5fd" }}>Confirm unblock</button>
            <button onClick={() => setEditor(null)} disabled={isPending} style={BUTTON_STYLE}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
