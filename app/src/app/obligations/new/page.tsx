"use client";

import { useState } from "react";
import Link from "next/link";
import { createObligation, type CreateObligationResult } from "./actions";

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};

const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className={labelClass} style={{ color: "#94a3b8" }}>
      {children}
      {required && <span style={{ color: "#fca5a5" }}> *</span>}
    </label>
  );
}

export default function NewObligationPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result: CreateObligationResult | void = await createObligation(formData);

    if (result && "error" in result) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success createObligation redirects — nothing else to do
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href="/obligations"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Obligations
      </Link>

      <h1 className="text-2xl font-bold mb-8" style={{ color: "#f1f5f9" }}>
        Add Obligation
      </h1>

      <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <FieldLabel required>Title</FieldLabel>
            <input
              type="text"
              name="title"
              required
              placeholder="e.g. Annual Security Risk Assessment"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Source Regulation */}
          <div>
            <FieldLabel>Source Regulation</FieldLabel>
            <input
              type="text"
              name="source_regulation"
              placeholder="e.g. HIPAA §164.312, GDPR Art. 32"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Domain */}
          <div>
            <FieldLabel>Domain</FieldLabel>
            <input
              type="text"
              name="domain"
              placeholder="e.g. Data Privacy, Security, AI Governance"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Priority */}
          <div>
            <FieldLabel>Priority</FieldLabel>
            <select
              name="priority"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
              defaultValue=""
            >
              <option value="" style={{ background: "#0a0f1a" }}>Select priority…</option>
              <option value="immediate" style={{ background: "#0a0f1a" }}>Immediate</option>
              <option value="near_term" style={{ background: "#0a0f1a" }}>Near Term</option>
              <option value="planned"   style={{ background: "#0a0f1a" }}>Planned</option>
              <option value="watch"     style={{ background: "#0a0f1a" }}>Watch</option>
            </select>
          </div>

          {/* Due Date */}
          <div>
            <FieldLabel>Due Date</FieldLabel>
            <input
              type="date"
              name="due_date"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Description */}
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              name="description"
              rows={3}
              placeholder="Brief description of this compliance obligation…"
              className={`${inputClass} resize-none`}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              name="notes"
              rows={2}
              placeholder="Internal notes or context…"
              className={`${inputClass} resize-none`}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: "rgba(239,68,68,0.12)",
                color: "#fca5a5",
                border: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              {submitting ? "Adding…" : "Add Obligation"}
            </button>
            <Link
              href="/obligations"
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "#94a3b8" }}
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
