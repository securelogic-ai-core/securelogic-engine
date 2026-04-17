"use client";

import { useState, useTransition } from "react";
import { createFinding, type CreateFindingResult } from "./actions";

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
const PRIORITIES = [
  { value: "immediate", label: "Immediate" },
  { value: "near_term", label: "Near Term" },
  { value: "planned", label: "Planned" },
  { value: "watch", label: "Watch" },
] as const;

type Props = { vendorId: string };

export function FindingForm({ vendorId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createFinding(vendorId, formData)) as CreateFindingResult | void;
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
        {/* Title */}
        <div>
          <label style={LABEL_STYLE}>Title *</label>
          <input
            type="text"
            name="title"
            required
            placeholder="e.g. No MFA on vendor admin portal"
            style={INPUT_STYLE}
          />
        </div>

        {/* Severity */}
        <div>
          <label style={LABEL_STYLE}>Severity *</label>
          <select name="severity" required style={INPUT_STYLE}>
            <option value="">Select severity…</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label style={LABEL_STYLE}>Priority</label>
          <select name="priority" style={INPUT_STYLE}>
            <option value="">Not set</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label style={LABEL_STYLE}>Description</label>
          <textarea
            name="description"
            rows={4}
            placeholder="Describe the finding in detail — what was observed, where, and when…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>

        {/* Remediation Notes */}
        <div>
          <label style={LABEL_STYLE}>Remediation Notes</label>
          <textarea
            name="remediation_notes"
            rows={3}
            placeholder="Recommended remediation steps or accepted risk justification…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>
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
          {isPending ? "Saving…" : "Create Finding"}
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
