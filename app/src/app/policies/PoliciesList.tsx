"use client";

import { useState } from "react";
import Link from "next/link";
import type { Policy } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  draft:        { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  active:       { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  under_review: { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  retired:      { background: "rgba(100,116,139,0.1)",  color: "#64748b" },
};

const STATUS_LABELS: Record<string, string> = {
  draft:        "Draft",
  active:       "Active",
  under_review: "Under Review",
  retired:      "Retired",
};

const CATEGORY_LABELS: Record<string, string> = {
  access_control:         "Access Control",
  incident_response:      "Incident Response",
  change_management:      "Change Management",
  data_classification:    "Data Classification",
  business_continuity:    "Business Continuity",
  acceptable_use:         "Acceptable Use",
  vendor_management:      "Vendor Management",
  vulnerability_management: "Vulnerability Management",
  other:                  "Other",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

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
// Badge components
// ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span style={{
      display: "inline-block",
      background: "rgba(0,196,180,0.1)", color: "#00c4b4",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function OverdueBadge() {
  return (
    <span style={{
      display: "inline-block",
      background: "rgba(239,68,68,0.15)", color: "#fca5a5",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      Review overdue
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Filter logic
// ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "active" | "draft" | "under_review" | "overdue";

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string }> = [
  { key: "all",          label: "All" },
  { key: "active",       label: "Active" },
  { key: "draft",        label: "Draft" },
  { key: "under_review", label: "Under Review" },
  { key: "overdue",      label: "Overdue" },
];

function applyFilter(policies: Policy[], filter: FilterKey): Policy[] {
  switch (filter) {
    case "active":       return policies.filter((p) => p.status === "active");
    case "draft":        return policies.filter((p) => p.status === "draft");
    case "under_review": return policies.filter((p) => p.status === "under_review");
    case "overdue":      return policies.filter((p) => p.is_overdue);
    default:             return policies;
  }
}

// ─────────────────────────────────────────────────────────────
// PolicyCard
// ─────────────────────────────────────────────────────────────

function PolicyCard({ policy }: { policy: Policy }) {
  const days = policy.next_review_at ? daysUntil(policy.next_review_at) : null;
  const dueSoon = !policy.is_overdue && days !== null && days >= 0 && days <= 30;

  return (
    <div
      className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={policy.status} />
            <CategoryBadge category={policy.category} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <span className="text-sm font-medium" style={{ color: "#f1f5f9" }}>
              {policy.name}
            </span>
            {policy.version && (
              <span className="text-xs" style={{ color: "#475569" }}>
                v{policy.version}
              </span>
            )}
          </div>
          {policy.owner && (
            <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
              Owner: {policy.owner}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 text-right space-y-1">
          {policy.is_overdue && <OverdueBadge />}
          {!policy.is_overdue && dueSoon && policy.next_review_at && (
            <p className="text-xs font-medium" style={{ color: "#fcd34d" }}>
              Due {fmt(policy.next_review_at)}
            </p>
          )}
          {!policy.is_overdue && !dueSoon && policy.next_review_at && (
            <p className="text-xs" style={{ color: "#475569" }}>
              Next review {fmt(policy.next_review_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PoliciesList (exported)
// ─────────────────────────────────────────────────────────────

interface Props {
  policies: Policy[];
}

export function PoliciesList({ policies }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const filtered = applyFilter(policies, activeFilter);
  const overdueCount = policies.filter((p) => p.is_overdue).length;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {FILTER_OPTIONS.map((opt) => {
          const count = opt.key === "overdue" ? overdueCount : null;
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
                <span className="ml-0.5 font-bold" style={{ color: "#fca5a5" }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No policies match this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((policy) => (
            <Link key={policy.id} href={`/policies/${policy.id}`} className="block">
              <PolicyCard policy={policy} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
