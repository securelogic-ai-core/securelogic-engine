"use client";

/**
 * RiskRow — single row in the Risk Register table.
 *
 * Shape: EnrichedRiskRow combines the basic risks fields (title,
 * domain, risk_rating, status, owner, due_date, updated_at) with
 * intelligence-endpoint counts (active_treatments, linked_findings).
 *
 * Visual treatment of pills mirrors the previous RiskCard exactly:
 * rating uses useRiskScale (relabeled per org's preset), status uses
 * the hardcoded STATUS_STYLES map, domain uses muted-slate. Pills are
 * inline-flex with px-2 py-0.5 rounded text-xs.
 *
 * The title cell links to /risks/[id]. Treatment and finding counts
 * link to filtered list pages so users can drill from a row into a
 * scoped view.
 */

import Link from "next/link";
import type { RiskScaleLevel } from "@/lib/api";

export type EnrichedRiskRow = {
  id: string;
  title: string;
  domain: string | null;
  risk_rating: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  updated_at: string | null;
  active_treatments: number;
  linked_findings: number;
};

const FALLBACK_RATING_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  accepted:    { background: "rgba(245,158,11,0.12)", color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  closed:      { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

function ratingStyleFromScale(
  ratingValue: string | null,
  scaleLevels: RiskScaleLevel[]
): React.CSSProperties {
  if (!ratingValue) return { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const v = ratingValue.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  if (level) return { background: `${level.color}26`, color: level.color };
  return FALLBACK_RATING_STYLES[ratingValue] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
}

function ratingLabel(value: string | null, scaleLevels: RiskScaleLevel[]): string {
  if (!value) return "—";
  const v = value.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  return level?.label ?? value;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Relative-time formatter for "Last Updated". "3 days ago", "2 hours ago",
 * "just now". Falls back to absolute date for >30 days. Pure function.
 */
function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)        return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)        return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)         return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30)        return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return fmtDate(dateStr);
}

const PILL = "inline-flex items-center px-2 py-0.5 rounded text-xs";

export function RiskRow({
  risk,
  scaleLevels,
}: {
  risk: EnrichedRiskRow;
  scaleLevels: RiskScaleLevel[];
}) {
  const ratingStyle = ratingStyleFromScale(risk.risk_rating, scaleLevels);
  const statusStyle = STATUS_STYLES[risk.status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };

  // Treatment + finding count-cell drill targets. Filtering /risks-treatments
  // by risk_id and findings by source_type=risk + source_id is supported by
  // the existing endpoints (confirmed in investigation).
  const treatmentsHref = `/risks/${risk.id}#treatments`;
  const findingsHref = `/findings?source_type=risk&source_id=${risk.id}`;

  return (
    <tr
      className="hover:bg-white/[0.02] transition-colors"
      style={{ borderTop: "1px solid #1e293b" }}
    >
      <td className="px-5 py-3" style={{ maxWidth: 320 }}>
        <Link
          href={`/risks/${risk.id}`}
          className="text-sm font-medium hover:opacity-80 truncate inline-block"
          style={{ color: "#f1f5f9", maxWidth: "100%" }}
        >
          {risk.title}
        </Link>
      </td>
      <td className="px-5 py-3">
        {risk.domain ? (
          <span
            className={PILL}
            style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
          >
            {risk.domain}
          </span>
        ) : (
          <span style={{ color: "#475569" }}>—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span className={`${PILL} font-semibold`} style={ratingStyle}>
          {ratingLabel(risk.risk_rating, scaleLevels)}
        </span>
      </td>
      <td className="px-5 py-3">
        <span className={`${PILL} font-medium`} style={statusStyle}>
          {statusLabel(risk.status)}
        </span>
      </td>
      <td className="px-5 py-3 text-sm" style={{ color: risk.owner ? "#cbd5e1" : "#475569" }}>
        {risk.owner ?? "—"}
      </td>
      <td className="px-5 py-3 text-sm" style={{ color: risk.due_date ? "#cbd5e1" : "#475569" }}>
        {fmtDate(risk.due_date)}
      </td>
      <td className="px-5 py-3 text-sm tabular-nums">
        {risk.active_treatments > 0 ? (
          <Link href={treatmentsHref} style={{ color: "#00c4b4" }}>
            {risk.active_treatments}
          </Link>
        ) : (
          <span style={{ color: "#475569" }}>0</span>
        )}
      </td>
      <td className="px-5 py-3 text-sm tabular-nums">
        {risk.linked_findings > 0 ? (
          <Link href={findingsHref} style={{ color: "#fcd34d" }}>
            {risk.linked_findings}
          </Link>
        ) : (
          <span style={{ color: "#475569" }}>0</span>
        )}
      </td>
      <td className="px-5 py-3 text-xs" style={{ color: "#94a3b8" }}>
        {fmtRelative(risk.updated_at)}
      </td>
    </tr>
  );
}
