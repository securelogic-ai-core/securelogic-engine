"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PenTestEngagement } from "@/lib/api";
import {
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUS_STYLES,
  TEST_TYPE_LABELS,
} from "../lifecycle";
import { updatePenTestEngagement, type PenTestActionResult } from "./actions";

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className={labelClass} style={{ color: "#94a3b8" }}>
      {children}
    </label>
  );
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/**
 * EngagementLifecycleCard (T2-I) — where the engagement is, and the controls
 * to say so. Status is a STATEMENT, not a lock: the engine rules transitions
 * free (any status may follow any other — a re-opened remediation, a late
 * report addendum), stamps closed_at on entry to 'closed' and clears it on
 * leaving, and writes the from->to pair to the audit log. So the edit form is
 * a plain select over the five statuses, not a transition picker.
 *
 * Overdue renders the engine's computed `test_overdue` — never a client-side
 * date comparison, so this card can never disagree with the list.
 */
export function EngagementLifecycleCard({
  engagement,
}: {
  engagement: PenTestEngagement;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result: PenTestActionResult = await updatePenTestEngagement(
      engagement.id,
      formData
    );

    if (result.error) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(false);
    // The engine stamped closed_at / recomputed overdue; re-read, never guess.
    router.refresh();
  }

  const statusStyle = ENGAGEMENT_STATUS_STYLES[engagement.status] ?? {
    background: "rgba(148,163,184,0.15)",
    color: "#94a3b8",
  };

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Lifecycle &amp; Scope
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => { setEditing(true); setError(null); }}
            className="text-xs font-medium transition-colors"
            style={{
              border: "1px solid #1e2d45",
              color: "#94a3b8",
              padding: "4px 12px",
              borderRadius: "6px",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Edit
          </button>
        )}
      </div>

      {!editing && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
              style={statusStyle}
            >
              {ENGAGEMENT_STATUS_LABELS[engagement.status] ?? engagement.status}
            </span>
            {/* closed <=> closed_at is a DB CHECK — when closed, the stamp exists. */}
            {engagement.status === "closed" && engagement.closed_at && (
              <span className="text-xs" style={{ color: "#64748b" }}>
                Closed {fmtDate(engagement.closed_at)}
              </span>
            )}
            {engagement.test_overdue && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5" }}
              >
                Test overdue
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
                Test Type
              </p>
              <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
                {engagement.test_type
                  ? TEST_TYPE_LABELS[engagement.test_type] ?? engagement.test_type
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
                Methodology
              </p>
              <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
                {engagement.methodology ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
                Next Test Due
              </p>
              <p
                className="text-sm mt-1"
                style={{ color: engagement.test_overdue ? "#fca5a5" : "#cbd5e1" }}
              >
                {fmtDate(engagement.next_test_due)}
                {engagement.test_overdue && " — overdue"}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Scope
            </p>
            {engagement.scope_summary ? (
              <p
                className="text-sm mt-1 leading-relaxed"
                style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}
              >
                {engagement.scope_summary}
              </p>
            ) : (
              <p className="text-sm mt-1" style={{ color: "#64748b" }}>
                No scope recorded — the statement of work&rsquo;s in/out list belongs here.
              </p>
            )}
          </div>
        </>
      )}

      {editing && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel htmlFor="engagement-status">Status</FieldLabel>
              <select
                id="engagement-status"
                name="status"
                defaultValue={engagement.status}
                className={inputClass}
                style={inputStyle}
                disabled={saving}
              >
                {ENGAGEMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ENGAGEMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="engagement-test-type">Test Type</FieldLabel>
              <select
                id="engagement-test-type"
                name="test_type"
                defaultValue={engagement.test_type ?? ""}
                className={inputClass}
                style={inputStyle}
                disabled={saving}
              >
                <option value="">—</option>
                {(Object.keys(TEST_TYPE_LABELS) as Array<keyof typeof TEST_TYPE_LABELS>).map(
                  (t) => (
                    <option key={t} value={t}>
                      {TEST_TYPE_LABELS[t]}
                    </option>
                  )
                )}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="engagement-next-test-due">Next Test Due</FieldLabel>
              <input
                id="engagement-next-test-due"
                type="date"
                name="next_test_due"
                defaultValue={engagement.next_test_due ?? ""}
                className={inputClass}
                style={inputStyle}
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="engagement-methodology">Methodology</FieldLabel>
            <input
              id="engagement-methodology"
              type="text"
              name="methodology"
              defaultValue={engagement.methodology ?? ""}
              placeholder="The provider's own words — PTES, OWASP WSTG, bespoke…"
              className={inputClass}
              style={inputStyle}
              disabled={saving}
            />
          </div>

          <div>
            <FieldLabel htmlFor="engagement-scope">Scope</FieldLabel>
            <textarea
              id="engagement-scope"
              name="scope_summary"
              defaultValue={engagement.scope_summary ?? ""}
              rows={3}
              placeholder="What was in scope, and what was explicitly not"
              className={inputClass}
              style={inputStyle}
              disabled={saving}
            />
          </div>

          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { setEditing(false); setError(null); }}
              className="text-sm font-medium transition-opacity hover:opacity-80"
              style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
