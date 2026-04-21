"use client";

import { useState } from "react";
import Link from "next/link";
import { updateControlAction, deleteControlAction, type ControlEditData } from "./actions";
import type { Control } from "@/lib/api";

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

const FREQUENCY_OPTIONS = [
  { value: "",         label: "— Not set —" },
  { value: "monthly",  label: "Monthly" },
  { value: "quarterly",label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
  { value: "annual",   label: "Annual" },
  { value: "ad_hoc",   label: "Ad-hoc" },
];

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

type DeleteResult = { error: string; details?: { assessments?: number; framework_mappings?: number } };

export function EditControlForm({ control }: { control: Control }) {
  const [name, setName]                         = useState(control.name);
  const [description, setDescription]           = useState(control.description ?? "");
  const [frequency, setFrequency]               = useState(control.testing_frequency ?? "");
  const [nextTestDue, setNextTestDue]           = useState(control.next_test_due?.slice(0, 10) ?? "");
  const [controlType, setControlType]           = useState(control.control_type ?? "");
  const [domain, setDomain]                     = useState(control.domain ?? "");
  const [controlFamily, setControlFamily]       = useState(control.control_family ?? "");
  const [maturityLevel, setMaturityLevel]       = useState(control.maturity_level ?? "");
  const [implStatus, setImplStatus]             = useState(control.implementation_status ?? "");
  const [saving, setSaving]                     = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [deleting, setDeleting]                 = useState(false);
  const [deleteError, setDeleteError]           = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete]       = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Control name is required."); return; }
    setSaving(true);
    setError(null);

    const data: ControlEditData = {
      name:                  name.trim(),
      description:           description.trim() || null,
      testing_frequency:     frequency || null,
      next_test_due:         nextTestDue || null,
      control_type:          controlType || null,
      domain:                domain || null,
      control_family:        controlFamily.trim() || null,
      maturity_level:        maturityLevel || null,
      implementation_status: implStatus || null,
    };

    const result = await updateControlAction(control.id, data);
    if (result && "error" in result) {
      setError(result.error);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);

    const result = await deleteControlAction(control.id) as DeleteResult | never;
    if (result && "error" in result) {
      if (result.error === "has_children") {
        const d = result.details ?? {};
        const assessments = d.assessments ?? 0;
        const mappings    = d.framework_mappings ?? 0;
        const parts: string[] = [];
        if (assessments > 0) parts.push(`${assessments} assessment${assessments !== 1 ? "s" : ""}`);
        if (mappings > 0)    parts.push(`${mappings} framework mapping${mappings !== 1 ? "s" : ""}`);
        setDeleteError(`Cannot delete: this control has ${parts.join(" and ")}. Remove those first.`);
      } else {
        setDeleteError(result.error);
      }
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const fieldClass = "w-full rounded-lg px-3 py-2 text-sm border outline-none";

  return (
    <>
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
              className={fieldClass}
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${fieldClass} resize-none`}
              style={inputStyle}
              placeholder="Describe what this control covers"
            />
          </div>

          {/* ── Classification ── */}
          <div className="pt-2 pb-1" style={{ borderTop: "1px solid #1e2d45" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>
              Classification
            </p>
          </div>

          {/* Control Type */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Control Type
            </label>
            <select value={controlType} onChange={(e) => setControlType(e.target.value)} className={fieldClass} style={inputStyle}>
              {CONTROL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Domain */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Domain
            </label>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className={fieldClass} style={inputStyle}>
              {DOMAIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Control Family */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Control Family
            </label>
            <input
              type="text"
              value={controlFamily}
              onChange={(e) => setControlFamily(e.target.value)}
              placeholder="e.g. Access Control, Audit and Accountability"
              className={fieldClass}
              style={inputStyle}
            />
          </div>

          {/* Maturity Level */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Maturity Level
            </label>
            <select value={maturityLevel} onChange={(e) => setMaturityLevel(e.target.value)} className={fieldClass} style={inputStyle}>
              {MATURITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Implementation Status */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Implementation Status
            </label>
            <select value={implStatus} onChange={(e) => setImplStatus(e.target.value)} className={fieldClass} style={inputStyle}>
              {IMPL_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* ── Testing Schedule ── */}
          <div className="pt-2 pb-1" style={{ borderTop: "1px solid #1e2d45" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>
              Testing Schedule
            </p>
          </div>

          {/* Testing Frequency */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Testing Frequency
            </label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={fieldClass} style={inputStyle}>
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Next Test Due */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Next Test Due
            </label>
            <input
              type="date"
              value={nextTestDue}
              onChange={(e) => setNextTestDue(e.target.value)}
              className={fieldClass}
              style={inputStyle}
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
            href={`/controls/${control.id}`}
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "#94a3b8" }}
          >
            ← Back to Control
          </Link>
        </div>
      </form>

      {/* Delete section */}
      <div className="mt-10 pt-8" style={{ borderTop: "1px solid #1e2d45" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#475569" }}>
          Danger Zone
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Delete this control
          </button>
        ) : (
          <div
            className="rounded-lg px-4 py-4 space-y-3"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <p className="text-sm font-medium" style={{ color: "#fca5a5" }}>
              Are you sure? This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-xs" style={{ color: "#fca5a5" }}>{deleteError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                className="text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
