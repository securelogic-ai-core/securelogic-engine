/**
 * RecentFindings — compact recent-findings list for the dashboard surfaces.
 *
 * Extracted from page.tsx (unchanged rendering) so the legacy dashboard and the
 * flag-gated Briefing composition share ONE implementation instead of two
 * drifting copies. The empty state distinguishes "no findings" (confirmed by a
 * zero summary count) from "could not load" — a load failure must never read as
 * a clean bill of health.
 */

import Link from "next/link";
import type { Finding } from "@/lib/api";

const SEVERITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",  color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

const SOURCE_COMPACT_LABELS: Record<string, string> = {
  vendor_review:        "Vendor",
  control_test:         "Control",
  obligation_review:    "Obligation",
  ai_review:            "AI Review",
  ai_governance_review: "AI Gov",
  manual:               "Manual",
  assessment:           "Assessment",
  signal:               "Signal",
  risk:                 "Risk",
  // Walkthrough item 6: complete coverage of the findings_source_type_check enum
  // (migration 20260823) — these values previously fell through the raw
  // `?? f.source_type` fallback below and rendered as internal enums.
  cyber_signal:             "Signal",
  intelligence_event:       "Intelligence",
  dependency_review:        "Dependency",
  vendor_cycle_review:      "Vendor",
  applicability_assessment: "Applicability",
  asset_assessment:         "Asset",
};

export function RecentFindings({ findings, summaryActiveCount }: { findings: Finding[]; summaryActiveCount: number }) {
  const noFindings = findings.length === 0;
  const summaryConfirmsZero = summaryActiveCount === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          Recent Findings
        </h2>
        <Link
          href="/findings?queue=all"
          className="text-xs font-medium transition-colors"
          style={{ color: "#00c4b4" }}
        >
          View all findings →
        </Link>
      </div>

      {noFindings ? (
        summaryConfirmsZero ? (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(34,197,94,0.2)" }}
          >
            <p className="text-sm" style={{ color: "#86efac" }}>
              No active findings. Your organization is in good shape.
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
          >
            <p className="text-sm mb-2" style={{ color: "#94a3b8" }}>
              Could not load recent findings.
            </p>
            <Link href="/findings?queue=all" className="text-xs font-medium" style={{ color: "#00c4b4" }}>
              View all findings →
            </Link>
          </div>
        )
      ) : (
        <div
          className="rounded-xl border divide-y"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b", "--tw-divide-opacity": "1" } as React.CSSProperties}
        >
          {findings.map((f) => {
            const sevStyle = SEVERITY_BADGE_STYLES[f.severity ?? ""] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
            const sourceLabel = SOURCE_COMPACT_LABELS[f.source_type] ?? f.source_type;
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderColor: "#1e293b" }}
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                  style={sevStyle}
                >
                  {f.severity}
                </span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: "#f1f5f9" }}>
                  {f.title}
                </span>
                <span
                  className="text-xs shrink-0 px-2 py-0.5 rounded"
                  style={{ background: "rgba(148,163,184,0.08)", color: "#64748b" }}
                >
                  {f.domain ?? sourceLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
