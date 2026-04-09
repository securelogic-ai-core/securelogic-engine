import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssue } from "@/lib/api";
import type { BriefSignal, BriefSections, ActionSummary, NewsletterIssue } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function riskColor(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "border-l-red-500";
  if (l === "high")     return "border-l-orange-500";
  if (l === "medium")   return "border-l-yellow-500";
  return "border-l-green-500";
}

function riskPillClass(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high")     return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium")   return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

function priorityTierClass(tier: string) {
  if (tier === "IMMEDIATE") return "bg-red-50 text-red-600 border border-red-200";
  if (tier === "NEAR-TERM") return "bg-orange-50 text-orange-600 border border-orange-200";
  return "bg-slate-50 text-slate-500 border border-slate-200";
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    AI_GOVERNANCE:     "AI Governance",
    SECURITY_INCIDENT: "Security",
    REGULATION:        "Regulatory",
    VENDOR_RISK:       "Vendor Risk",
    COMPLIANCE_UPDATE: "Compliance",
  };
  return labels[category] ?? category;
}

function deriveSectionLabel(key: string): string {
  const labels: Record<string, string> = {
    aiGovernance:     "AI Governance",
    securityIncidents:"Security Incidents",
    regulations:      "Regulatory Changes",
    vendorRisk:       "Vendor Risk",
    compliance:       "Compliance",
  };
  return labels[key] ?? key;
}

function deriveSectionAccent(key: string): string {
  const accents: Record<string, string> = {
    aiGovernance:     "bg-purple-500",
    securityIncidents:"bg-red-500",
    regulations:      "bg-blue-500",
    vendorRisk:       "bg-orange-500",
    compliance:       "bg-cyan-500",
  };
  return accents[key] ?? "bg-slate-400";
}

/**
 * Derive top 3 signals from sections_json by priority score, then risk level.
 */
function deriveTopSignals(sections: BriefSections): BriefSignal[] {
  const all: BriefSignal[] = Object.values(sections)
    .flat()
    .filter((s): s is BriefSignal => !!s && typeof s === "object");

  return all
    .sort((a, b) => {
      const scoreDiff = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const rankMap: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (rankMap[(b.riskLevel ?? "low").toLowerCase()] ?? 1) -
             (rankMap[(a.riskLevel ?? "low").toLowerCase()] ?? 1);
    })
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Signal card — full web version (Priority Intelligence)
// ---------------------------------------------------------------------------

function PrioritySignalCard({ signal }: { signal: BriefSignal }) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const analysis = signal.whyItMatters || signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const tier = signal.priorityTier ?? "";

  return (
    <div className={`border border-slate-200 border-l-4 ${riskColor(risk)} rounded-xl p-6 bg-white`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-slate-900 font-bold text-base leading-snug flex-1">
          {signal.title}
        </h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          {tier && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${priorityTierClass(tier)}`}>
              {tier}
            </span>
          )}
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide ${riskPillClass(risk)}`}>
            {risk}
          </span>
        </div>
      </div>

      {/* Category */}
      <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-4">
        {categoryLabel(signal.category)}
      </p>

      {/* Risk Rationale */}
      {signal.riskRationale && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Risk Assessment
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            {signal.riskRationale}
          </p>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Analysis
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {analysis}
          </p>
        </div>
      )}

      {/* Action Roadmap */}
      {action && (
        <div className="mb-4 bg-slate-50 rounded-lg p-4 border border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Recommended Action
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {action}
          </p>
        </div>
      )}

      {/* Source */}
      {(signal.sourceUrl ?? signal.source_url) && (
        <div className="pt-4 border-t border-slate-100">
          <a
            href={signal.sourceUrl ?? signal.source_url ?? ""}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-teal-600 transition-colors"
          >
            Primary source: {signal.source ?? "View source"} →
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal card — category section version (compact)
// ---------------------------------------------------------------------------

function CategorySignalCard({ signal }: { signal: BriefSignal }) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const analysis = signal.whyItMatters || signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";

  return (
    <div className={`border border-slate-200 border-l-4 ${riskColor(risk)} rounded-lg p-5 bg-white`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-slate-900 font-semibold text-sm leading-snug flex-1">
          {signal.title}
        </h4>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
          {risk}
        </span>
      </div>

      {analysis && (
        <p className="text-sm text-slate-600 leading-relaxed mb-3">
          {analysis}
        </p>
      )}

      {action && (
        <p className="text-sm text-slate-700 leading-relaxed">
          <span className="font-semibold text-slate-800">Action: </span>
          {action}
        </p>
      )}

      {signal.source && (
        <p className="mt-3 text-xs text-slate-400">
          {signal.source}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Summary
// ---------------------------------------------------------------------------

function ActionSummarySection({ summary }: { summary: ActionSummary }) {
  const groups = [
    { label: "Before End of Week", key: "thisWeek" as const, color: "text-red-600", dot: "bg-red-500" },
    { label: "Before End of Month", key: "thisMonth" as const, color: "text-orange-600", dot: "bg-orange-400" },
    { label: "Ongoing Monitoring", key: "monitor" as const, color: "text-slate-600", dot: "bg-slate-400" },
  ];

  const hasContent = groups.some((g) => (summary[g.key] ?? []).length > 0);
  if (!hasContent) return null;

  return (
    <section>
      <SectionHeader label="Action Summary" accent="bg-teal-500" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {groups.map(({ label, key, color, dot }) => {
          const items = summary[key] ?? [];
          if (!items.length) return null;
          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl p-5">
              <p className={`text-xs font-bold uppercase tracking-wide mb-3 ${color}`}>
                {label}
              </p>
              <ul className="space-y-2.5">
                {items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0 mt-1.5`} />
                    <span className="text-sm text-slate-700 leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared section header
// ---------------------------------------------------------------------------

function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-1 h-5 ${accent} rounded-full flex-shrink-0`} />
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
        {label}
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locked brief state — value-demonstrating teaser
// ---------------------------------------------------------------------------

function LockedBriefState({ issue }: { issue: NewsletterIssue }) {
  const teaser = issue.thesis_headline ?? issue.summary;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link href="/briefs" className="text-slate-500 hover:text-slate-700 text-sm transition-colors">
          ← Briefs
        </Link>
      </div>

      {/* Brief header — visible even when locked */}
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">
        {issue.publish_date ? formatDate(issue.publish_date) : formatDate(issue.created_at)}
      </p>
      <h1 className="text-2xl font-bold text-slate-900 leading-tight mb-4">
        {issue.title}
      </h1>
      {teaser && (
        <p className="text-slate-600 text-base leading-relaxed mb-8">
          {teaser}
        </p>
      )}

      {/* Teaser paywall card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-slate-500">
            <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-2 text-center">
          Full brief requires a subscription
        </h2>
        <p className="text-slate-500 text-sm mb-6 text-center max-w-sm mx-auto">
          Subscribers get the full analysis — signal-by-signal breakdown, risk scoring rationale,
          staged action roadmaps, and the weekly cross-domain pattern synthesis.
        </p>

        {/* What subscribers see */}
        <div className="bg-slate-50 rounded-lg p-4 mb-6 max-w-sm mx-auto">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            In this brief
          </p>
          <ul className="space-y-2">
            {[
              "Priority Intelligence — top 3 signals with full analysis",
              "Risk scoring rationale for each critical signal",
              "Staged action roadmap (this week / this month / monitor)",
              "Cross-domain pattern analysis",
              "Category deep dives across all risk domains",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="w-1 h-1 bg-teal-500 rounded-full flex-shrink-0 mt-1.5" />
                <span className="text-xs text-slate-600">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <form action="/api/billing/checkout" method="POST">
            <input type="hidden" name="tier" value="professional" />
            <button
              type="submit"
              className="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              Professional — $39/mo
            </button>
          </form>
          <form action="/api/billing/checkout" method="POST">
            <input type="hidden" name="tier" value="team" />
            <button
              type="submit"
              className="border border-slate-300 text-slate-700 hover:border-slate-400 font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              Team — $209/mo
            </button>
          </form>
        </div>
        <p className="mt-4 text-xs text-slate-400 text-center">Cancel any time.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full brief reader — premium experience
// ---------------------------------------------------------------------------

function BriefReader({ issue }: { issue: NewsletterIssue }) {
  const sections = issue.sections_json ?? {} as BriefSections;
  const topSignals = deriveTopSignals(sections);
  const topSignalTitles = new Set(topSignals.map((s) => s.title));

  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  // Count all signals across sections for the header
  const allSignals = Object.values(sections).flat().filter(Boolean) as BriefSignal[];
  const criticalCount = allSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "critical").length;
  const highCount = allSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "high").length;

  const sectionOrder = ["securityIncidents", "aiGovernance", "regulations", "vendorRisk", "compliance"] as const;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">

      {/* Breadcrumb */}
      <div className="mb-8">
        <Link href="/briefs" className="text-slate-500 hover:text-slate-700 text-sm transition-colors">
          ← Briefs
        </Link>
      </div>

      {/* [1] Brief Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium mb-3 flex-wrap">
          <span className="uppercase tracking-wide">{date}</span>
          {criticalCount > 0 && (
            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">
              {criticalCount} Critical
            </span>
          )}
          {highCount > 0 && (
            <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-semibold">
              {highCount} High
            </span>
          )}
          <span className="text-slate-300">·</span>
          <span>{allSignals.length} signals analyzed</span>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 leading-tight mb-3">
          {issue.title}
        </h1>

        {/* Thesis headline as the brief's declarative identity */}
        {issue.thesis_headline && (
          <p className="text-slate-600 text-base leading-relaxed italic border-l-2 border-teal-400 pl-4">
            {issue.thesis_headline}
          </p>
        )}
      </div>

      <div className="space-y-10">

        {/* [2] Intelligence Synthesis */}
        {issue.summary && (
          <section>
            <SectionHeader label="Intelligence Synthesis" accent="bg-teal-500" />
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <p className="text-slate-700 text-base leading-relaxed">
                {issue.summary}
              </p>
            </div>
          </section>
        )}

        {/* [3] Priority Intelligence */}
        {topSignals.length > 0 && (
          <section>
            <SectionHeader label="Priority Intelligence — Requires Your Attention" accent="bg-slate-800" />
            <div className="space-y-4">
              {topSignals.map((signal, i) => (
                <PrioritySignalCard key={signal.id ?? signal.signalId ?? i} signal={signal} />
              ))}
            </div>
          </section>
        )}

        {/* [4] Cross-Domain Analysis */}
        {issue.cross_domain_analysis && (
          <section>
            <SectionHeader label="Cross-Domain Analysis" accent="bg-indigo-500" />
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              {issue.cross_domain_analysis.split("\n\n").map((para, i) => (
                <p key={i} className={`text-slate-700 text-sm leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                  {para}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* [5] Category Deep Dives */}
        {sectionOrder.map((key) => {
          const items = (sections[key] ?? []) as BriefSignal[];
          // Exclude signals already shown in Priority Intelligence
          const filtered = items.filter((s) => !topSignalTitles.has(s.title));
          if (!filtered.length) return null;

          return (
            <section key={key}>
              <SectionHeader
                label={deriveSectionLabel(key)}
                accent={deriveSectionAccent(key)}
              />
              <div className="space-y-3">
                {filtered.map((signal, i) => (
                  <CategorySignalCard key={signal.id ?? signal.signalId ?? i} signal={signal} />
                ))}
              </div>
            </section>
          );
        })}

        {/* [6] Action Summary */}
        {issue.action_summary_json && (
          <ActionSummarySection summary={issue.action_summary_json} />
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BriefDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const issue = await getIssue(session.apiKey, id);

  if (!issue) {
    notFound();
  }

  if (issue.locked) {
    return <LockedBriefState issue={issue} />;
  }

  return <BriefReader issue={issue} />;
}
