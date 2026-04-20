"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeReview } from "./review/actions";
import type { VendorReview } from "@/lib/api";

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

const COMPLETION_STATUSES = [
  { value: "satisfactory",        label: "Satisfactory",        color: "#86efac" },
  { value: "concerns_identified", label: "Concerns Identified", color: "#fcd34d" },
  { value: "critical_issues",     label: "Critical Issues",     color: "#fca5a5" },
] as const;

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

const FINDING_STATUSES = new Set(["concerns_identified", "critical_issues"]);

function CompleteReviewCard({
  review,
  vendorId,
}: {
  review: VendorReview;
  vendorId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>("satisfactory");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const requiresSeverity = FINDING_STATUSES.has(status);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await completeReview(review.id, vendorId, formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSuccessMsg(
          result.findingCreated
            ? "Review completed. Finding created."
            : "Review completed."
        );
        router.refresh();
      }
    });
  }

  const statusLabel = review.summary
    ? `"${review.summary.slice(0, 60)}${review.summary.length > 60 ? "…" : ""}"`
    : `Review started ${new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div
      className="rounded-xl border p-5 space-y-4"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e2d45" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium" style={{ color: "#f1f5f9" }}>
            Complete Review
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
            {statusLabel}
          </p>
        </div>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0"
          style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd" }}
        >
          In Progress
        </span>
      </div>

      {successMsg ? (
        <div
          className="rounded-lg px-4 py-3 text-sm font-medium"
          style={{ background: "rgba(34,197,94,0.12)", color: "#86efac" }}
        >
          {successMsg}
        </div>
      ) : (
        <form action={handleSubmit} className="space-y-4">
          {/* Status selector */}
          <div>
            <label style={LABEL_STYLE}>Outcome *</label>
            <div className="flex gap-2 flex-wrap">
              {COMPLETION_STATUSES.map((s) => (
                <label
                  key={s.value}
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border text-xs font-semibold transition-colors"
                  style={{
                    borderColor: status === s.value ? s.color : "#1e293b",
                    background: status === s.value ? `rgba(0,0,0,0.3)` : "transparent",
                    color: status === s.value ? s.color : "#64748b",
                  }}
                >
                  <input
                    type="radio"
                    name="completion_status"
                    value={s.value}
                    checked={status === s.value}
                    onChange={() => setStatus(s.value)}
                    className="sr-only"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          {/* Severity — required for concerns/critical */}
          {requiresSeverity && (
            <div>
              <label style={LABEL_STYLE}>Severity *</label>
              <select name="completion_severity" required style={INPUT_STYLE}>
                <option value="">Select severity…</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Summary — required */}
          <div>
            <label style={LABEL_STYLE}>Summary *</label>
            <textarea
              name="completion_summary"
              required
              rows={3}
              placeholder="Describe the outcome of this review…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {/* Notes — optional */}
          <div>
            <label style={LABEL_STYLE}>Notes (optional)</label>
            <textarea
              name="completion_notes"
              rows={2}
              placeholder="Additional context or evidence references…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {error && (
            <p
              className="text-sm px-3 py-2 rounded-lg"
              style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {isPending ? "Completing…" : "Complete Review"}
          </button>
        </form>
      )}
    </div>
  );
}

export function CompleteReviewSection({
  inProgressReviews,
  vendorId,
}: {
  inProgressReviews: VendorReview[];
  vendorId: string;
}) {
  if (inProgressReviews.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: "#94a3b8" }}
        >
          Complete Review
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd" }}
        >
          {inProgressReviews.length}
        </span>
      </div>
      <div className="space-y-4">
        {inProgressReviews.map((r) => (
          <CompleteReviewCard key={r.id} review={r} vendorId={vendorId} />
        ))}
      </div>
    </section>
  );
}
