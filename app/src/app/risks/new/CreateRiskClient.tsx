"use client";

import { useState, useTransition } from "react";
import type { RiskScaleLevel } from "@/lib/api";
import { UserPicker } from "@/components/users/UserPicker";
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

export function CreateRiskClient({
  scaleLevels,
  organizationId,
}: {
  scaleLevels: RiskScaleLevel[];
  organizationId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<string>("");
  // 6 rating inputs per Decision §6 of package
  // risk-register-inherent-residual-rating. The legacy
  // likelihood/impact/risk_rating fields are not on the form;
  // actions.ts mirrors residual into legacy on the wire so the
  // backend's POST validator (which still requires all 9 fields)
  // accepts the body.
  const [inherentLikelihood, setInherentLikelihood] = useState<string>("");
  const [inherentImpact,     setInherentImpact]     = useState<string>("");
  const [inherentRating,     setInherentRating]     = useState<string>("");
  const [residualLikelihood, setResidualLikelihood] = useState<string>("");
  const [residualImpact,     setResidualImpact]     = useState<string>("");
  const [residualRating,     setResidualRating]     = useState<string>("");
  const [treatment, setTreatment] = useState("");
  // Owner is selected via UserPicker. We track both the FK and the
  // resolved user name so we can submit both columns: owner_user_id
  // (canonical FK) and owner (denormalized text for display
  // fallback). When the picker degrades to free-text fallback,
  // ownerUserId stays null and ownerName becomes whatever the user
  // typed; we send only the text column in that case.
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError("Title is required."); return; }
    if (title.length > 255) { setError("Title must be 255 characters or fewer."); return; }
    if (description.length > 2000) { setError("Description must be 2000 characters or fewer."); return; }
    if (!domain) { setError("Domain is required."); return; }
    if (!inherentLikelihood) { setError("Inherent likelihood is required."); return; }
    if (!inherentImpact)     { setError("Inherent impact is required."); return; }
    if (!inherentRating)     { setError("Inherent rating is required."); return; }
    if (!residualLikelihood) { setError("Residual likelihood is required."); return; }
    if (!residualImpact)     { setError("Residual impact is required."); return; }
    if (!residualRating)     { setError("Residual rating is required."); return; }
    if (treatment.length > 2000) { setError("Treatment must be 2000 characters or fewer."); return; }
    if (ownerName !== null && ownerName.length > 100) {
      setError("Owner must be 100 characters or fewer.");
      return;
    }

    const input = {
      title: title.trim(),
      description: description.trim() || null,
      domain,
      inherent_likelihood: inherentLikelihood,
      inherent_impact:     inherentImpact,
      inherent_rating:     inherentRating,
      residual_likelihood: residualLikelihood,
      residual_impact:     residualImpact,
      residual_rating:     residualRating,
      treatment: treatment.trim() || null,
      owner: ownerName,
      owner_user_id: ownerUserId,
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

      {/*
        Inherent / Residual rating sections — Decision §6 of package
        risk-register-inherent-residual-rating. Six required inputs;
        the legacy 3 are mirrored into the wire body by actions.ts
        (residual → legacy) so the backend POST validator accepts.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <fieldset
          className="rounded-lg p-4 space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <legend className="text-xs font-semibold" style={{ color: "#94a3b8", padding: "0 6px" }}>
            Inherent (pre-controls) *
          </legend>
          <div>
            <label htmlFor="inherent_likelihood" style={labelStyle}>Likelihood</label>
            <select
              id="inherent_likelihood"
              value={inherentLikelihood}
              onChange={(e) => setInherentLikelihood(e.target.value)}
              required
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
            <label htmlFor="inherent_rating" style={labelStyle}>Rating</label>
            <select
              id="inherent_rating"
              value={inherentRating}
              onChange={(e) => setInherentRating(e.target.value)}
              required
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
            Residual (post-controls) *
          </legend>
          <div>
            <label htmlFor="residual_likelihood" style={labelStyle}>Likelihood</label>
            <select
              id="residual_likelihood"
              value={residualLikelihood}
              onChange={(e) => setResidualLikelihood(e.target.value)}
              required
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
            <label htmlFor="residual_rating" style={labelStyle}>Rating</label>
            <select
              id="residual_rating"
              value={residualRating}
              onChange={(e) => setResidualRating(e.target.value)}
              required
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
          <label style={labelStyle}>Owner</label>
          <UserPicker
            organizationId={organizationId}
            value={ownerUserId}
            onChange={(userId, userName) => {
              setOwnerUserId(userId);
              setOwnerName(userName);
            }}
            ariaLabel="Risk owner"
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
