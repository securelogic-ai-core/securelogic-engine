"use client";

import { useState } from "react";
import Link from "next/link";
import { createControl, type CreateControlResult } from "./actions";

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

export default function NewControlPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result: CreateControlResult | void = await createControl(formData);

    if (result && "error" in result) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success createControl redirects — nothing else to do
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href="/controls"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Controls
      </Link>

      <h1 className="text-2xl font-bold mb-8" style={{ color: "#f1f5f9" }}>
        Add Control
      </h1>

      <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <FieldLabel required>Name</FieldLabel>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. MFA Enforcement, Encryption at Rest"
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
              rows={4}
              placeholder="Brief description of what this control covers and how it is implemented…"
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
              {submitting ? "Adding…" : "Add Control"}
            </button>
            <Link
              href="/controls"
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
