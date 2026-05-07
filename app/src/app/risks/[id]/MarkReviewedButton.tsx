"use client";

/**
 * MarkReviewedButton (RR-5) — header-strip control on the risk detail
 * page. Opens a small inline form (date + optional note ≤500 chars)
 * that calls POST /api/risks/:id/review through markRiskReviewedAction.
 *
 * The reviewed_at field defaults to today on the server when blank;
 * the form leaves it blank by default and lets the user override (real
 * back-dated reviews are common — DEV-RR1).
 *
 * The note is recorded only in the audit payload (DEV-RR2). It does
 * not get stored on the risk row itself.
 */

import { useState, useTransition } from "react";
import { markRiskReviewedAction } from "./actions";

const NOTE_MAX_LEN = 500;

export function MarkReviewedButton({ riskId }: { riskId: string }) {
  const [open, setOpen]               = useState(false);
  const [reviewedAt, setReviewedAt]   = useState("");
  const [note, setNote]               = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [isPending, startTransition]  = useTransition();

  function handleSubmit() {
    setError(null);
    if (note.length > NOTE_MAX_LEN) {
      setError(`Note must be ${NOTE_MAX_LEN} characters or fewer.`);
      return;
    }
    startTransition(async () => {
      const result = await markRiskReviewedAction(riskId, {
        reviewed_at: reviewedAt.trim() === "" ? null : reviewedAt.trim(),
        note:        note.trim() === "" ? null : note.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReviewedAt("");
      setNote("");
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
        style={{
          border: "1px solid #00c4b4",
          color: "#00c4b4",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        Mark Reviewed
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "var(--color-brand-surface, #111827)",
        borderColor: "#1e293b",
        minWidth: 280,
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Mark Reviewed
      </p>

      <div className="mb-3">
        <label className="block text-xs mb-1.5" style={{ color: "#64748b" }}>
          Reviewed on
        </label>
        <input
          type="date"
          value={reviewedAt}
          onChange={(e) => setReviewedAt(e.target.value)}
          className="w-full text-xs rounded px-2 py-1.5"
          style={{ background: "#0a0f1a", border: "1px solid #1e293b", color: "#f1f5f9" }}
        />
        <p className="text-xs mt-1" style={{ color: "#334155" }}>
          Defaults to today. Use an earlier date to record a back-dated review.
        </p>
      </div>

      <div className="mb-3">
        <label className="block text-xs mb-1.5" style={{ color: "#64748b" }}>
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX_LEN}
          rows={3}
          placeholder="What was reviewed? Any rationale to capture?"
          className="w-full text-xs rounded px-2 py-1.5"
          style={{ background: "#0a0f1a", border: "1px solid #1e293b", color: "#f1f5f9", resize: "vertical" }}
        />
        <p className="text-xs mt-1 text-right" style={{ color: note.length > NOTE_MAX_LEN ? "#fca5a5" : "#334155" }}>
          {note.length} / {NOTE_MAX_LEN}
        </p>
      </div>

      {error && (
        <p className="text-xs mb-3" style={{ color: "#fca5a5" }}>{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {isPending ? "Saving…" : "Save Review"}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          disabled={isPending}
          className="text-xs transition-opacity hover:opacity-70"
          style={{ color: "#475569" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
