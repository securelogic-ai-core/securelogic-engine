"use client";

import { useState } from "react";
import Link from "next/link";
import type { Control, ControlAssessment } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Classification label/color maps
// ─────────────────────────────────────────────────────────────

const CONTROL_TYPE_STYLES: Record<string, React.CSSProperties> = {
  preventive:   { background: "rgba(59,130,246,0.15)",  color: "#93c5fd",  border: "1px solid rgba(59,130,246,0.25)" },
  detective:    { background: "rgba(139,92,246,0.15)",  color: "#c4b5fd",  border: "1px solid rgba(139,92,246,0.25)" },
  corrective:   { background: "rgba(249,115,22,0.15)",  color: "#fdba74",  border: "1px solid rgba(249,115,22,0.25)" },
  deterrent:    { background: "rgba(245,158,11,0.15)",  color: "#fcd34d",  border: "1px solid rgba(245,158,11,0.25)" },
  compensating: { background: "rgba(0,196,180,0.12)",   color: "#5eead4",  border: "1px solid rgba(0,196,180,0.25)" },
  directive:    { background: "rgba(148,163,184,0.12)", color: "#94a3b8",  border: "1px solid rgba(148,163,184,0.2)" },
};

const CONTROL_TYPE_LABELS: Record<string, string> = {
  preventive: "Preventive", detective: "Detective", corrective: "Corrective",
  deterrent: "Deterrent", compensating: "Compensating", directive: "Directive",
};

const IMPL_STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started: { background: "rgba(148,163,184,0.12)", color: "#94a3b8",  border: "1px solid rgba(148,163,184,0.2)" },
  in_progress: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d",  border: "1px solid rgba(245,158,11,0.25)" },
  implemented: { background: "rgba(59,130,246,0.15)",  color: "#93c5fd",  border: "1px solid rgba(59,130,246,0.25)" },
  verified:    { background: "rgba(34,197,94,0.15)",   color: "#86efac",  border: "1px solid rgba(34,197,94,0.25)" },
};

const IMPL_STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started", in_progress: "In Progress",
  implemented: "Implemented", verified: "Verified",
};

const MATURITY_STYLES: React.CSSProperties = {
  background: "rgba(0,196,180,0.08)", color: "#5eead4", border: "1px solid rgba(0,196,180,0.2)",
};

const MATURITY_LABELS: Record<string, string> = {
  initial: "Initial", managed: "Managed", defined: "Defined",
  optimizing: "Optimizing", optimized: "Optimized",
};

const DOMAIN_STYLES: React.CSSProperties = {
  background: "rgba(148,163,184,0.08)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.15)",
};

const DOMAIN_LABELS: Record<string, string> = {
  access_management: "Access Mgmt", vendor_risk: "Vendor Risk",
  ai_governance: "AI Governance", regulatory: "Regulatory",
  vulnerability: "Vulnerability", resilience: "Resilience", general: "General",
};

const INACTIVE_STATUS_STYLES: React.CSSProperties = {
  background: "rgba(148,163,184,0.08)", color: "#64748b", border: "1px solid rgba(148,163,184,0.15)",
};

// ─────────────────────────────────────────────────────────────
// Assessment badge helpers
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

function Pill({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
      style={style}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const label = status.replace(/_/g, " ");
  return <Pill style={style}>{label.charAt(0).toUpperCase() + label.slice(1)}</Pill>;
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const style = SEVERITY_BADGE_STYLES[severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return <Pill style={style}>{severity}</Pill>;
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
// Classification badges row
// ─────────────────────────────────────────────────────────────

function ClassificationBadges({ control }: { control: Control }) {
  const badges: React.ReactNode[] = [];

  if (control.control_type) {
    const style = CONTROL_TYPE_STYLES[control.control_type] ?? INACTIVE_STATUS_STYLES;
    badges.push(
      <Pill key="type" style={style}>
        {CONTROL_TYPE_LABELS[control.control_type] ?? control.control_type}
      </Pill>
    );
  }

  if (control.implementation_status) {
    const style = IMPL_STATUS_STYLES[control.implementation_status] ?? INACTIVE_STATUS_STYLES;
    badges.push(
      <Pill key="impl" style={style}>
        {IMPL_STATUS_LABELS[control.implementation_status] ?? control.implementation_status}
      </Pill>
    );
  }

  if (control.maturity_level) {
    badges.push(
      <Pill key="maturity" style={MATURITY_STYLES}>
        {MATURITY_LABELS[control.maturity_level] ?? control.maturity_level}
      </Pill>
    );
  }

  if (control.domain) {
    badges.push(
      <Pill key="domain" style={DOMAIN_STYLES}>
        {DOMAIN_LABELS[control.domain] ?? control.domain}
      </Pill>
    );
  }

  if (control.status && control.status !== "active") {
    badges.push(
      <Pill key="status" style={INACTIVE_STATUS_STYLES}>
        {control.status.charAt(0).toUpperCase() + control.status.slice(1)}
      </Pill>
    );
  }

  if (badges.length === 0) return null;
  return <div className="flex items-center gap-1.5 flex-wrap mt-1.5">{badges}</div>;
}

// ─────────────────────────────────────────────────────────────
// Cadence filter logic
// ─────────────────────────────────────────────────────────────

type CadenceFilter = "all" | "overdue" | "due_this_month" | "no_cadence";

const CADENCE_FILTER_OPTIONS: Array<{ key: CadenceFilter; label: string }> = [
  { key: "all",            label: "All" },
  { key: "overdue",        label: "Overdue" },
  { key: "due_this_month", label: "Due This Month" },
  { key: "no_cadence",     label: "No Cadence Set" },
];

function applyCadenceFilter(controls: Control[], filter: CadenceFilter): Control[] {
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

          {/* Classification badges */}
          <ClassificationBadges control={control} />

          {control.description && (
            <p className="mt-1.5 text-xs line-clamp-2" style={{ color: "#94a3b8" }}>
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
// Filter select style
// ─────────────────────────────────────────────────────────────

const SELECT_STYLE: React.CSSProperties = {
  background: "#0d1626",
  borderColor: "#1e2d45",
  color: "#94a3b8",
  fontSize: "12px",
  padding: "5px 10px",
  borderRadius: "8px",
  border: "1px solid #1e2d45",
  outline: "none",
  cursor: "pointer",
};

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
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all");
  const [domainFilter, setDomainFilter]   = useState("");
  const [typeFilter, setTypeFilter]       = useState("");
  const [implFilter, setImplFilter]       = useState("");
  const [statusFilter, setStatusFilter]   = useState("");

  const overdueCount      = controls.filter((c) => c.is_overdue).length;
  const noCadenceCount    = controls.filter((c) => c.testing_frequency === null).length;
  const dueThisMonthCount = controls.filter((c) => {
    if (!c.next_test_due || c.is_overdue) return false;
    const d = daysUntil(c.next_test_due);
    return d >= 0 && d <= 30;
  }).length;

  // Collect distinct domain/type/impl/status values present in the data
  const domains      = [...new Set(controls.map((c) => c.domain).filter(Boolean) as string[])].sort();
  const types        = [...new Set(controls.map((c) => c.control_type).filter(Boolean) as string[])].sort();
  const implStatuses = [...new Set(controls.map((c) => c.implementation_status).filter(Boolean) as string[])].sort();
  const statuses     = [...new Set(controls.map((c) => c.status).filter(Boolean) as string[])].sort();

  const filtered = applyCadenceFilter(controls, cadenceFilter).filter((c) => {
    if (domainFilter && c.domain !== domainFilter) return false;
    if (typeFilter   && c.control_type !== typeFilter) return false;
    if (implFilter   && c.implementation_status !== implFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    return true;
  });

  const hasDropdownFilters = !!(domainFilter || typeFilter || implFilter || statusFilter);

  return (
    <div>
      {/* Cadence filter pills */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {CADENCE_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "overdue"        ? overdueCount :
            opt.key === "due_this_month" ? dueThisMonthCount :
            opt.key === "no_cadence"     ? noCadenceCount :
            null;
          const active = cadenceFilter === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setCadenceFilter(opt.key)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={
                active
                  ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
                  : { background: "transparent", color: "#64748b", border: "1px solid #1e293b" }
              }
            >
              {opt.label}
              {count !== null && count > 0 && (
                <span className="ml-0.5 font-bold" style={{ color: opt.key === "overdue" ? "#fca5a5" : undefined }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Classification filter dropdowns */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {domains.length > 0 && (
          <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} style={SELECT_STYLE}>
            <option value="">All Domains</option>
            {domains.map((d) => (
              <option key={d} value={d} style={{ background: "#0d1626" }}>
                {DOMAIN_LABELS[d] ?? d}
              </option>
            ))}
          </select>
        )}

        {types.length > 0 && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={SELECT_STYLE}>
            <option value="">All Types</option>
            {types.map((t) => (
              <option key={t} value={t} style={{ background: "#0d1626" }}>
                {CONTROL_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        )}

        {implStatuses.length > 0 && (
          <select value={implFilter} onChange={(e) => setImplFilter(e.target.value)} style={SELECT_STYLE}>
            <option value="">All Statuses</option>
            {implStatuses.map((s) => (
              <option key={s} value={s} style={{ background: "#0d1626" }}>
                {IMPL_STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        )}

        {statuses.length > 1 && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={SELECT_STYLE}>
            <option value="">All Record Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s} style={{ background: "#0d1626" }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        )}

        {hasDropdownFilters && (
          <button
            onClick={() => { setDomainFilter(""); setTypeFilter(""); setImplFilter(""); setStatusFilter(""); }}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "#475569", background: "none", border: "none", cursor: "pointer", padding: "5px 8px" }}
          >
            Clear filters
          </button>
        )}
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
