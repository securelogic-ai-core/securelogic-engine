"use client";

import { useState } from "react";
import Link from "next/link";
import type { Control, ControlAssessment } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Badge helpers
// ─────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  passed:               { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  failed:               { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  remediation_required: { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  in_progress:          { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
};

const SEVERITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly", quarterly: "Quarterly", biannual: "Biannual",
  annual: "Annual", ad_hoc: "Ad-hoc",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const label = status.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const style = SEVERITY_BADGE_STYLES[severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {severity}
    </span>
  );
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

// ─────────────────────────────────────────────────────────────
// Filter logic
// ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "overdue" | "due_this_month" | "no_cadence";

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string }> = [
  { key: "all",            label: "All" },
  { key: "overdue",        label: "Overdue" },
  { key: "due_this_month", label: "Due This Month" },
  { key: "no_cadence",     label: "No Cadence Set" },
];

function applyFilter(controls: Control[], filter: FilterKey): Control[] {
  switch (filter) {
    case "overdue":
      return controls.filter((c) => c.is_overdue);
    case "due_this_month":
      return controls.filter((c) => {
        if (!c.next_test_due || c.is_overdue) return false;
        const d = daysUntil(c.next_test_due);
        return d >= 0 && d <= 30;
      });
    case "no_cadence":
      return controls.filter((c) => c.testing_frequency === null);
    default:
      return controls;
  }
}

// ─────────────────────────────────────────────────────────────
// ControlRow
// ─────────────────────────────────────────────────────────────

function ControlRow({
  control,
  assessmentCount,
  latestAssessment,
}: {
  control: Control;
  assessmentCount: number;
  latestAssessment: ControlAssessment | null;
}) {
  const performedAt = latestAssessment?.performed_at
    ? new Date(latestAssessment.performed_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const days = control.next_test_due ? daysUntil(control.next_test_due) : null;
  const dueSoon = !control.is_overdue && days !== null && days >= 0 && days <= 14;

  return (
    <div className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 cursor-pointer transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + badges + description */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {control.name}
            </span>
            {control.is_overdue && <OverdueBadge />}
            {!control.is_overdue && dueSoon && <DueSoonBadge />}
            {!control.is_overdue && !dueSoon && control.testing_frequency && (
              <FrequencyPill freq={control.testing_frequency} />
            )}
            {latestAssessment && (
              <>
                <StatusBadge status={latestAssessment.status} />
                <SeverityBadge severity={latestAssessment.overall_severity} />
              </>
            )}
          </div>
          {control.description && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: "#94a3b8" }}>
              {control.description}
            </p>
          )}
          {latestAssessment?.summary && (
            <p className="mt-1 text-xs line-clamp-1" style={{ color: "#475569" }}>
              {latestAssessment.summary}
            </p>
          )}
          {/* Cadence sub-line */}
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            {control.testing_frequency && (
              <span className="text-xs" style={{ color: "#475569" }}>
                Tested {FREQ_LABELS[control.testing_frequency] ?? control.testing_frequency}
              </span>
            )}
            {control.next_test_due && !control.is_overdue && (
              <span className="text-xs" style={{ color: "#334155" }}>
                Next: {fmt(control.next_test_due)}
              </span>
            )}
            {control.is_overdue && control.next_test_due && (
              <span className="text-xs" style={{ color: "#fca5a5" }}>
                Was due {fmt(control.next_test_due)}
              </span>
            )}
          </div>
        </div>

        {/* Right: assessment count + last tested */}
        <div className="flex-shrink-0 text-right space-y-1">
          <div>
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              {assessmentCount > 0
                ? `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
                : "Not assessed"}
            </span>
          </div>
          {performedAt && (
            <div>
              <span className="text-xs" style={{ color: "#475569" }}>
                Tested {performedAt}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ControlsList (exported)
// ─────────────────────────────────────────────────────────────

interface Props {
  controls: Control[];
  latestAssessmentByControl: Record<string, ControlAssessment>;
  assessmentCountByControl: Record<string, number>;
}

export function ControlsList({
  controls,
  latestAssessmentByControl,
  assessmentCountByControl,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const filtered = applyFilter(controls, activeFilter);

  const overdueCount = controls.filter((c) => c.is_overdue).length;
  const noCadenceCount = controls.filter((c) => c.testing_frequency === null).length;
  const dueThisMonthCount = controls.filter((c) => {
    if (!c.next_test_due || c.is_overdue) return false;
    const d = daysUntil(c.next_test_due);
    return d >= 0 && d <= 30;
  }).length;

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "overdue" ? overdueCount :
            opt.key === "due_this_month" ? dueThisMonthCount :
            opt.key === "no_cadence" ? noCadenceCount :
            null;
          const active = activeFilter === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setActiveFilter(opt.key)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={
                active
                  ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
                  : { background: "transparent", color: "#64748b", border: "1px solid #1e293b" }
              }
            >
              {opt.label}
              {count !== null && count > 0 && (
                <span
                  className="ml-0.5 font-bold"
                  style={{ color: opt.key === "overdue" ? "#fca5a5" : undefined }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No controls match this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((control) => (
            <Link key={control.id} href={`/controls/${control.id}`} className="block">
              <ControlRow
                control={control}
                assessmentCount={assessmentCountByControl[control.id] ?? 0}
                latestAssessment={latestAssessmentByControl[control.id] ?? null}
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
