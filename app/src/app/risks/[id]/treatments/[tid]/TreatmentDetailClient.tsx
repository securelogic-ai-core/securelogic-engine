"use client";

/**
 * TreatmentDetailClient — read-only metadata + transition controls.
 *
 * Treatment metadata is intentionally NOT editable here. The backend's
 * PATCH /api/risk-treatments/:id requires `status` and rejects
 * self-loop transitions, which means there's no current backend path
 * to fix a typo on `summary`/`owner`/etc. without also moving the
 * state forward. v1 treats metadata as set-once-correctly. A future
 * backend package will add a metadata-only PATCH; until then, the
 * workaround is "create a new treatment, close the old one."
 *
 * Transition section behavior:
 *   - not_started: "Start Work" button (→ in_progress).
 *   - in_progress: three buttons (→ mitigated | accepted | transferred).
 *   - terminal:    no buttons; "This treatment is closed."
 *
 * Confirmation modal — terminal transitions only:
 *   When this treatment has sibling treatments under the same risk
 *   that are still non-terminal (not_started or in_progress), the
 *   server-side parent-risk-status sync will overwrite their signal
 *   when this treatment terminates. Spec calls for an inline modal
 *   warning the user before the terminal transition fires. Modal
 *   suppressed when sibling count is 0.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RiskTreatment } from "@/lib/api";
import { transitionTreatmentAction } from "./actions";

type TerminalTarget = "mitigated" | "accepted" | "transferred";
type AnyTarget = "in_progress" | TerminalTarget;

const TERMINAL_TARGETS = new Set<AnyTarget>(["mitigated", "accepted", "transferred"]);

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  in_progress: { background: "rgba(245,158,11,0.12)",  color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",   color: "#86efac" },
  accepted:    { background: "rgba(245,158,11,0.12)",  color: "#fcd34d" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

const TARGET_LABELS: Record<AnyTarget, string> = {
  in_progress: "Start Work",
  mitigated:   "Mark Mitigated",
  accepted:    "Mark Accepted",
  transferred: "Mark Transferred",
};

const TARGET_DESCRIPTIONS: Record<AnyTarget, string> = {
  in_progress: "Move this treatment from Not Started to In Progress.",
  mitigated:   "The risk has been reduced to an acceptable level by this treatment.",
  accepted:    "The risk is acknowledged and accepted as-is. No further action.",
  transferred: "The risk is moved to a third party (e.g., insurance, vendor contract).",
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

function availableTargets(currentStatus: string): AnyTarget[] {
  if (currentStatus === "not_started") return ["in_progress"];
  if (currentStatus === "in_progress") return ["mitigated", "accepted", "transferred"];
  return [];
}

export function TreatmentDetailClient({
  riskId,
  treatment,
  nonTerminalSiblingCount,
}: {
  riskId: string;
  treatment: RiskTreatment;
  nonTerminalSiblingCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<TerminalTarget | null>(null);
  // pendingTarget !== null means the confirmation modal is visible.

  // Close modal on Escape.
  useEffect(() => {
    if (pendingTarget === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingTarget(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingTarget]);

  function fireTransition(target: AnyTarget) {
    setError(null);
    startTransition(async () => {
      const result = await transitionTreatmentAction(riskId, treatment.id, target);
      if (!result.ok) {
        setError(result.error);
        setPendingTarget(null);
        return;
      }
      setPendingTarget(null);
      // Re-fetch the page so the metadata grid + transition section
      // reflect the new status. The server action already revalidated
      // the path; router.refresh forces an immediate re-render.
      router.refresh();
    });
  }

  function handleClick(target: AnyTarget) {
    if (TERMINAL_TARGETS.has(target) && nonTerminalSiblingCount > 0) {
      // Confirmation modal: terminal target + open siblings.
      setPendingTarget(target as TerminalTarget);
      return;
    }
    fireTransition(target);
  }

  const statusStyle = STATUS_STYLES[treatment.status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  const targets = availableTargets(treatment.status);
  const isTerminal = targets.length === 0;

  const metadata: Array<{ label: string; value: string }> = [
    { label: "Status",         value: titleCase(treatment.status) },
    { label: "Treatment Type", value: treatment.treatment_type ? titleCase(treatment.treatment_type) : "—" },
    { label: "Owner",          value: treatment.owner ?? "—" },
    { label: "Due Date",       value: fmtDate(treatment.due_date) },
    { label: "Performed At",   value: fmtDate(treatment.performed_at) },
    { label: "Reviewer",       value: treatment.reviewer_id ?? "—" },
    { label: "Created",        value: fmtDate(treatment.created_at) },
    { label: "Last Updated",   value: fmtDate(treatment.updated_at) },
  ];

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={`${PILL} font-medium`} style={statusStyle}>
            {titleCase(treatment.status)}
          </span>
          {treatment.treatment_type && (
            <span
              className={PILL}
              style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8" }}
            >
              {titleCase(treatment.treatment_type)}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          Treatment
        </h1>
      </div>

      {/* Metadata */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-3">Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {metadata.map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs" style={{ color: "#64748b" }}>{label}</p>
              <p className="text-sm mt-0.5" style={{ color: "#cbd5e1" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-2">Summary</p>
        {treatment.summary ? (
          <p className="text-sm" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
            {treatment.summary}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#475569" }}>
            No summary recorded.
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-2">Notes</p>
        {treatment.notes ? (
          <p className="text-sm" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
            {treatment.notes}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#475569" }}>
            No notes recorded.
          </p>
        )}
      </div>

      {/* Transition section */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-3">Transition</p>
        {isTerminal ? (
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            This treatment is closed. Once a treatment reaches a terminal
            state ({titleCase(treatment.status)}), it cannot be reopened or
            modified.
          </p>
        ) : (
          <div className="space-y-3">
            {targets.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => handleClick(target)}
                disabled={isPending}
                className="w-full text-left rounded-lg p-3 transition-colors"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e5e7eb",
                  cursor: isPending ? "wait" : "pointer",
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                  {TARGET_LABELS[target]}
                </p>
                <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                  {TARGET_DESCRIPTIONS[target]}
                </p>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm mt-3" style={{ color: "#fca5a5" }}>
            {error}
          </p>
        )}
      </div>

      {/* Back link */}
      <Link
        href={`/risks/${riskId}`}
        className="text-sm"
        style={{ color: "#60a5fa", textDecoration: "none" }}
      >
        ← Back to risk
      </Link>

      {/* Confirmation modal — terminal targets with open siblings */}
      {pendingTarget !== null && (
        <ConfirmTerminalTransitionModal
          target={pendingTarget}
          siblingCount={nonTerminalSiblingCount}
          isPending={isPending}
          onCancel={() => setPendingTarget(null)}
          onConfirm={() => fireTransition(pendingTarget)}
        />
      )}
    </>
  );
}

function ConfirmTerminalTransitionModal({
  target,
  siblingCount,
  isPending,
  onCancel,
  onConfirm,
}: {
  target: TerminalTarget;
  siblingCount: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const targetLabel = titleCase(target);
  const plural = siblingCount === 1 ? "treatment" : "treatments";

  // Default focus on Cancel — the safe default so a stray Enter
  // dismisses rather than confirms a terminal state transition.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          width: "100%",
          maxWidth: 480,
          padding: 24,
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f1f5f9" }}>
          Transition this treatment?
        </h3>
        <p className="text-sm mt-3" style={{ color: "#cbd5e1", lineHeight: 1.5 }}>
          This risk has {siblingCount} other open {plural}. Marking this
          treatment as <strong>{targetLabel}</strong> will change the risk's
          status to <strong>{targetLabel}</strong>. Other treatments will
          remain at their current status. Continue?
        </p>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm"
            style={{
              border: "1px solid #1e293b",
              background: "transparent",
              color: "#cbd5e1",
              cursor: isPending ? "wait" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: isPending ? "#1e293b" : "#00c4b4",
              color: isPending ? "#94a3b8" : "#0a0f1a",
              border: "none",
              cursor: isPending ? "wait" : "pointer",
            }}
          >
            {isPending ? "Working…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
