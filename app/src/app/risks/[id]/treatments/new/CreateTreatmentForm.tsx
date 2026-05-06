"use client";

import { useState, useTransition } from "react";
import { UserPicker } from "@/components/users/UserPicker";
import { createTreatmentAction } from "./actions";

const TREATMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "mitigate", label: "Mitigate" },
  { value: "accept",   label: "Accept" },
  { value: "transfer", label: "Transfer" },
  { value: "avoid",    label: "Avoid" },
];

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

export function CreateTreatmentForm({
  riskId,
  organizationId,
}: {
  riskId: string;
  organizationId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [treatmentType, setTreatmentType] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (ownerName !== null && ownerName.length > 100) {
      setError("Owner must be 100 characters or fewer.");
      return;
    }
    if (summary.length > 2000) { setError("Summary must be 2000 characters or fewer."); return; }
    if (notes.length > 2000) { setError("Notes must be 2000 characters or fewer."); return; }

    startTransition(async () => {
      const result = await createTreatmentAction(riskId, {
        treatment_type: treatmentType || null,
        owner: ownerName,
        owner_user_id: ownerUserId,
        due_date: dueDate || null,
        summary: summary.trim() || null,
        notes: notes.trim() || null,
      });
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
        <label htmlFor="treatment_type" style={labelStyle}>Treatment Type</label>
        <select
          id="treatment_type"
          value={treatmentType}
          onChange={(e) => setTreatmentType(e.target.value)}
          style={inputStyle}
        >
          <option value="">Not specified</option>
          {TREATMENT_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: "#64748b" }}>
          Optional. Can be set or changed when transitioning the treatment.
        </p>
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
            ariaLabel="Treatment owner"
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

      <div>
        <label htmlFor="summary" style={labelStyle}>Summary</label>
        <textarea
          id="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Short description of what this treatment will do."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      <div>
        <label htmlFor="notes" style={labelStyle}>Notes</label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Internal notes, dependencies, blockers."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      <p className="text-xs" style={{ color: "#475569" }}>
        Status will be set to <strong>Not Started</strong>. You can move it
        forward from the treatment detail page.
      </p>

      {error && (
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <a
          href={`/risks/${riskId}`}
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
          {isPending ? "Creating…" : "Create Treatment"}
        </button>
      </div>
    </form>
  );
}
