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

const CONTROL_TYPE_OPTIONS = [
  { value: "",             label: "— Not set —" },
  { value: "preventive",   label: "Preventive" },
  { value: "detective",    label: "Detective" },
  { value: "corrective",   label: "Corrective" },
  { value: "deterrent",    label: "Deterrent" },
  { value: "compensating", label: "Compensating" },
  { value: "directive",    label: "Directive" },
];

const DOMAIN_OPTIONS = [
  { value: "",                  label: "— Not set —" },
  { value: "access_management", label: "Access Management" },
  { value: "vendor_risk",       label: "Vendor Risk" },
  { value: "ai_governance",     label: "AI Governance" },
  { value: "regulatory",        label: "Regulatory" },
  { value: "vulnerability",     label: "Vulnerability" },
  { value: "resilience",        label: "Resilience" },
  { value: "general",           label: "General" },
];

const MATURITY_OPTIONS = [
  { value: "",           label: "— Not set —" },
  { value: "initial",    label: "Initial" },
  { value: "managed",    label: "Managed" },
  { value: "defined",    label: "Defined" },
  { value: "optimizing", label: "Optimizing" },
  { value: "optimized",  label: "Optimized" },
];

const IMPL_STATUS_OPTIONS = [
  { value: "",             label: "— Not set —" },
  { value: "not_started",  label: "Not Started" },
  { value: "in_progress",  label: "In Progress" },
  { value: "implemented",  label: "Implemented" },
  { value: "verified",     label: "Verified" },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-2 pb-1" style={{ borderTop: "1px solid #1e2d45" }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>
        {children}
      </p>
    </div>
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

          {/* ── Classification ── */}
          <SectionHeading>Classification</SectionHeading>

          {/* Control Type */}
          <div>
            <FieldLabel>Control Type</FieldLabel>
            <select name="control_type" className={inputClass} style={inputStyle} disabled={submitting}>
              {CONTROL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Domain */}
          <div>
            <FieldLabel>Domain</FieldLabel>
            <select name="domain" className={inputClass} style={inputStyle} disabled={submitting}>
              {DOMAIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Control Family */}
          <div>
            <FieldLabel>Control Family</FieldLabel>
            <input
              type="text"
              name="control_family"
              placeholder="e.g. Access Control, Audit and Accountability"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Maturity Level */}
          <div>
            <FieldLabel>Maturity Level</FieldLabel>
            <select name="maturity_level" className={inputClass} style={inputStyle} disabled={submitting}>
              {MATURITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Implementation Status */}
          <div>
            <FieldLabel>Implementation Status</FieldLabel>
            <select name="implementation_status" className={inputClass} style={inputStyle} disabled={submitting}>
              {IMPL_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
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
