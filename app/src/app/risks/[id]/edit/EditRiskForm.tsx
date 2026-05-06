"use client";

import { useState, useTransition } from "react";
import type { Risk, RiskScaleLevel } from "@/lib/api";
import { editRiskAction, type EditRiskInput } from "./actions";

const DOMAINS: ReadonlyArray<string> = [
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General",
];

const LIKELIHOODS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "very_likely", label: "Very Likely" },
  { value: "likely",      label: "Likely" },
  { value: "possible",    label: "Possible" },
  { value: "unlikely",    label: "Unlikely" },
  { value: "rare",        label: "Rare" },
];

const SEVERITY_VALUES: ReadonlyArray<string> = ["Critical", "High", "Moderate", "Low"];

const STATUSES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open",        label: "Open" },
  { value: "accepted",    label: "Accepted" },
  { value: "mitigated",   label: "Mitigated" },
  { value: "closed",      label: "Closed" },
  { value: "transferred", label: "Transferred" },
];

function severityLabel(value: string, scaleLevels: RiskScaleLevel[]): string {
  const v = value.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  return level?.label ?? value;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(15,23,34,0.6)",
  border: "1px solid #1e293b",
  borderRadius: 6,
  color: "#e5e7eb",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

/**
 * EditRiskForm — pre-fills from the loaded risk and submits ONLY the
 * fields that changed. The server validator rejects empty bodies with
 * `no_fields_to_update`, so this short-circuits a no-op submit too.
 *
 * Status field is editable. The risk-level PATCH allows any status
 * transition (no graph at this level — distinct from risk_treatments).
 * Direct open → closed is supported. The audit log records which
 * fields changed.
 */
export function EditRiskForm({
  risk,
  scaleLevels,
}: {
  risk: Risk;
  scaleLevels: RiskScaleLevel[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(risk.title);
  const [description, setDescription] = useState(risk.description ?? "");
  const [domain, setDomain] = useState<string>(risk.domain ?? "");
  // Six rating inputs split into Inherent / Residual sections per
  // Decision §6 of package risk-register-inherent-residual-rating.
  // The legacy likelihood/impact/risk_rating fields are no longer on
  // the form — Phase 2's PATCH handler mirrors residual into legacy
  // automatically when the user PATCHes residual_* without supplying
  // legacy. This preserves webhook contract without UI complexity.
  // Backfilled rows have NULL inherent_*; pre-populating with empty
  // string forces the user to make an explicit reassessment choice
  // (rather than defaulting inherent = residual silently).
  const [inherentLikelihood, setInherentLikelihood] = useState<string>(risk.inherent_likelihood ?? "");
  const [inherentImpact,     setInherentImpact]     = useState<string>(risk.inherent_impact     ?? "");
  const [inherentRating,     setInherentRating]     = useState<string>(risk.inherent_rating     ?? "");
  const [residualLikelihood, setResidualLikelihood] = useState<string>(risk.residual_likelihood ?? "");
  const [residualImpact,     setResidualImpact]     = useState<string>(risk.residual_impact     ?? "");
  const [residualRating,     setResidualRating]     = useState<string>(risk.residual_rating     ?? "");
  const [status, setStatus] = useState<string>(risk.status);
  const [treatment, setTreatment] = useState(risk.treatment ?? "");
  const [owner, setOwner] = useState(risk.owner ?? "");
  const [dueDate, setDueDate] = useState(risk.due_date ?? "");
  const [sourceType, setSourceType] = useState(risk.source_type ?? "");
  const [sourceId, setSourceId] = useState(risk.source_id ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Per-field length / required validation. The server enforces the
    // same caps; this surfaces errors before the round-trip.
    const t = title.trim();
    if (!t) { setError("Title is required."); return; }
    if (t.length > 255) { setError("Title must be 255 characters or fewer."); return; }
    if (description.length > 2000) { setError("Description must be 2000 characters or fewer."); return; }
    if (treatment.length > 2000) { setError("Treatment must be 2000 characters or fewer."); return; }
    if (owner.length > 100) { setError("Owner must be 100 characters or fewer."); return; }

    // Build a diff: only fields whose current value differs from the
    // loaded risk are sent. Empty strings become null where the type
    // allows (description, treatment, owner, due_date, source_type,
    // source_id) — matches the API's nullable semantics.
    const diff: EditRiskInput = {};

    if (t !== risk.title) diff.title = t;
    {
      const next = description.trim() || null;
      if (next !== (risk.description ?? null)) diff.description = next;
    }
    if (domain && domain !== (risk.domain ?? "")) diff.domain = domain;

    // Rating dimension diffs — six fields, two trios. Empty string =
    // unset; we don't send empty strings (the validator would reject
    // them). The PATCH endpoint allows partial updates of any subset.
    if (inherentLikelihood && inherentLikelihood !== (risk.inherent_likelihood ?? "")) {
      diff.inherent_likelihood = inherentLikelihood;
    }
    if (inherentImpact && inherentImpact !== (risk.inherent_impact ?? "")) {
      diff.inherent_impact = inherentImpact;
    }
    if (inherentRating && inherentRating !== (risk.inherent_rating ?? "")) {
      diff.inherent_rating = inherentRating;
    }
    if (residualLikelihood && residualLikelihood !== (risk.residual_likelihood ?? "")) {
      diff.residual_likelihood = residualLikelihood;
    }
    if (residualImpact && residualImpact !== (risk.residual_impact ?? "")) {
      diff.residual_impact = residualImpact;
    }
    if (residualRating && residualRating !== (risk.residual_rating ?? "")) {
      diff.residual_rating = residualRating;
    }

    if (status !== risk.status) diff.status = status;
    {
      const next = treatment.trim() || null;
      if (next !== (risk.treatment ?? null)) diff.treatment = next;
    }
    {
      const next = owner.trim() || null;
      if (next !== (risk.owner ?? null)) diff.owner = next;
    }
    {
      const next = dueDate || null;
      if (next !== (risk.due_date ?? null)) diff.due_date = next;
    }
    {
      const next = sourceType.trim() || null;
      if (next !== (risk.source_type ?? null)) diff.source_type = next;
    }
    {
      const next = sourceId.trim() || null;
      if (next !== (risk.source_id ?? null)) diff.source_id = next;
    }

    startTransition(async () => {
      const result = await editRiskAction(risk.id, diff);
      // Success path redirects from the server action; only error returns.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border p-6 space-y-5"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div>
        <label htmlFor="title" style={labelStyle}>Title *</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          required
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="description" style={labelStyle}>Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      <div>
        <label htmlFor="domain" style={labelStyle}>Domain</label>
        <select id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} style={inputStyle}>
          <option value="">Select…</option>
          {DOMAINS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/*
        Inherent / Residual rating sections — Decision §6 of package
        risk-register-inherent-residual-rating. Two side-by-side
        cards on desktop, stacked on mobile. Inherent = pre-controls
        (worst case); Residual = post-controls (current state).
        Pre-populated from the loaded risk; backfilled rows have
        NULL inherent and so the inherent inputs start empty until
        the user reassesses.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <fieldset
          className="rounded-lg p-4 space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <legend className="text-xs font-semibold" style={{ color: "#94a3b8", padding: "0 6px" }}>
            Inherent (pre-controls)
          </legend>
          <div>
            <label htmlFor="inherent_likelihood" style={labelStyle}>Likelihood</label>
            <select
              id="inherent_likelihood"
              value={inherentLikelihood}
              onChange={(e) => setInherentLikelihood(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {LIKELIHOODS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inherent_impact" style={labelStyle}>Impact</label>
            <select
              id="inherent_impact"
              value={inherentImpact}
              onChange={(e) => setInherentImpact(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {SEVERITY_VALUES.map((v) => (
                <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inherent_rating" style={labelStyle}>Rating</label>
            <select
              id="inherent_rating"
              value={inherentRating}
              onChange={(e) => setInherentRating(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {SEVERITY_VALUES.map((v) => (
                <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset
          className="rounded-lg p-4 space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <legend className="text-xs font-semibold" style={{ color: "#94a3b8", padding: "0 6px" }}>
            Residual (post-controls)
          </legend>
          <div>
            <label htmlFor="residual_likelihood" style={labelStyle}>Likelihood</label>
            <select
              id="residual_likelihood"
              value={residualLikelihood}
              onChange={(e) => setResidualLikelihood(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {LIKELIHOODS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="residual_impact" style={labelStyle}>Impact</label>
            <select
              id="residual_impact"
              value={residualImpact}
              onChange={(e) => setResidualImpact(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {SEVERITY_VALUES.map((v) => (
                <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="residual_rating" style={labelStyle}>Rating</label>
            <select
              id="residual_rating"
              value={residualRating}
              onChange={(e) => setResidualRating(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select…</option>
              {SEVERITY_VALUES.map((v) => (
                <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
              ))}
            </select>
          </div>
        </fieldset>
      </div>

      <div>
        <label htmlFor="status" style={labelStyle}>Status</label>
        <select id="status" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
          {STATUSES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="treatment" style={labelStyle}>Treatment Approach</label>
        <textarea
          id="treatment"
          value={treatment}
          onChange={(e) => setTreatment(e.target.value)}
          maxLength={2000}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="owner" style={labelStyle}>Owner</label>
          <input
            id="owner"
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            maxLength={100}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="due_date" style={labelStyle}>Due Date</label>
          <input
            id="due_date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      <details>
        <summary
          className="text-xs cursor-pointer"
          style={{ color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}
        >
          Source linkage (advanced)
        </summary>
        <p className="text-xs mt-2 mb-3" style={{ color: "#475569" }}>
          Internal provenance metadata. Records where the risk was identified
          from. Both fields must be present together or absent together.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="source_type" style={labelStyle}>Source Type</label>
            <input
              id="source_type"
              type="text"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              placeholder="e.g. assessment"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="source_id" style={labelStyle}>Source ID</label>
            <input
              id="source_id"
              type="text"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="UUID"
              style={inputStyle}
            />
          </div>
        </div>
      </details>

      {error && (
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <a
          href={`/risks/${risk.id}`}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ border: "1px solid #1e293b", color: "#94a3b8", textDecoration: "none" }}
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{
            background: isPending ? "#1e293b" : "#00c4b4",
            color: isPending ? "#94a3b8" : "#0a0f1a",
            border: "none",
            cursor: isPending ? "wait" : "pointer",
          }}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
