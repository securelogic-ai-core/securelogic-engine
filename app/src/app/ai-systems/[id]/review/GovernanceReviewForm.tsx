"use client";

import { useState, useTransition } from "react";
import { createGovernanceReview, type CreateGovernanceReviewResult } from "./actions";

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

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

const SEVERITY_COLORS: Record<string, { bg: string; color: string; activeBg: string }> = {
  Critical: { bg: "rgba(239,68,68,0.08)", color: "#fca5a5", activeBg: "rgba(239,68,68,0.25)" },
  High:     { bg: "rgba(249,115,22,0.08)", color: "#fdba74", activeBg: "rgba(249,115,22,0.25)" },
  Moderate: { bg: "rgba(245,158,11,0.08)", color: "#fcd34d", activeBg: "rgba(245,158,11,0.25)" },
  Low:      { bg: "rgba(34,197,94,0.08)",  color: "#86efac", activeBg: "rgba(34,197,94,0.25)" },
};

type Props = {
  systemId: string;
  systemName: string;
};

export function GovernanceReviewForm({ systemId, systemName }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createGovernanceReview(systemId, formData)) as CreateGovernanceReviewResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Warning card */}
      <div
        className="rounded-xl border p-4 flex items-start gap-3"
        style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.3)" }}
      >
        <span className="text-sm" style={{ color: "#fcd34d" }}>⚠</span>
        <p className="text-sm leading-relaxed" style={{ color: "#fcd34d" }}>
          Every governance review automatically creates a finding in this AI system&apos;s risk record. This cannot be undone.
        </p>
      </div>

      <form action={handleSubmit} className="space-y-6">
        {/* Hidden severity input so formData picks it up */}
        <input type="hidden" name="overall_severity" value={selectedSeverity} />

        <div
          className="rounded-xl border p-6 space-y-5"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Review Details — {systemName}
          </h2>

          {/* Review Type */}
          <div>
            <label style={LABEL_STYLE}>Review Type *</label>
            <input
              type="text"
              name="review_type"
              required
              placeholder="e.g. Initial Risk Assessment, Annual Review, Pre-deployment Review, Regulatory Compliance Check, Bias Evaluation, Security Audit"
              style={INPUT_STYLE}
            />
          </div>

          {/* Overall Severity — button group, required, no default */}
          <div>
            <label style={LABEL_STYLE}>Overall Severity *</label>
            <div className="flex items-center gap-2 flex-wrap">
              {SEVERITIES.map((s) => {
                const colors = SEVERITY_COLORS[s]!;
                const isActive = selectedSeverity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSeverity(s)}
                    className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      background: isActive ? colors.activeBg : colors.bg,
                      color: colors.color,
                      border: `1px solid ${isActive ? colors.color : "transparent"}`,
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {!selectedSeverity && (
              <p className="text-xs mt-1.5" style={{ color: "#475569" }}>
                Select a severity — this is required and will be used for the finding.
              </p>
            )}
          </div>

          {/* Summary */}
          <div>
            <label style={LABEL_STYLE}>Summary</label>
            <textarea
              name="summary"
              rows={6}
              placeholder="Describe what was reviewed, key findings, and overall conclusions…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
            <p className="text-xs mt-1.5" style={{ color: "#475569" }}>
              This will become the finding description if provided.
            </p>
          </div>

          {/* Outcome */}
          <div>
            <label style={LABEL_STYLE}>Outcome</label>
            <textarea
              name="outcome"
              rows={3}
              placeholder="The outcome or verdict of this review (e.g. Approved for production, Requires remediation, Review in progress)…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {/* Performed At */}
          <div>
            <label style={LABEL_STYLE}>Performed At *</label>
            <input
              type="date"
              name="performed_at"
              required
              defaultValue={new Date().toISOString().split("T")[0]}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {error && (
          <p
            className="text-sm px-4 py-3 rounded-lg"
            style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || !selectedSeverity}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {isPending ? "Recording…" : "Record Review"}
          </button>
          <a
            href={`/ai-systems/${systemId}`}
            className="px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ color: "#94a3b8" }}
          >
            ← Cancel
          </a>
        </div>

        <p className="text-xs" style={{ color: "#475569" }}>
          A finding will be created automatically when this review is recorded.
        </p>
      </form>
    </div>
  );
}
