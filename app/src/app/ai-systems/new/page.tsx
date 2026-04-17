"use client";

import { useState } from "react";
import Link from "next/link";
import { createAiSystem, type CreateAiSystemResult } from "./actions";

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

export default function NewAiSystemPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result: CreateAiSystemResult | void = await createAiSystem(formData);

    if (result && "error" in result) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success createAiSystem redirects — nothing else to do
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href="/ai-systems"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← AI Systems
      </Link>

      <h1 className="text-2xl font-bold mb-8" style={{ color: "#f1f5f9" }}>
        Add AI System
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
              placeholder="e.g. Customer Support Bot, Fraud Detection Model"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Criticality */}
          <div>
            <FieldLabel required>Criticality</FieldLabel>
            <select
              name="criticality"
              required
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
              defaultValue=""
            >
              <option value="" style={{ background: "#0a0f1a" }}>Select criticality…</option>
              <option value="critical" style={{ background: "#0a0f1a" }}>Critical</option>
              <option value="high"     style={{ background: "#0a0f1a" }}>High</option>
              <option value="medium"   style={{ background: "#0a0f1a" }}>Medium</option>
              <option value="low"      style={{ background: "#0a0f1a" }}>Low</option>
            </select>
          </div>

          {/* Use Case */}
          <div>
            <FieldLabel>Use Case</FieldLabel>
            <textarea
              name="use_case"
              rows={3}
              placeholder="Describe what this AI system does and how it is used"
              className={`${inputClass} resize-none`}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Model Type */}
          <div>
            <FieldLabel>Model Type</FieldLabel>
            <input
              type="text"
              name="model_type"
              placeholder="e.g. LLM, Classification, Computer Vision"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Deployment Status */}
          <div>
            <FieldLabel>Deployment Status</FieldLabel>
            <input
              type="text"
              name="deployment_status"
              placeholder="e.g. production, staging, development, decommissioned"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Data Classification */}
          <div>
            <FieldLabel>Data Classification</FieldLabel>
            <input
              type="text"
              name="data_classification"
              placeholder="e.g. confidential, internal, public"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Risk Classification */}
          <div>
            <FieldLabel>Risk Classification</FieldLabel>
            <input
              type="text"
              name="risk_classification"
              placeholder="e.g. High Risk, Limited Risk, Minimal Risk (EU AI Act)"
              className={inputClass}
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
              {submitting ? "Adding…" : "Add AI System"}
            </button>
            <Link
              href="/ai-systems"
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
