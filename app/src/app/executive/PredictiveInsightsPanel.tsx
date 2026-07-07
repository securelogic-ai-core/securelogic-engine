/**
 * PredictiveInsightsPanel.tsx — LLM-assisted (or deterministic) forecast
 * narrative + prioritized recommendations, plus a posture-forecast sparkline.
 * Server-renderable. Consumes GET /api/predictive/insights + /posture-forecast.
 */

import {
  seriesToPoints,
  priorityMeta,
  dimensionLabel,
  round1,
  type PredictiveInsights,
  type PostureForecastResponse,
} from "@/lib/executiveRisk";

const TEAL = "#00c4b4";
const MUTED = "#64748b";

function Sparkline({ forecast }: { forecast: PostureForecastResponse }) {
  const scores = forecast.observations.map((o) => o.score).filter((s): s is number => s !== null);
  if (scores.length < 2) {
    return <p className="text-xs" style={{ color: MUTED }}>Not enough history for a posture forecast yet.</p>;
  }
  const W = 260;
  const H = 60;
  const pts = seriesToPoints(scores, { width: W, height: H, padX: 4, padY: 6 });
  const projected = forecast.forecast?.projected_value;
  const trend = forecast.forecast?.trend;
  const trendColor = trend === "increasing" ? "#86efac" : trend === "decreasing" ? "#fca5a5" : MUTED;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label="Posture score forecast">
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={TEAL} strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill={TEAL} />
        ))}
      </svg>
      <div>
        <p className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>Posture ({forecast.horizon_days}d)</p>
        <p className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
          {projected !== undefined ? round1(projected) : "—"}
        </p>
        {trend && <p className="text-xs font-medium" style={{ color: trendColor }}>{trend}</p>}
      </div>
    </div>
  );
}

export function PredictiveInsightsPanel({
  insights,
  horizonDays,
  forecast,
}: {
  insights: PredictiveInsights;
  horizonDays: number;
  forecast: PostureForecastResponse | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>{insights.headline}</p>
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: "rgba(148,163,184,0.12)", color: "#94a3b8" }}
          title={insights.source === "llm" ? "AI-assisted analysis" : "Deterministic analysis"}
        >
          {insights.source === "llm" ? "AI-assisted" : "Deterministic"}
        </span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>{insights.narrative}</p>

      {forecast && <Sparkline forecast={forecast} />}

      {insights.recommendations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            Recommended actions · next {horizonDays}d
          </p>
          <ul className="space-y-2">
            {insights.recommendations.map((r, i) => {
              const p = priorityMeta(r.priority);
              return (
                <li key={i} className="rounded-lg border border-brand-line p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}
                    >
                      {p.label}
                    </span>
                    <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{dimensionLabel(r.dimension)}</span>
                  </div>
                  <p className="text-xs" style={{ color: "#cbd5e1" }}>{r.action}</p>
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>{r.rationale}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
