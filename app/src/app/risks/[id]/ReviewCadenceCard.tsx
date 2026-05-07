"use client";

/**
 * ReviewCadenceCard (RR-5) — per-risk review cadence panel.
 *
 * Mirrors the controls' CadenceSection.tsx visual structure: muted
 * card, view-mode rows with inline overdue/due-soon badges, edit-mode
 * with preset buttons and a custom-days input.
 *
 * Edit form is CADENCE-ONLY by design — it sets review_cadence_days
 * (per-risk override) or clears it (fallback to org policy). It does
 * NOT let the user manually overwrite next_review_due. The next-due
 * date is recomputed only when "Mark Reviewed" is clicked, via the
 * dedicated POST /api/risks/:id/review path that emits a `risk.reviewed`
 * audit event. Splitting the two surfaces keeps the audit trail clean
 * (one event per real review event, not silent date edits).
 *
 * The "(org default)" subtitle reads from the effective cadence map
 * passed in from the server page. When review_cadence_days is null,
 * the resolved cadence is policy[residual_rating] || DEFAULT[rating].
 */

import { useMemo, useState, useTransition } from "react";
import type { Risk } from "@/lib/api";
import { updateRiskCadenceAction } from "./actions";

const DUE_SOON_DAYS = 14;

const PRESET_DAYS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 30,  label: "30 days" },
  { value: 60,  label: "60 days" },
  { value: 90,  label: "90 days" },
  { value: 180, label: "180 days" },
];

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  return Math.ceil((due.getTime() - now.getTime()) / 86400000);
}

function OverdueBadge() {
  return (
    <span style={{
      display: "inline-block", background: "rgba(239,68,68,0.15)", color: "#fca5a5",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      Overdue
    </span>
  );
}

function DueSoonBadge() {
  return (
    <span style={{
      display: "inline-block", background: "rgba(245,158,11,0.15)", color: "#fcd34d",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      Due soon
    </span>
  );
}

function CadencePill({ days, isDefault }: { days: number; isDefault: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      background: isDefault ? "rgba(148,163,184,0.12)" : "rgba(0,196,180,0.1)",
      color: isDefault ? "#94a3b8" : "#00c4b4",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      {days} days{isDefault ? " (org default)" : ""}
    </span>
  );
}

interface Props {
  risk: Risk;
  /**
   * Effective cadence-by-rating from /api/orgs/me/risk-settings (merged
   * over documented defaults). Used to render the "(org default)"
   * subtitle when the risk's review_cadence_days override is null.
   */
  effectiveCadenceByRating: Record<string, number>;
}

export function ReviewCadenceCard({ risk, effectiveCadenceByRating }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [mode, setMode] = useState<"org_default" | "preset" | "custom">(
    risk.review_cadence_days === null ? "org_default" : "preset"
  );
  const [customDays, setCustomDays] = useState<string>(
    risk.review_cadence_days !== null ? String(risk.review_cadence_days) : ""
  );
  const [presetValue, setPresetValue] = useState<number>(
    risk.review_cadence_days ?? 90
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Resolve the effective cadence days for display. When the per-risk
  // override is set, that's the value. Otherwise the org policy keyed
  // by residual_rating; otherwise documented defaults; otherwise the
  // FALLBACK_DAYS constant (90) — but we don't need to import it here
  // because effectiveCadenceByRating already captures the policy +
  // defaults merged map.
  const orgDefaultDays = useMemo(() => {
    if (risk.residual_rating && risk.residual_rating in effectiveCadenceByRating) {
      return effectiveCadenceByRating[risk.residual_rating]!;
    }
    return null;
  }, [risk.residual_rating, effectiveCadenceByRating]);

  const usingDefault = risk.review_cadence_days === null;
  const effectiveDays = risk.review_cadence_days ?? orgDefaultDays;

  const days = risk.next_review_due ? daysUntil(risk.next_review_due) : null;
  const dueSoon = days !== null && days >= 0 && days <= DUE_SOON_DAYS;
  const overdue = !!risk.is_overdue;

  function handleSave() {
    setError(null);
    let payload: number | null = null;
    if (mode === "org_default") {
      payload = null;
    } else if (mode === "preset") {
      payload = presetValue;
    } else {
      const parsed = Number(customDays.trim());
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        setError("Custom days must be a positive integer.");
        return;
      }
      if (parsed > 3650) {
        setError("Custom days must be 3650 or fewer.");
        return;
      }
      payload = parsed;
    }

    startTransition(async () => {
      const result = await updateRiskCadenceAction(risk.id, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsEditing(false);
    });
  }

  function handleCancel() {
    setMode(risk.review_cadence_days === null ? "org_default" : "preset");
    setCustomDays(risk.review_cadence_days !== null ? String(risk.review_cadence_days) : "");
    setPresetValue(risk.review_cadence_days ?? 90);
    setError(null);
    setIsEditing(false);
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Review Cadence
        </p>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: "#475569" }}
          >
            Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        <div className="space-y-2.5">
          {/* Cadence */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Cadence</span>
            {effectiveDays !== null ? (
              <CadencePill days={effectiveDays} isDefault={usingDefault} />
            ) : (
              <span className="text-xs" style={{ color: "#334155" }}>—</span>
            )}
          </div>

          {/* Last Reviewed */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Last Reviewed</span>
            <span className="text-xs" style={{ color: risk.last_reviewed_at ? "#cbd5e1" : "#334155" }}>
              {risk.last_reviewed_at ? fmtDate(risk.last_reviewed_at) : "Never reviewed"}
            </span>
          </div>

          {/* Next Review */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Next Review</span>
            <div className="flex items-center gap-1.5">
              {risk.next_review_due ? (
                overdue ? (
                  <>
                    <span className="text-xs" style={{ color: "#fca5a5" }}>
                      {fmtDate(risk.next_review_due)}
                    </span>
                    <OverdueBadge />
                  </>
                ) : dueSoon ? (
                  <>
                    <span className="text-xs" style={{ color: "#fcd34d" }}>
                      {fmtDate(risk.next_review_due)}
                    </span>
                    <DueSoonBadge />
                  </>
                ) : (
                  <span className="text-xs" style={{ color: "#cbd5e1" }}>
                    {fmtDate(risk.next_review_due)}
                  </span>
                )
              ) : (
                <span className="text-xs" style={{ color: "#334155" }}>—</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          {/* "Use org policy" button */}
          <div className="space-y-2 mb-3">
            <button
              type="button"
              onClick={() => setMode("org_default")}
              className="w-full text-left transition-colors"
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: mode === "org_default" ? "1px solid #00c4b4" : "1px solid #1e293b",
                background: mode === "org_default" ? "rgba(0,196,180,0.05)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span className="text-sm font-medium" style={{ color: mode === "org_default" ? "#00c4b4" : "#f1f5f9" }}>
                Use org policy
              </span>
              <span className="block text-xs mt-0.5" style={{ color: "#64748b" }}>
                {orgDefaultDays !== null
                  ? `Inherit ${orgDefaultDays} days from /settings/risk-policy`
                  : "Inherit from the org's review-cadence policy"}
              </span>
            </button>
          </div>

          {/* Preset day buttons */}
          <p className="text-xs mb-2" style={{ color: "#64748b" }}>Or set a per-risk override:</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {PRESET_DAYS.map((p) => {
              const active = mode === "preset" && presetValue === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => { setMode("preset"); setPresetValue(p.value); }}
                  className="text-center transition-colors"
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: active ? "1px solid #00c4b4" : "1px solid #1e293b",
                    background: active ? "rgba(0,196,180,0.05)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: active ? "#00c4b4" : "#f1f5f9" }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom days input */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setMode("custom")}
              className="w-full text-left transition-colors"
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: mode === "custom" ? "1px solid #00c4b4" : "1px solid #1e293b",
                background: mode === "custom" ? "rgba(0,196,180,0.05)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span className="text-sm font-medium" style={{ color: mode === "custom" ? "#00c4b4" : "#f1f5f9" }}>
                Custom
              </span>
              <span className="block text-xs mt-0.5" style={{ color: "#64748b" }}>
                Enter a positive integer (days).
              </span>
            </button>
            {mode === "custom" && (
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="e.g. 45"
                className="w-full mt-2 text-xs rounded px-2 py-1.5"
                style={{ background: "#0a0f1a", border: "1px solid #1e293b", color: "#f1f5f9" }}
              />
            )}
          </div>

          {error && (
            <p className="text-xs mb-3" style={{ color: "#fca5a5" }}>{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: "#475569" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
