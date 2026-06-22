"use client";

import { useState } from "react";
import Link from "next/link";
import { createVendor, type CreateVendorResult } from "./actions";

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

export default function NewVendorClient() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result: CreateVendorResult | void = await createVendor(formData);

    if (result && "error" in result) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success createVendor redirects — nothing else to do
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Back link */}
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Vendors
      </Link>

      <h1 className="text-2xl font-bold mb-8" style={{ color: "#f1f5f9" }}>
        Add Vendor
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
              placeholder="e.g. Stripe, AWS, Okta"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Criticality */}
          <div>
            <FieldLabel>Criticality</FieldLabel>
            <select
              name="criticality"
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

          {/* Category */}
          <div>
            <FieldLabel>Category</FieldLabel>
            <input
              type="text"
              name="category"
              placeholder="e.g. Cloud Infrastructure, Payment Processing"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Service Description */}
          <div>
            <FieldLabel>Service Description</FieldLabel>
            <textarea
              name="service_description"
              rows={3}
              placeholder="Brief description of the service this vendor provides…"
              className={`${inputClass} resize-none`}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Data Sensitivity */}
          <div>
            <FieldLabel>Data Sensitivity</FieldLabel>
            <select
              name="data_sensitivity"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
              defaultValue=""
            >
              <option value="" style={{ background: "#0a0f1a" }}>Select data sensitivity…</option>
              <option value="none"         style={{ background: "#0a0f1a" }}>None</option>
              <option value="internal"     style={{ background: "#0a0f1a" }}>Internal</option>
              <option value="confidential" style={{ background: "#0a0f1a" }}>Confidential</option>
              <option value="restricted"   style={{ background: "#0a0f1a" }}>Restricted</option>
            </select>
          </div>

          {/* Access Level */}
          <div>
            <FieldLabel>Access Level</FieldLabel>
            <select
              name="access_level"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
              defaultValue=""
            >
              <option value="" style={{ background: "#0a0f1a" }}>Select access level…</option>
              <option value="none"           style={{ background: "#0a0f1a" }}>None</option>
              <option value="read_only"      style={{ background: "#0a0f1a" }}>Read Only</option>
              <option value="read_write"     style={{ background: "#0a0f1a" }}>Read / Write</option>
              <option value="admin"          style={{ background: "#0a0f1a" }}>Admin</option>
              <option value="network_access" style={{ background: "#0a0f1a" }}>Network Access</option>
            </select>
          </div>

          {/* Website */}
          <div>
            <FieldLabel>Website</FieldLabel>
            <input
              type="text"
              name="website"
              placeholder="e.g. https://stripe.com"
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" }}
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
              {submitting ? "Adding…" : "Add Vendor"}
            </button>
            <Link
              href="/vendors"
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
