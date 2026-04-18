"use client";

import { useState } from "react";
import Link from "next/link";
import { updateVendorAction, type VendorEditData } from "./actions";
import type { Vendor } from "@/lib/api";

const inputStyle: React.CSSProperties = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};

const cardStyle: React.CSSProperties = {
  background: "var(--brand-surface, #0d1626)",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
};

const CRITICALITY_OPTIONS = [
  { value: "",         label: "— None —" },
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];

const DATA_SENSITIVITY_OPTIONS = [
  { value: "",             label: "— None —" },
  { value: "none",         label: "None" },
  { value: "internal",     label: "Internal" },
  { value: "confidential", label: "Confidential" },
  { value: "restricted",   label: "Restricted" },
];

const ACCESS_LEVEL_OPTIONS = [
  { value: "",               label: "— None —" },
  { value: "none",           label: "None" },
  { value: "read_only",      label: "Read Only" },
  { value: "read_write",     label: "Read / Write" },
  { value: "admin",          label: "Admin" },
  { value: "network_access", label: "Network Access" },
];

export function EditVendorForm({ vendor }: { vendor: Vendor }) {
  const [name, setName]                       = useState(vendor.name);
  const [category, setCategory]               = useState(vendor.category ?? "");
  const [criticality, setCriticality]         = useState(vendor.criticality ?? "");
  const [dataSensitivity, setDataSensitivity] = useState(vendor.data_sensitivity ?? "");
  const [accessLevel, setAccessLevel]         = useState(vendor.access_level ?? "");
  const [description, setDescription]         = useState(vendor.service_description ?? "");
  const [website, setWebsite]                 = useState(vendor.website ?? "");
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Vendor name is required."); return; }
    setSaving(true);
    setError(null);

    const data: VendorEditData = {
      name:                name.trim(),
      category:            category.trim()        || null,
      criticality:         criticality            || null,
      data_sensitivity:    dataSensitivity        || null,
      access_level:        accessLevel            || null,
      service_description: description.trim()     || null,
      website:             website.trim()         || null,
    };

    const result = await updateVendorAction(vendor.id, data);
    // updateVendorAction redirects on success; if we get here it returned an error
    if (result && "error" in result) {
      setError(result.error);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={cardStyle} className="p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Name <span style={{ color: "#fca5a5" }}>*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Category
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
            placeholder="e.g. Cloud Infrastructure"
          />
        </div>

        {/* Criticality */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Criticality
          </label>
          <select
            value={criticality}
            onChange={(e) => setCriticality(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          >
            {CRITICALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Data Sensitivity */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Data Sensitivity
          </label>
          <select
            value={dataSensitivity}
            onChange={(e) => setDataSensitivity(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          >
            {DATA_SENSITIVITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Access Level */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Access Level
          </label>
          <select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          >
            {ACCESS_LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Service Description */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none resize-none"
            style={inputStyle}
            placeholder="Describe the service this vendor provides"
          />
        </div>

        {/* Website */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Website
          </label>
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
            placeholder="https://example.com"
          />
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 mt-6">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <Link
          href={`/vendors/${vendor.id}`}
          className="text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Back
        </Link>
      </div>
    </form>
  );
}
