"use client";

import { useState } from "react";
import type { PostureSnapshot } from "@/lib/api";

const TEAL       = "#00c4b4";
const SLATE_LINE = "#1e293b";
const TEXT_MUTED = "#64748b";
const SURFACE    = "var(--color-brand-surface, #111827)";

const CHART_W  = 600;
const CHART_H  = 120;
const PAD_T    = 16;
const PAD_B    = 28; // extra room for x-axis labels
const PAD_L    = 16;
const PAD_R    = 16;
const INNER_W  = CHART_W - PAD_L - PAD_R;
const INNER_H  = CHART_H - PAD_T - PAD_B;

function formatLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function scoreToY(score: number): number {
  // score 0–100, y=0 is top (score 100), y=INNER_H is bottom (score 0)
  return PAD_T + INNER_H - (score / 100) * INNER_H;
}

function indexToX(i: number, total: number): number {
  if (total === 1) return PAD_L + INNER_W / 2;
  return PAD_L + (i / (total - 1)) * INNER_W;
}

export function PostureTrendChart({ snapshots }: { snapshots: PostureSnapshot[] }) {
  const [selectedDays, setSelectedDays] = useState<30 | 60 | 90>(90);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - selectedDays);
  const filtered = snapshots
    .filter((s) => new Date(s.snapshot_date) >= cutoff)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  const days: Array<30 | 60 | 90> = [30, 60, 90];

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: SURFACE, borderColor: SLATE_LINE }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
            Posture Score Trend
          </p>
          <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
            {filtered.length} {filtered.length === 1 ? "snapshot" : "snapshots"}
          </p>
        </div>

        {/* Time range toggle */}
        <div className="flex items-center gap-1">
          {days.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDays(d)}
              style={{
                background:   selectedDays === d ? TEAL : "transparent",
                color:        selectedDays === d ? "#0a0f1a" : TEXT_MUTED,
                border:       `1px solid ${selectedDays === d ? TEAL : SLATE_LINE}`,
                borderRadius: "20px",
                fontSize:     "10px",
                fontWeight:   600,
                padding:      "2px 8px",
                cursor:       "pointer",
                transition:   "background 0.15s, color 0.15s",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart or empty state */}
      {filtered.length < 2 ? (
        <p className="text-xs py-6 text-center" style={{ color: TEXT_MUTED }}>
          Not enough data yet. Check back after the next scheduled snapshot.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
          aria-label="Posture score over time"
        >
          {/* Area fill */}
          <polygon
            points={[
              ...filtered.map((s, i) => `${indexToX(i, filtered.length)},${scoreToY(s.overall_score ?? 0)}`),
              `${indexToX(filtered.length - 1, filtered.length)},${PAD_T + INNER_H}`,
              `${indexToX(0, filtered.length)},${PAD_T + INNER_H}`,
            ].join(" ")}
            fill={TEAL}
            fillOpacity="0.10"
          />

          {/* Line */}
          <polyline
            points={filtered
              .map((s, i) => `${indexToX(i, filtered.length)},${scoreToY(s.overall_score ?? 0)}`)
              .join(" ")}
            fill="none"
            stroke={TEAL}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Data points + tooltips + x-axis labels */}
          {filtered.map((s, i) => {
            const x = indexToX(i, filtered.length);
            const y = scoreToY(s.overall_score ?? 0);
            const label = formatLabel(s.snapshot_date);
            return (
              <g key={s.id}>
                <circle cx={x} cy={y} r={3} fill={TEAL}>
                  <title>{label}: {s.overall_score ?? "—"}</title>
                </circle>
                <text
                  x={x}
                  y={PAD_T + INNER_H + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill={TEXT_MUTED}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
