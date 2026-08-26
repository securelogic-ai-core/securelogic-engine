"use client";

/**
 * UseDecisionForm — record a formal AI use decision (T2-D2).
 *
 * The form mirrors the engine's consistency rules CLIENT-SIDE so the common
 * mistakes never need a round-trip, but the engine remains the authority
 * (aiUseApprovals.ts re-validates everything):
 *   - rationale is required on EVERY decision — a decision with no grounds is
 *     unauditable in every direction;
 *   - conditions are shown, and required, ONLY for approved_with_conditions;
 *   - an expiry date is offered ONLY for the two approving decisions — a
 *     rejection or suspension stands until superseded.
 *
 * The record is append-only: submitting supersedes the current decision, it
 * never edits it. The copy says so, because a reviewer needs to know their
 * correction becomes a new history row, not a silent amendment.
 */

import { useState, useTransition } from "react";
import { recordUseDecision } from "./governanceActions";

export const USE_DECISION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "approved", label: "Approved" },
  { value: "approved_with_conditions", label: "Approved with conditions" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
];

const APPROVING_DECISIONS = new Set(["approved", "approved_with_conditions"]);

const INPUT_STYLE: React.CSSProperties = {
  background: "#0b1220",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
  width: "100%",
};

export function UseDecisionForm({ aiSystemId }: { aiSystemId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const needsConditions = decision === "approved_with_conditions";
  const canExpire = APPROVING_DECISIONS.has(decision);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-medium"
        style={{ color: "#00c4b4", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        + Record decision
      </button>
    );
  }

  function submit() {
    if (pending) return;
    if (!decision) {
      setError("Pick a decision.");
      return;
    }
    if (!rationale.trim()) {
      setError("Every use decision must state its grounds.");
      return;
    }
    if (needsConditions && !conditions.trim()) {
      setError("A conditional approval must state its conditions.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("decision", decision);
    formData.set("rationale", rationale.trim());
    // Only send what this decision may carry — the engine 400s conditions on a
    // non-conditional decision and expiry on a non-approving one.
    if (needsConditions) formData.set("conditions", conditions.trim());
    if (canExpire && expiresAt) formData.set("expires_at", expiresAt);
    startTransition(async () => {
      const result = await recordUseDecision(aiSystemId, formData);
      if ("error" in result) setError(result.error);
      else {
        setOpen(false);
        setDecision("");
        setRationale("");
        setConditions("");
        setExpiresAt("");
      }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs" style={{ color: "#64748b" }}>
        Recording a decision supersedes the current one — the history keeps both.
      </p>
      <select
        value={decision}
        onChange={(e) => {
          setDecision(e.target.value);
          setError(null);
        }}
        style={INPUT_STYLE}
        aria-label="Decision"
      >
        <option value="" disabled>
          Decision…
        </option>
        {USE_DECISION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={2}
        style={INPUT_STYLE}
        aria-label="Rationale"
        placeholder="Rationale (required) — the grounds for this decision"
      />
      {needsConditions && (
        <textarea
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          rows={2}
          style={INPUT_STYLE}
          aria-label="Conditions"
          placeholder="Conditions (required) — what the approval depends on"
        />
      )}
      {canExpire && (
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: "#94a3b8" }} htmlFor="use-decision-expiry">
            Expires
          </label>
          <input
            id="use-decision-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={{ ...INPUT_STYLE, width: "auto" }}
            aria-label="Expiry date"
          />
          <span className="text-xs" style={{ color: "#475569" }}>
            optional — only an approval expires
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="text-xs font-medium px-3 py-1.5 rounded-md"
          style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "none", cursor: "pointer" }}
        >
          {pending ? "Recording…" : "Record decision"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-xs"
          style={{ color: "#64748b", background: "transparent", border: "none", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "#fca5a5" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
