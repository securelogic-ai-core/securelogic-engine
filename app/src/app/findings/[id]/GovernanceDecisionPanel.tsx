"use client";

/**
 * GovernanceDecisionPanel — the real decision controls behind "Record decision".
 *
 * The banner CTA used to be an in-page anchor that scrolled somewhere and changed
 * nothing. This panel is the decision UI itself: the legally available options
 * (server state machine mirrored client-side), what each one DOES (resulting
 * governance state, operational effect, closure eligibility), a rationale that is
 * REQUIRED for closing decisions, Confirm/Cancel, and every refusal — client
 * validation or engine 409 — shown in place. Cancel records nothing.
 *
 * Accept Risk under the signed workflow, escalation, and the Zone A quick controls
 * are unchanged; this panel never offers accepted_risk while that workflow owns it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DECISION_STATE_LABELS,
  OPERATIONAL_STATUS_LABELS,
  GOVERNANCE_AXIS_LABEL,
  OPERATIONAL_AXIS_LABEL,
} from "@/lib/findingLifecycleVocab";
import { decisionOptions, DECISION_NOTE_MAX } from "./decisionConsequences";
import type { DecisionState } from "./decisionTransitions";
import { updateFindingDecisionStateAction } from "./actions";

export function GovernanceDecisionPanel({
  findingId,
  decisionState,
  operationalStatus,
  openActionCount,
  riskAcceptanceActive,
  onClose,
}: {
  findingId: string;
  decisionState: string | null;
  operationalStatus: string | null;
  openActionCount: number;
  riskAcceptanceActive: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<DecisionState | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options = decisionOptions({
    decisionState,
    operationalStatus,
    openActionCount,
    riskAcceptanceActive,
  });
  const selectedOption = options.find((o) => o.value === selected) ?? null;

  const confirm = () => {
    if (!selectedOption) {
      setError("Choose a decision to record.");
      return;
    }
    if (selectedOption.requiresNote && note.trim().length === 0) {
      setError("A written rationale is required for this decision.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await updateFindingDecisionStateAction(
        findingId,
        selectedOption.value,
        note.trim() || undefined
      );
      if (r && "error" in r && r.error) {
        // The engine's refusal (closure gate, separation of duties, illegal
        // transition) — shown here, where the decision was attempted.
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="governance-decision-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(2,6,23,0.7)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflowY: "auto",
        padding: "48px 16px",
      }}
      onClick={(e) => {
        // Backdrop click = Cancel: records nothing.
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 640,
        }}
      >
        <h2 id="governance-decision-title" style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
          Record a governance decision
        </h2>

        {/* The state the decision is made FROM — governance + the system-derived axis. */}
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0 16px" }}>
          {GOVERNANCE_AXIS_LABEL}:{" "}
          <strong style={{ color: "#c4b5fd" }}>
            {DECISION_STATE_LABELS[decisionState ?? ""] ?? "—"}
          </strong>
          {" · "}
          {OPERATIONAL_AXIS_LABEL}:{" "}
          <strong style={{ color: "#93c5fd" }}>
            {OPERATIONAL_STATUS_LABELS[operationalStatus ?? ""] ?? operationalStatus ?? "—"}
          </strong>{" "}
          <span style={{ color: "#64748b" }}>(system-derived — not changed here directly)</span>
        </p>

        {options.length === 0 ? (
          <p style={{ fontSize: 13, color: "#94a3b8" }}>
            No governance decision is available from this state.
            {riskAcceptanceActive && (
              <> Risk acceptance is a governed workflow — propose it from the Risk Acceptance panel.</>
            )}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Available decisions" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {options.map((o) => (
              <label
                key={o.value}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  border: `1px solid ${selected === o.value ? "rgba(0,196,180,0.5)" : "#1e293b"}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: o.disabled ? "not-allowed" : "pointer",
                  opacity: o.disabled ? 0.55 : 1,
                  background: selected === o.value ? "rgba(0,196,180,0.06)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="governance-decision-option"
                  value={o.value}
                  checked={selected === o.value}
                  disabled={o.disabled || pending}
                  onChange={() => {
                    setSelected(o.value);
                    setError(null);
                  }}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
                    {o.label}
                    {o.requiresNote && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: "#fcd34d" }}> · rationale required</span>
                    )}
                  </span>
                  {/* What choosing this option DOES — resulting governance state,
                      operational effect, and closure eligibility. */}
                  <span style={{ display: "block", fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                    {o.consequence}
                  </span>
                  {o.disabled && o.disabledReason && (
                    <span style={{ display: "block", fontSize: 12, color: "#fcd34d", marginTop: 2 }}>
                      {o.disabledReason}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        {options.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label htmlFor="decision-rationale" style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              Rationale
              {selectedOption?.requiresNote ? (
                <span style={{ color: "#fcd34d" }}> (required)</span>
              ) : (
                <span style={{ color: "#64748b" }}> (optional)</span>
              )}
              <span style={{ color: "#64748b" }}> — recorded on the finding&apos;s audit trail</span>
            </label>
            <textarea
              id="decision-rationale"
              value={note}
              maxLength={DECISION_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Why this decision is being recorded"
              style={{
                width: "100%",
                background: "#0b1220",
                border: "1px solid #1e293b",
                borderRadius: 8,
                color: "#e2e8f0",
                fontSize: 13,
                padding: "8px 10px",
                resize: "vertical",
              }}
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            style={{
              fontSize: 13,
              color: "#fca5a5",
              margin: "12px 0 0",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 6,
              padding: "6px 10px",
              background: "rgba(239,68,68,0.08)",
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            style={{
              background: "transparent",
              border: "1px solid #334155",
              color: "#94a3b8",
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {options.length > 0 && (
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              style={{
                background: "rgba(0,196,180,0.15)",
                border: "1px solid rgba(0,196,180,0.4)",
                color: "#00c4b4",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {pending ? "Recording…" : "Record decision"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
