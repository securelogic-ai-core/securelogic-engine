"use client";

import { useState, useTransition } from "react";
import type { RiskScaleLevel } from "@/lib/api";
import { createRiskAction } from "./actions";

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

// Severity values stored canonically TitleCase. The spec confirmed earlier
// the storage scale is canonical regardless of the org's display preset;
// the dropdown shows the org's labels but submits the canonical value.
const SEVERITY_VALUES: ReadonlyArray<string> = ["Critical", "High", "Moderate", "Low"];

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

export function CreateRiskClient({ scaleLevels }: { scaleLevels: RiskScaleLevel[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<string>("");
  const [likelihood, setLikelihood] = useState<string>("");
  const [impact, setImpact] = useState<string>("");
  const [riskRating, setRiskRating] = useState<string>("");
  const [treatment, setTreatment] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError("Title is required."); return; }
    if (title.length > 255) { setError("Title must be 255 characters or fewer."); return; }
    if (description.length > 2000) { setError("Description must be 2000 characters or fewer."); return; }
    if (!domain) { setError("Domain is required."); return; }
    if (!likelihood) { setError("Likelihood is required."); return; }
    if (!impact) { setError("Impact is required."); return; }
    if (!riskRating) { setError("Risk rating is required."); return; }
    if (treatment.length > 2000) { setError("Treatment must be 2000 characters or fewer."); return; }
    if (owner.length > 100) { setError("Owner must be 100 characters or fewer."); return; }

    const input = {
      title: title.trim(),
      description: description.trim() || null,
      domain,
      likelihood,
      impact,
      risk_rating: riskRating,
      treatment: treatment.trim() || null,
      owner: owner.trim() || null,
      due_date: dueDate || null,
    };

    startTransition(async () => {
      const result = await createRiskAction(input);
      // Success path redirects from the server action — won't return here.
      // Only error paths return.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="domain" style={labelStyle}>Domain *</label>
          <select
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">Select…</option>
            {DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="likelihood" style={labelStyle}>Likelihood *</label>
          <select
            id="likelihood"
            value={likelihood}
            onChange={(e) => setLikelihood(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">Select…</option>
            {LIKELIHOODS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="impact" style={labelStyle}>Impact *</label>
          <select
            id="impact"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">Select…</option>
            {SEVERITY_VALUES.map((v) => (
              <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="risk_rating" style={labelStyle}>Risk Rating *</label>
          <select
            id="risk_rating"
            value={riskRating}
            onChange={(e) => setRiskRating(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">Select…</option>
            {SEVERITY_VALUES.map((v) => (
              <option key={v} value={v}>{severityLabel(v, scaleLevels)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="treatment" style={labelStyle}>Treatment Approach</label>
        <textarea
          id="treatment"
          value={treatment}
          onChange={(e) => setTreatment(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Free-form notes on how this risk will be addressed."
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
            placeholder="e.g. Security Team"
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

      {error && (
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <a
          href="/risks"
          className="px-4 py-2 rounded-lg text-sm"
          style={{
            border: "1px solid #1e293b",
            color: "#94a3b8",
            textDecoration: "none",
          }}
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
          {isPending ? "Creating…" : "Create Risk"}
        </button>
      </div>
    </form>
  );
}
