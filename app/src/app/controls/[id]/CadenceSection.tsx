"use client";

import { useState, useTransition } from "react";
import { updateControlCadence } from "./actions";
import type { Control } from "@/lib/api";

type Frequency = Control["testing_frequency"];

const FREQ_OPTIONS: Array<{ value: Frequency; label: string; description: string }> = [
  { value: "monthly",   label: "Monthly",   description: "Test every month" },
  { value: "quarterly", label: "Quarterly", description: "Test every 3 months" },
  { value: "biannual",  label: "Biannual",  description: "Test every 6 months" },
  { value: "annual",    label: "Annual",    description: "Test every year" },
  { value: "ad_hoc",   label: "Ad-hoc",    description: "No fixed schedule" },
];

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly", quarterly: "Quarterly", biannual: "Biannual",
  annual: "Annual", ad_hoc: "Ad-hoc",
};

function fmt(dateStr: string | null | undefined): string {
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

function FrequencyPill({ freq }: { freq: string }) {
  return (
    <span style={{
      display: "inline-block", background: "rgba(0,196,180,0.1)", color: "#00c4b4",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      {FREQ_LABELS[freq] ?? freq}
    </span>
  );
}

interface Props {
  control: Control;
}

export function CadenceSection({ control }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>(control.testing_frequency);
  const [nextTestDue, setNextTestDue] = useState(control.next_test_due ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const days = control.next_test_due ? daysUntil(control.next_test_due) : null;
  const dueSoon = days !== null && days > 0 && days <= 14;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateControlCadence(control.id, {
        testing_frequency: frequency,
        next_test_due: nextTestDue.trim() || null,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
      }
    });
  }

  function handleCancel() {
    setFrequency(control.testing_frequency);
    setNextTestDue(control.next_test_due ?? "");
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
          Testing Cadence
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
          {/* Frequency */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Frequency</span>
            {control.testing_frequency ? (
              <FrequencyPill freq={control.testing_frequency} />
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: "#00c4b4" }}
              >
                Set cadence →
              </button>
            )}
          </div>

          {/* Last Tested */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Last Tested</span>
            <span className="text-xs" style={{ color: control.last_tested_at ? "#cbd5e1" : "#334155" }}>
              {control.last_tested_at ? fmt(control.last_tested_at) : "Never tested"}
            </span>
          </div>

          {/* Next Due */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "#64748b" }}>Next Due</span>
            <div className="flex items-center gap-1.5">
              {control.is_overdue ? (
                <>
                  <span className="text-xs" style={{ color: "#fca5a5" }}>
                    {fmt(control.next_test_due)}
                  </span>
                  <OverdueBadge />
                </>
              ) : dueSoon ? (
                <>
                  <span className="text-xs" style={{ color: "#fcd34d" }}>
                    {fmt(control.next_test_due)}
                  </span>
                  <DueSoonBadge />
                </>
              ) : control.next_test_due ? (
                <span className="text-xs" style={{ color: "#cbd5e1" }}>
                  {fmt(control.next_test_due)}
                </span>
              ) : control.testing_frequency === "ad_hoc" ? (
                <span className="text-xs" style={{ color: "#334155" }}>As needed</span>
              ) : (
                <span className="text-xs" style={{ color: "#334155" }}>—</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          {/* Frequency selector */}
          <div className="space-y-2 mb-4">
            {FREQ_OPTIONS.map((opt) => {
              const active = frequency === opt.value;
              return (
                <button
                  key={opt.value ?? "clear"}
                  type="button"
                  onClick={() => setFrequency(opt.value)}
                  className="w-full text-left transition-colors"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: active ? "1px solid #00c4b4" : "1px solid #1e293b",
                    background: active ? "rgba(0,196,180,0.05)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: active ? "#00c4b4" : "#f1f5f9" }}>
                    {opt.label}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: "#64748b" }}>
                    {opt.description}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setFrequency(null)}
              className="w-full text-left transition-colors"
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: frequency === null ? "1px solid #00c4b4" : "1px solid #1e293b",
                background: frequency === null ? "rgba(0,196,180,0.05)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span className="text-sm font-medium" style={{ color: frequency === null ? "#00c4b4" : "#94a3b8" }}>
                Clear
              </span>
              <span className="block text-xs mt-0.5" style={{ color: "#64748b" }}>
                Remove cadence setting
              </span>
            </button>
          </div>

          {/* Optional date override */}
          {frequency !== null && frequency !== "ad_hoc" && (
            <div className="mb-4">
              <label className="block text-xs mb-1.5" style={{ color: "#64748b" }}>
                Next test due (optional override)
              </label>
              <input
                type="date"
                value={nextTestDue}
                onChange={(e) => setNextTestDue(e.target.value)}
                className="w-full text-xs rounded px-2 py-1.5"
                style={{ background: "#0a0f1a", border: "1px solid #1e293b", color: "#f1f5f9" }}
              />
              <p className="text-xs mt-1" style={{ color: "#334155" }}>
                Leave blank to auto-calculate when an assessment is marked passed.
              </p>
            </div>
          )}

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
