import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getDashboardSummary,
  getPostureHistory,
  getFrameworks,
  getFrameworkReadiness,
  type Framework,
  type FrameworkReadiness,
} from "@/lib/api";
import { formatDateOnlyUTC } from "@/lib/dates";
import { postureDelta, formatPostureDelta } from "@/lib/postureTrend";
import { briefingHomeLabel } from "@/lib/navigation";
import { PostureAnalyticsGrid } from "./PostureAnalyticsGrid";

const SEVERITY_STYLES: Record<string, { badge: string; bar: string; label: string; color: string }> = {
  Critical: { badge: "bg-red-900/40 text-red-300",      bar: "bg-red-500",    label: "Critical", color: "#fca5a5" },
  High:     { badge: "bg-orange-900/40 text-orange-300", bar: "bg-orange-400", label: "High",     color: "#fdba74" },
  Moderate: { badge: "bg-amber-900/40 text-amber-300",   bar: "bg-amber-400",  label: "Moderate", color: "#fcd34d" },
  Low:      { badge: "bg-green-900/40 text-green-300",   bar: "bg-green-500",  label: "Low",      color: "#86efac" },
};

function severityStyle(s: string | null): { badge: string; bar: string; label: string; color: string } {
  if (s && SEVERITY_STYLES[s]) return SEVERITY_STYLES[s]!;
  return { badge: "bg-slate-700/40 text-slate-400", bar: "bg-slate-600", label: s ?? "—", color: "#94a3b8" };
}

const STAT_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

export default async function PosturePage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  // Read-surface architecture D1: /posture is the canonical Posture Dashboard.
  // It now carries the full analytics composition, so it needs the same inputs
  // the legacy dashboard grid used — the 90-day trend history and the
  // framework readiness pairs — alongside the summary. Existing endpoints
  // only; no new calculations.
  const [summary, postureHistory, frameworksData] = await Promise.all([
    getDashboardSummary(token),
    // 365 days (cap raised to 400 in EG2 slice 12): feeds the QoQ/YoY trend
    // windows and the period-delta stats below.
    getPostureHistory(token, 365),
    getFrameworks(token),
  ]);
  const frameworks = frameworksData?.frameworks ?? [];
  const frameworkReadinessResults = frameworks.length > 0
    ? await Promise.all(frameworks.map((f) => getFrameworkReadiness(token, f.id)))
    : [];
  const frameworkPairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }> =
    frameworks.map((f, i) => ({ framework: f, readiness: frameworkReadinessResults[i] ?? null }));

  // The home route renders The Briefing only under the briefing flag; the
  // back-link must name the experience that is actually there (helper rule).
  const homeLabel = briefingHomeLabel(
    process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED === "true",
  );

  if (!summary) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/dashboard" className="text-xs font-medium mb-6 inline-block transition-colors hover:opacity-80" style={{ color: "#64748b" }}>
          ← {homeLabel}
        </Link>
        <div className="rounded-xl border p-10 text-center" style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}>
          <p className="text-sm" style={{ color: "#94a3b8" }}>Unable to load posture data.</p>
        </div>
      </div>
    );
  }

  const { posture, domains, findings } = summary;
  const hasSnapshot = posture.overall_score !== null;
  const scoreStyle = severityStyle(posture.overall_severity);

  // Period deltas (EG2 slice 12) — computed from the same 365-day history the
  // trend chart draws, through the shared helper, so the stat and the chart
  // can never disagree.
  const trendSnapshots = postureHistory?.snapshots ?? [];
  const delta30 = postureDelta(trendSnapshots, 30);
  const delta90 = postureDelta(trendSnapshots, 90);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="text-xs font-medium mb-6 inline-block transition-colors hover:opacity-80"
        style={{ color: "#64748b" }}
      >
        ← {homeLabel}
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Security Posture
          </h1>
          {/* Posture display ruling (2026-07-15): scores arrive HEALTH-style from
              the API's canonical mapper (src/api/lib/postureDisplay.ts). */}
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Overall security health across all domains · higher = better
          </p>
          {/* Executive Report export lives HERE (D1): the PDF is an
              org-performance artifact, so its entry point is the Posture
              Dashboard, not the opening experience. */}
          <a
            href="/api/export/executive-report"
            download="executive-report.pdf"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{ border: "1px solid rgba(0,196,180,0.4)", color: "#00c4b4", textDecoration: "none" }}
          >
            &#8595; Executive Report
          </a>
        </div>

        {hasSnapshot && (
          <div
            className="flex flex-col items-center justify-center rounded-xl border px-6 py-4"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b", minWidth: "140px" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>
              Overall Posture Score
            </p>
            <p className="text-5xl font-bold leading-none mb-2" style={{ color: scoreStyle.color }}>
              {posture.overall_score}
            </p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${scoreStyle.badge}`}>
              {scoreStyle.label}
            </span>
            {/* Item 2b: DATE fields format in UTC via the shared helper so this
                page can never disagree with the dashboard about the same date. */}
            {posture.snapshot_date && (
              <p className="mt-2 text-xs" style={{ color: "#475569" }}>
                as of {formatDateOnlyUTC(posture.snapshot_date)}
              </p>
            )}
            {/* Period deltas (EG2 slice 12): "are we improving?" answered on
                the score card itself. Rendered only when an honest baseline
                exists near the window edge — never a fabricated 0%. */}
            {(delta30 || delta90) && (
              <div className="mt-2 flex items-center gap-3">
                {delta30 && (
                  <span className="text-xs font-semibold" style={{ color: delta30.points >= 0 ? "#86efac" : "#fca5a5" }}>
                    30d {formatPostureDelta(delta30)}
                  </span>
                )}
                {delta90 && (
                  <span className="text-xs font-semibold" style={{ color: delta90.points >= 0 ? "#86efac" : "#fca5a5" }}>
                    90d {formatPostureDelta(delta90)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Findings by Severity */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: "#64748b" }}>
          Active Findings by Severity
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(["Critical", "High", "Moderate", "Low"] as const).map((sev) => {
            const count = findings.by_severity[sev] ?? 0;
            const s = severityStyle(sev);
            return (
              <Link
                key={sev}
                href={`/findings?severity=${sev}&active=true`}
                className="block rounded-xl border p-5 transition-colors hover:border-teal-800"
                style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b", textDecoration: "none" }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
                  {sev}
                </p>
                <p className="text-3xl font-bold" style={{ color: s.color }}>{count}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Domain Breakdown table */}
      {domains.length > 0 ? (
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid #1e293b" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Domain Breakdown
            </h2>
            {/* Metric Contract honesty: these counts are frozen at snapshot
                time; the links open the LIVE findings list, which may differ.
                Say so instead of letting the two look contradictory. */}
            <p className="text-xs mt-1" style={{ color: "#475569" }}>
              Health score (0–100) · higher = better. Counts are from this snapshot — links open the live findings list, which may have changed since.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Domain", "Score", "Severity", "Findings", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "#475569" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="px-5">
                {domains.map((d, i) => (
                  <tr
                    key={d.domain}
                    style={{
                      borderTop: i > 0 ? "1px solid #1e293b" : undefined,
                      background: i % 2 === 1 ? "rgba(255,255,255,0.015)" : undefined,
                    }}
                  >
                    <td className="px-5 py-3">
                      <span className="text-sm font-medium" style={{ color: "#f1f5f9" }}>
                        {d.domain}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {d.score === null ? (
                        /* Enterprise truth: a domain that has not been scored is
                           UNKNOWN, not failing. `?? 0` rendered it as the worst
                           possible health (bold 0, empty bar) — a fabrication on
                           the executive table. The severity column already
                           renders its null as "—"; the score column now keeps
                           the same promise. */
                        <span
                          className="text-xs"
                          style={{ color: "#475569" }}
                          aria-label={`${d.domain} has not been scored yet`}
                        >
                          — not yet scored
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-20 rounded-full h-1.5 flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }}>
                            <div
                              className={`h-1.5 rounded-full ${severityStyle(d.severity).bar}`}
                              style={{ width: `${Math.min(d.score, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold tabular-nums w-8" style={{ color: severityStyle(d.severity).color }}>
                            {d.score}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${severityStyle(d.severity).badge}`}>
                        {severityStyle(d.severity).label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {d.finding_count > 0 ? (
                        <Link
                          href={`/findings?domain=${encodeURIComponent(d.domain)}&active=true`}
                          className="text-sm font-medium transition-colors hover:text-teal-300"
                          style={{ color: "#00c4b4" }}
                        >
                          {d.finding_count}
                        </Link>
                      ) : (
                        <span className="text-sm" style={{ color: "#334155" }}>0</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm" style={{ color: d.action_count > 0 ? "#94a3b8" : "#334155" }}>
                        {d.action_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        !hasSnapshot && (
          <div
            className="rounded-xl border p-10 text-center mb-8"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
          >
            <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
              No posture snapshot yet. Add controls and run an assessment to generate your posture score.
            </p>
            <div className="flex items-center justify-center gap-3 text-xs">
              <Link href="/controls/new" className="font-medium transition-colors hover:opacity-80" style={{ color: "#00c4b4" }}>
                Add a control →
              </Link>
              <span style={{ color: "#334155" }}>or</span>
              <Link href="/controls" className="font-medium transition-colors hover:opacity-80" style={{ color: "#00c4b4" }}>
                Run an assessment →
              </Link>
            </div>
          </div>
        )
      )}

      {/* Findings overview stat tile */}
      {hasSnapshot && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div style={STAT_CARD_STYLE}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
              Total Active Findings
            </p>
            <p className="text-3xl font-bold mb-3" style={{ color: "#f1f5f9" }}>{findings.open}</p>
            <Link
              href="/findings?active=true"
              className="text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              View all active findings →
            </Link>
          </div>
          <div style={STAT_CARD_STYLE}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
              Domains Tracked
            </p>
            <p className="text-3xl font-bold mb-3" style={{ color: "#f1f5f9" }}>{domains.length}</p>
            <Link
              href="/findings?queue=all"
              className="text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              View all findings →
            </Link>
          </div>
        </div>
      )}

      {/* Canonical analytics composition (D1) — fixed order, org scope, no
          per-user customize. Each tile carries its own empty state, so the
          grid renders whenever the summary loaded. */}
      <PostureAnalyticsGrid
        summary={summary}
        frameworkPairs={frameworkPairs}
        postureSnapshots={postureHistory?.snapshots ?? []}
      />
    </div>
  );
}
