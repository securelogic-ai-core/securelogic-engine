"use client";

/**
 * LifecyclePanel (R3, spec §4.1/§4.2) — the risk-detail lifecycle panel.
 *
 * Renders the current stage, the 12-stage progress rail (driven by the
 * 9-state machine underneath), the gate requirements, and the transition
 * actions. Actions are sourced ENTIRELY from the API's `allowed_transitions`
 * (never hardcoded), so the R2 server-side guard that excludes the
 * approval-managed transitions is automatically respected. The approval
 * request is a separate affordance (its own endpoint); approve/reject live
 * in the approvals queue where the approval id + is_self_proposed come from.
 *
 * Flag-off / not-lifecycle-managed: GET /lifecycle returns 404 → the panel
 * renders nothing, so no lifecycle affordances appear.
 *
 * Mirrors the client-fetch section pattern of LinkedControlsSection and the
 * card/label/pill styling used across the risk detail page.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getRiskLifecycle,
  executeRiskTransition,
  requestRiskApproval,
  type RiskLifecycleState,
} from "@/lib/api";
import {
  STAGES,
  stageStatuses,
  stateLabel,
  transitionLabel,
  reasonLabel,
} from "./lifecycleLabels";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const PILL = "inline-flex items-center px-2 py-0.5 rounded text-xs";

const STAGE_COLORS: Record<string, { dot: string; text: string }> = {
  complete: { dot: "#00c4b4", text: "#cbd5e1" },
  current: { dot: "#60a5fa", text: "#f1f5f9" },
  upcoming: { dot: "#334155", text: "#475569" },
};

type ModalTarget =
  | { kind: "transition"; transition: string }
  | { kind: "request_approval" }
  | null;

export function LifecyclePanel({
  riskId,
  userRole,
  onChanged,
}: {
  riskId: string;
  userRole: string | null;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<RiskLifecycleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalTarget>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getRiskLifecycle(riskId);
    setLoading(false);
    if (res.ok) {
      setData(res.data);
      setDisabled(false);
      return;
    }
    if (res.disabled) {
      setDisabled(true);
      return;
    }
    setError("Could not load the risk lifecycle.");
  }, [riskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openModal(target: ModalTarget) {
    setModal(target);
    setComment("");
    setActionError(null);
  }

  async function submitModal() {
    if (!modal || !data) return;
    // The transition endpoint requires a comment; the approval request treats
    // it as an optional rationale.
    if (modal.kind === "transition" && comment.trim().length === 0) {
      setActionError("A comment is required.");
      return;
    }
    setSubmitting(true);
    setActionError(null);

    const res =
      modal.kind === "transition"
        ? await executeRiskTransition(riskId, {
            transition: modal.transition,
            comment: comment.trim(),
            expected_from_state: data.lifecycle_state,
          })
        : await requestRiskApproval(riskId, {
            kind: "treatment_plan",
            request_rationale: comment.trim() || undefined,
          });

    setSubmitting(false);
    if (!res.ok) {
      setActionError(reasonLabel(res.error));
      return;
    }
    setModal(null);
    onChanged?.();
    await refresh();
  }

  // Flag off / not lifecycle-managed → render nothing (no affordances).
  if (disabled) return null;

  if (loading && !data) {
    return (
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-2">Lifecycle</p>
        <p className="text-sm" style={{ color: "#475569" }}>Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <div className="flex items-baseline justify-between mb-2 gap-3">
          <p style={SECTION_LABEL}>Lifecycle</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs font-semibold"
            style={{ color: "#00c4b4", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            Retry
          </button>
        </div>
        <p className="text-sm" style={{ color: "#fca5a5" }}>{error ?? "Unavailable."}</p>
      </div>
    );
  }

  const current = data.lifecycle_state;
  const statuses = stageStatuses(current, data.gates);
  const g = data.gates;
  const isApprover = userRole === "admin";
  // Viewers are read-only (the engine returns 403 read_only_access on any
  // lifecycle mutation); render the rail without action affordances.
  const readOnly = userRole === "viewer";
  const inActiveAssessment = current === "scoping";
  const inTreatmentSelection = current === "treatment_selection";
  const inPendingApproval = current === "pending_approval";

  return (
    <div className="mb-6 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <p style={SECTION_LABEL}>Lifecycle</p>
          <span className={`${PILL} font-medium`} style={{ background: "rgba(96,165,250,0.12)", color: "#93c5fd" }}>
            {stateLabel(current)}
          </span>
        </div>
      </div>

      {/* 12-stage progress rail */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
        {STAGES.map((st, i) => {
          const status = statuses[i];
          const c = STAGE_COLORS[status];
          return (
            <div key={st.label} className="flex items-center gap-1.5" title={`${st.label} — ${status}`}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: status === "upcoming" ? "transparent" : c.dot,
                  border: `2px solid ${c.dot}`,
                  flexShrink: 0,
                }}
              />
              <span
                className="text-xs"
                style={{ color: c.text, fontWeight: status === "current" ? 600 : 400 }}
              >
                {st.label}
                {status === "complete" ? " ✓" : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Gate requirements (proactive, human-readable) */}
      {(inActiveAssessment || inTreatmentSelection) && (
        <div
          className="mb-4 p-3 rounded"
          style={{ background: "rgba(148,163,184,0.05)", border: "1px solid rgba(148,163,184,0.12)" }}
        >
          <p className="text-xs mb-2" style={{ color: "#94a3b8", fontWeight: 600 }}>Requirements</p>
          <ul className="space-y-1 list-none p-0 m-0">
            <Requirement met={g.owner} label="Risk owner assigned" />
            <Requirement met={g.score} label="Residual risk scored" />
            <Requirement
              met={g.evidence}
              optional={!g.evidence_gate_enforced}
              label={g.evidence_gate_enforced ? "Evidence attached (required)" : "Evidence attached (recommended)"}
            />
            {inTreatmentSelection && (
              <Requirement met={g.treatment_count > 0} label={`Treatment plan added (${g.treatment_count})`} />
            )}
          </ul>
        </div>
      )}

      {/* Pending-approval banner */}
      {inPendingApproval && (
        <div
          className="mb-4 p-3 rounded"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <p className="text-sm" style={{ color: "#fcd34d" }}>
            Awaiting executive approval.
          </p>
          <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
            {isApprover
              ? "Review and decide this request in the approvals queue."
              : "An approver must review the treatment plan before mitigation can begin."}
          </p>
          {isApprover && (
            <Link
              href="/approvals"
              className="inline-block text-xs font-semibold mt-2"
              style={{ color: "#00c4b4", textDecoration: "none" }}
            >
              Go to approvals queue →
            </Link>
          )}
        </div>
      )}

      {/* Actions — hidden for read-only viewers (rail stays visible above) */}
      {readOnly ? (
        <p className="text-xs" style={{ color: "#475569" }}>
          Read-only access — you can view the lifecycle but not change it.
        </p>
      ) : (
      <div className="flex items-center gap-2 flex-wrap">
        {inTreatmentSelection && (
          <button
            type="button"
            onClick={() => openModal({ kind: "request_approval" })}
            disabled={g.treatment_count === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded"
            style={{
              background: g.treatment_count === 0 ? "rgba(0,196,180,0.3)" : "#00c4b4",
              color: "#0a0f1a",
              border: "none",
              cursor: g.treatment_count === 0 ? "not-allowed" : "pointer",
              opacity: g.treatment_count === 0 ? 0.6 : 1,
            }}
            title={g.treatment_count === 0 ? "Add a treatment plan first" : undefined}
          >
            Request approval
          </button>
        )}
        {data.allowed_transitions.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => openModal({ kind: "transition", transition: t })}
            className="text-xs font-semibold px-3 py-1.5 rounded"
            style={{
              background: "transparent",
              color: "#cbd5e1",
              border: "1px solid #1e293b",
              cursor: "pointer",
            }}
          >
            {transitionLabel(t)}
          </button>
        ))}
        {data.allowed_transitions.length === 0 && !inTreatmentSelection && !inPendingApproval && (
          <p className="text-xs" style={{ color: "#475569" }}>
            No further actions available from this stage.
          </p>
        )}
      </div>
      )}

      {/* Transition / request-approval modal */}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => !submitting && setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...CARD_STYLE, maxWidth: 440, width: "100%", padding: 20 }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: "#f1f5f9" }}>
              {modal.kind === "request_approval"
                ? "Request executive approval"
                : transitionLabel(modal.transition)}
            </p>
            <p className="text-xs mb-3" style={{ color: "#94a3b8" }}>
              {modal.kind === "request_approval"
                ? "This submits the treatment plan for approval and moves the risk to Pending Approval."
                : "This is recorded in the append-only lifecycle history."}
            </p>
            <label className="block text-xs mb-1" style={{ color: "#94a3b8", fontWeight: 600 }}>
              {modal.kind === "request_approval" ? "Rationale (optional)" : "Comment (required)"}
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 1000))}
              disabled={submitting}
              autoFocus
              placeholder={
                modal.kind === "request_approval"
                  ? "Why is this plan ready for approval?"
                  : "Reason for this transition"
              }
              style={{
                width: "100%",
                minHeight: 72,
                padding: "8px 10px",
                background: "rgba(15,23,34,0.6)",
                border: "1px solid #1e293b",
                borderRadius: 6,
                color: "#e5e7eb",
                fontSize: 13,
                fontFamily: "inherit",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
            {actionError && (
              <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{actionError}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => void submitModal()}
                disabled={submitting}
                className="text-xs font-semibold px-3 py-1.5 rounded"
                style={{ background: "#00c4b4", color: "#0a0f1a", border: "none", cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Working…" : modal.kind === "request_approval" ? "Submit for approval" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={submitting}
                className="text-xs font-medium px-3 py-1.5 rounded"
                style={{ background: "transparent", color: "#94a3b8", border: "1px solid #1e293b", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Requirement({ met, label, optional }: { met: boolean; label: string; optional?: boolean }) {
  const color = met ? "#86efac" : optional ? "#94a3b8" : "#fca5a5";
  const mark = met ? "✓" : optional ? "○" : "✗";
  return (
    <li className="flex items-center gap-2 text-xs" style={{ color }}>
      <span aria-hidden style={{ width: 12, textAlign: "center" }}>{mark}</span>
      <span>{label}</span>
    </li>
  );
}
