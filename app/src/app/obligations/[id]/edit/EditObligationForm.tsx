"use client";

import { useState } from "react";
import Link from "next/link";
import { updateObligationAction, type ObligationEditData } from "./actions";
import type { Obligation } from "@/lib/api";

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

const STATUS_OPTIONS = [
  { value: "active",         label: "Active" },
  { value: "waived",         label: "Waived" },
  { value: "not_applicable", label: "Not Applicable" },
];

const PRIORITY_OPTIONS = [
  { value: "",          label: "— Not set —" },
  { value: "immediate", label: "Immediate" },
  { value: "near_term", label: "Near Term" },
  { value: "planned",   label: "Planned" },
  { value: "watch",     label: "Watch" },
];

export function EditObligationForm({ obligation }: { obligation: Obligation }) {
  const [title, setTitle]                     = useState(obligation.title);
  const [description, setDescription]         = useState(obligation.description ?? "");
  const [sourceRegulation, setSourceRegulation] = useState(obligation.source_regulation ?? "");
  const [jurisdiction, setJurisdiction]       = useState(obligation.jurisdiction ?? "");
  const [domain, setDomain]                   = useState(obligation.domain ?? "");
  const [status, setStatus]                   = useState<string>(obligation.status);
  const [priority, setPriority]               = useState(obligation.priority ?? "");
  const [dueDate, setDueDate]                 = useState(obligation.due_date?.slice(0, 10) ?? "");
  const [notes, setNotes]                     = useState(obligation.notes ?? "");
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);

    const data: ObligationEditData = {
      title:             title.trim(),
      description:       description.trim()       || null,
      source_regulation: sourceRegulation.trim()  || null,
      jurisdiction:      jurisdiction.trim()       || null,
      domain:            domain.trim()             || null,
      status,
      priority:          priority                  || null,
      due_date:          dueDate                   || null,
      notes:             notes.trim()              || null,
    };

    const result = await updateObligationAction(obligation.id, data);
    if (result && "error" in result) {
      setError(result.error);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={cardStyle} className="p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Title <span style={{ color: "#fca5a5" }}>*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
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
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none resize-none"
            style={inputStyle}
          />
        </div>

        {/* Source Regulation */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Source Regulation
          </label>
          <input
            type="text"
            value={sourceRegulation}
            onChange={(e) => setSourceRegulation(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
            placeholder="e.g. GDPR Article 32"
          />
        </div>

        {/* Jurisdiction */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Jurisdiction
          </label>
          <input
            type="text"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
            placeholder="e.g. EU, USA, Global"
          />
        </div>

        {/* Domain */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Domain
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm border outline-none resize-none"
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
          href={`/obligations/${obligation.id}`}
          className="text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Back to Obligation
        </Link>
      </div>
    </form>
  );
}
