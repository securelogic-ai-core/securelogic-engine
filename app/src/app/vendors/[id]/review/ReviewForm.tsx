"use client";

import { useState, useTransition } from "react";
import { createReview, type CreateReviewResult } from "./actions";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #1e293b",
  background: "#0a0f1a",
  color: "#f1f5f9",
  fontSize: "14px",
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: "6px",
};

const STATUSES = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
] as const;

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

type Props = { vendorId: string };

export function ReviewForm({ vendorId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createReview(vendorId, formData)) as CreateReviewResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit}>
      <div
        className="rounded-xl border p-6 space-y-5 mb-6"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Review Details
        </h2>

        {/* Status */}
        <div>
          <label style={LABEL_STYLE}>Initial Status *</label>
          <select name="status" required defaultValue="in_progress" style={INPUT_STYLE}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1.5" style={{ color: "#64748b" }}>
            Reviews transition to Satisfactory, Concerns Identified, or Critical Issues via the vendor detail page.
          </p>
        </div>

        {/* Overall Severity */}
        <div>
          <label style={LABEL_STYLE}>Initial Severity (optional)</label>
          <select name="overall_severity" style={INPUT_STYLE}>
            <option value="">Not yet determined</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Performed At */}
        <div>
          <label style={LABEL_STYLE}>Review Start Date</label>
          <input
            type="date"
            name="performed_at"
            defaultValue={new Date().toISOString().split("T")[0]}
            style={INPUT_STYLE}
          />
        </div>

        {/* Summary */}
        <div>
          <label style={LABEL_STYLE}>Summary</label>
          <textarea
            name="summary"
            rows={3}
            placeholder="Brief description of this review cycle…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>

        {/* Notes */}
        <div>
          <label style={LABEL_STYLE}>Notes</label>
          <textarea
            name="notes"
            rows={4}
            placeholder="Scope, evidence gathered, open questions…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>
      </div>

      <div
        className="rounded-xl border p-4 mb-6"
        style={{ background: "rgba(59,130,246,0.05)", borderColor: "rgba(59,130,246,0.15)" }}
      >
        <p className="text-xs" style={{ color: "#93c5fd" }}>
          <strong>Finding creation:</strong> A finding is automatically created when this review is
          transitioned to "Concerns Identified" or "Critical Issues" — not when opened.
        </p>
      </div>

      {error && (
        <p className="text-sm px-4 py-3 rounded-lg mb-4" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {isPending ? "Opening…" : "Open Review"}
        </button>
        <a
          href={`/vendors/${vendorId}`}
          className="px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{ color: "#94a3b8" }}
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
