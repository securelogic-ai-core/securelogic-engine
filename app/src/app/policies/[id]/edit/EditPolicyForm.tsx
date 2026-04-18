"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Policy } from "@/lib/api";
import { updatePolicyAction } from "./actions";

const CATEGORY_OPTIONS = [
  { value: "access_control",           label: "Access Control" },
  { value: "incident_response",        label: "Incident Response" },
  { value: "change_management",        label: "Change Management" },
  { value: "data_classification",      label: "Data Classification" },
  { value: "business_continuity",      label: "Business Continuity" },
  { value: "acceptable_use",           label: "Acceptable Use" },
  { value: "vendor_management",        label: "Vendor Management" },
  { value: "vulnerability_management", label: "Vulnerability Management" },
  { value: "other",                    label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "draft",        label: "Draft" },
  { value: "active",       label: "Active" },
  { value: "under_review", label: "Under Review" },
  { value: "retired",      label: "Retired" },
];

const FREQUENCY_OPTIONS = [
  { value: "",          label: "— None —" },
  { value: "annual",    label: "Annual" },
  { value: "biannual",  label: "Biannual" },
  { value: "ad_hoc",    label: "Ad-hoc" },
];

const fieldStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.6)",
  border: "1px solid #1e2d45",
  borderRadius: "8px",
  color: "#f1f5f9",
  padding: "8px 12px",
  fontSize: "14px",
  width: "100%",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

interface Props {
  policy: Policy;
}

export function EditPolicyForm({ policy }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [category, setCategory] = useState(policy.category);
  const [version, setVersion] = useState(policy.version ?? "");
  const [owner, setOwner] = useState(policy.owner ?? "");
  const [status, setStatus] = useState<string>(policy.status);
  const [reviewFrequency, setReviewFrequency] = useState(policy.review_frequency ?? "");
  const [lastReviewedAt, setLastReviewedAt] = useState(policy.last_reviewed_at ?? "");
  const [nextReviewAt, setNextReviewAt] = useState(policy.next_review_at ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Policy name is required.");
      return;
    }

    startTransition(async () => {
      const result = await updatePolicyAction(policy.id, {
        name: name.trim(),
        description: description.trim() || null,
        category,
        version: version.trim() || null,
        owner: owner.trim() || null,
        status,
        review_frequency: reviewFrequency || null,
        last_reviewed_at: lastReviewedAt || null,
        next_review_at: nextReviewAt || null,
      });
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div>
        <label style={labelStyle}>Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={fieldStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ ...fieldStyle, resize: "vertical" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Version</label>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="e.g. 2.1"
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Owner</label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. Security Team"
            style={fieldStyle}
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Review Frequency</label>
        <select value={reviewFrequency} onChange={(e) => setReviewFrequency(e.target.value)} style={fieldStyle}>
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Last Reviewed</label>
          <input
            type="date"
            value={lastReviewedAt}
            onChange={(e) => setLastReviewedAt(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Next Review</label>
          <input
            type="date"
            value={nextReviewAt}
            onChange={(e) => setNextReviewAt(e.target.value)}
            style={fieldStyle}
          />
          <p className="text-xs mt-1" style={{ color: "#475569" }}>
            Leave blank to auto-calculate
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {isPending ? "Saving…" : "Save Changes"}
        </button>
        <Link
          href={`/policies/${policy.id}`}
          className="text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: "#64748b" }}
        >
          ← Back to policy
        </Link>
      </div>
    </form>
  );
}
