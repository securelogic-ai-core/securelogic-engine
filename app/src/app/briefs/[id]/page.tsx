import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssue } from "@/lib/api";
import { CollapsibleSignalList } from "@/components/CollapsibleSignalList";
import { PrintButton } from "@/components/PrintButton";
import { ScrollSpyTOC } from "@/components/ScrollSpyTOC";
import type { TocEntry } from "@/components/ScrollSpyTOC";
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
  if (l === "high")     return "border-l-orange-400";
  if (l === "medium")   return "border-l-yellow-400";
  return "border-l-green-400";
}

function riskPillClass(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high")     return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium")   return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
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
    aiGovernance:      "AI Governance",
    securityIncidents: "Security Incidents",
    regulations:       "Regulatory Changes",
    vendorRisk:        "Vendor Risk",
    compliance:        "Compliance",
  };
  return labels[key] ?? key;
}

function deriveSectionAccent(key: string): string {
  const accents: Record<string, string> = {
    aiGovernance:     "bg-purple-500",
    securityIncidents:"bg-red-500",
    regulations:      "bg-blue-500",
    vendorRisk:       "bg-orange-400",
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

/**
 * Derive which risk domains have content in sections_json.
 */
function deriveDomainCoverage(sections: BriefSections): string[] {
  const labels: Record<string, string> = {
    aiGovernance:      "AI Governance",
    securityIncidents: "Security",
    regulations:       "Regulatory",
    vendorRisk:        "Vendor Risk",
    compliance:        "Compliance",
  };
  return (Object.keys(sections) as Array<keyof BriefSections>)
    .filter((key) => (sections[key]?.length ?? 0) > 0)
    .map((key) => labels[key] ?? key);
}

/**
 * Estimate reading time in minutes from all prose fields in the issue.
 * Uses 200 wpm. Minimum 1 minute. Computed server-side.
 */
function estimateReadingTime(issue: NewsletterIssue, allSignals: BriefSignal[]): number {
  const chunks: string[] = [];

  if (issue.thesis_headline) chunks.push(issue.thesis_headline);
  if (issue.summary)         chunks.push(issue.summary);
  if (issue.cross_domain_analysis) chunks.push(issue.cross_domain_analysis);

  if (issue.action_summary_json) {
    const { thisWeek = [], thisMonth = [], monitor = [] } = issue.action_summary_json;
    chunks.push(...thisWeek, ...thisMonth, ...monitor);
  }

  for (const signal of allSignals) {
    if (signal.title)             chunks.push(signal.title);
    if (signal.riskRationale)     chunks.push(signal.riskRationale);
    if (signal.whyItMatters)      chunks.push(signal.whyItMatters);
    if (signal.analysis)          chunks.push(signal.analysis);
    if (signal.summary)           chunks.push(signal.summary);
    if (signal.recommendedAction) chunks.push(signal.recommendedAction);
    if (signal.recommendation)    chunks.push(signal.recommendation);
  }

  const wordCount = chunks.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

// ---------------------------------------------------------------------------
// Risk Snapshot — at-a-glance severity and coverage band
// ---------------------------------------------------------------------------

function RiskSnapshot({
  allSignals,
  domains,
}: {
  allSignals: BriefSignal[];
  domains: string[];
}) {
  const critical = allSignals.filter(
    (s) => (s.riskLevel ?? s.risk_level ?? "").toLowerCase() === "critical"
  ).length;
  const high = allSignals.filter(
    (s) => (s.riskLevel ?? s.risk_level ?? "").toLowerCase() === "high"
  ).length;
  const medium = allSignals.filter(
    (s) => (s.riskLevel ?? s.risk_level ?? "").toLowerCase() === "medium"
  ).length;
  const hasImmediate = allSignals.some((s) => s.priorityTier === "IMMEDIATE");
  const hasNearTerm  = allSignals.some((s) => s.priorityTier === "NEAR-TERM");
  const showUrgency  = hasImmediate || hasNearTerm;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-6 py-5 flex flex-wrap items-center gap-x-7 gap-y-4">
      {allSignals.length > 0 && (
        <>
          <div className="text-center min-w-[44px]">
            <p className="text-xl font-bold text-slate-800 leading-none">{allSignals.length}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-1">Signals</p>
          </div>
          <div className="w-px h-8 bg-slate-200 hidden sm:block flex-shrink-0" />
        </>
      )}
      {(critical > 0 || high > 0 || medium > 0) && (
        <>
          <div className="flex items-center gap-5">
            {critical > 0 && (
              <div className="text-center">
                <p className="text-xl font-bold text-red-600 leading-none">{critical}</p>
                <p className="text-[10px] text-red-400 uppercase tracking-widest font-semibold mt-1">Critical</p>
              </div>
            )}
            {high > 0 && (
              <div className="text-center">
                <p className="text-xl font-bold text-orange-500 leading-none">{high}</p>
                <p className="text-[10px] text-orange-400 uppercase tracking-widest font-semibold mt-1">High</p>
              </div>
            )}
            {medium > 0 && (
              <div className="text-center">
                <p className="text-xl font-bold text-yellow-500 leading-none">{medium}</p>
                <p className="text-[10px] text-yellow-500 uppercase tracking-widest font-semibold mt-1">Medium</p>
              </div>
            )}
          </div>
          {(showUrgency || domains.length > 0) && (
            <div className="w-px h-8 bg-slate-200 hidden sm:block flex-shrink-0" />
          )}
        </>
      )}
      {showUrgency && (
        <>
          {hasImmediate ? (
            <span className="text-[11px] font-bold bg-red-600 text-white px-3 py-1.5 rounded uppercase tracking-wide">
              Immediate Action Required
            </span>
          ) : (
            <span className="text-[11px] font-bold bg-orange-500 text-white px-3 py-1.5 rounded uppercase tracking-wide">
              Near-Term Action Required
            </span>
          )}
          {domains.length > 0 && (
            <div className="w-px h-8 bg-slate-200 hidden sm:block flex-shrink-0" />
          )}
        </>
      )}
      {domains.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Coverage</span>
          {domains.map((domain) => (
            <span
              key={domain}
              className="text-[11px] text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded font-medium"
            >
              {domain}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header — two-tier system
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  accent,
  tier = "secondary",
}: {
  label: string;
  accent: string;
  tier?: "primary" | "secondary";
}) {
  if (tier === "primary") {
    return (
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-1 h-6 ${accent} rounded-full flex-shrink-0`} />
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          {label}
        </h2>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-0.5 h-4 ${accent} rounded-full flex-shrink-0`} />
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
        {label}
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Priority signal card — top 3, full detail, with link to signal detail page
// ---------------------------------------------------------------------------

function PrioritySignalCard({
  signal,
  rank,
  issueId,
}: {
  signal: BriefSignal;
  rank?: number;
  issueId?: string;
}) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const analysis = signal.whyItMatters || signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const tier = signal.priorityTier ?? "";
  const sourceHref = signal.sourceUrl ?? signal.source_url;

  const cardBg =
    tier === "IMMEDIATE" ? "bg-red-50/50" :
    tier === "NEAR-TERM" ? "bg-orange-50/30" :
    "bg-white";

  const tierBarBg =
    tier === "IMMEDIATE" ? "bg-red-600" :
    tier === "NEAR-TERM" ? "bg-orange-500" :
    "bg-slate-700";

  // Signal detail href — rank is 1-based, index is 0-based
  const detailHref =
    issueId && rank !== undefined
      ? `/briefs/${issueId}/signal/priority/${rank - 1}`
      : undefined;

  return (
    <div className={`border border-slate-200 border-l-4 ${riskColor(risk)} rounded-xl overflow-hidden shadow-sm`}>
      <div className={`${tierBarBg} px-5 py-2 flex items-center justify-between`}>
        <span className="text-xs font-bold text-white uppercase tracking-widest">
          {tier || "Intelligence"}
        </span>
        {rank !== undefined && (
          <span className="text-xs font-semibold text-white/60 uppercase tracking-widest">
            #{rank} Priority
          </span>
        )}
      </div>

      <div className={`${cardBg} p-6`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-slate-900 font-bold text-base leading-snug flex-1">
            {detailHref ? (
              <Link href={detailHref} className="hover:text-teal-700 transition-colors">
                {signal.title}
              </Link>
            ) : signal.title}
          </h3>
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
            {risk}
          </span>
        </div>

        <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-5">
          {categoryLabel(signal.category)}
        </p>

        {signal.riskRationale && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Why It Matters
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">{signal.riskRationale}</p>
          </div>
        )}

        {analysis && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Analysis
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">{analysis}</p>
          </div>
        )}

        {action && (
          <div className="mb-4 bg-teal-50 rounded-lg p-4 border border-teal-100">
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wide mb-1.5">
              Your Action
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">{action}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          {sourceHref ? (
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors"
            >
              <span>Supporting Intelligence</span>
              {signal.source && (
                <>
                  <span className="text-teal-300">·</span>
                  <span className="font-medium text-slate-500">{signal.source}</span>
                </>
              )}
              <span>→</span>
            </a>
          ) : signal.source ? (
            <p className="text-xs text-slate-400 font-medium">Via {signal.source}</p>
          ) : <span />}

          {detailHref && (
            <Link
              href={detailHref}
              className="text-xs font-semibold text-slate-400 hover:text-teal-600 transition-colors"
            >
              Full detail →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Roadmap — numbered, urgency-tiered columns
// ---------------------------------------------------------------------------

function ActionSummarySection({ summary, id }: { summary: ActionSummary; id?: string }) {
  const groups = [
    { label: "Before End of Week",  key: "thisWeek"  as const, color: "text-red-700",    numColor: "text-red-400",    bg: "bg-red-50 border-red-100" },
    { label: "Before End of Month", key: "thisMonth" as const, color: "text-orange-700", numColor: "text-orange-400", bg: "bg-orange-50 border-orange-100" },
    { label: "Ongoing Monitoring",  key: "monitor"   as const, color: "text-slate-600",  numColor: "text-slate-400",  bg: "bg-slate-50 border-slate-200" },
  ];

  const hasContent = groups.some((g) => (summary[g.key] ?? []).length > 0);
  if (!hasContent) return null;

  return (
    <section id={id}>
      <SectionHeader label="Action Roadmap" accent="bg-teal-500" tier="primary" />
      <p className="text-sm text-slate-500 mb-5 -mt-2 leading-relaxed">
        Actions derived from this week's highest-priority signals, staged by urgency and organizational impact.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {groups.map(({ label, key, color, numColor, bg }) => {
          const items = summary[key] ?? [];
          if (!items.length) return null;
          return (
            <div key={key} className={`border rounded-xl p-5 ${bg}`}>
              <p className={`text-xs font-bold uppercase tracking-wide mb-4 ${color}`}>{label}</p>
              <ol className="space-y-3">
                {items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className={`text-xs font-bold ${numColor} flex-shrink-0 w-5 text-right leading-5 mt-0.5 tabular-nums`}>
                      {String(i + 1).padStart(2, "0")}.
                    </span>
                    <span className="text-sm text-slate-700 leading-snug">{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Locked brief state
// ---------------------------------------------------------------------------

function LockedBriefState({ issue }: { issue: NewsletterIssue }) {
  const teaser = issue.thesis_headline ?? issue.summary;
  const date = issue.publish_date ? formatDate(issue.publish_date) : formatDate(issue.created_at);

  return (
    <div className="max-w-3xl mx-auto px-6 py-14">
      <div className="mb-8">
        <Link href="/briefs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors">
          ← All Briefs
        </Link>
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-5">{date}</p>
      <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-4">{issue.title}</h1>
      {teaser && (
        <div className="border-l-[3px] border-teal-400 pl-5 mb-10">
          <p className="text-slate-700 text-base font-medium leading-relaxed">{teaser}</p>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-slate-400">
            <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2 text-center">Full brief requires a subscription</h2>
        <p className="text-slate-500 text-sm mb-7 text-center max-w-sm mx-auto leading-relaxed">
          Subscribers get the full analysis — signal-by-signal breakdown, risk scoring rationale,
          staged action roadmaps, and the weekly cross-domain pattern synthesis.
        </p>
        <div className="bg-slate-50 rounded-lg p-5 mb-7 max-w-sm mx-auto">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">In this brief</p>
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
            <button type="submit" className="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
              Professional — $39/mo
            </button>
          </form>
          <form action="/api/billing/checkout" method="POST">
            <input type="hidden" name="tier" value="team" />
            <button type="submit" className="border border-slate-300 text-slate-700 hover:border-slate-400 font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
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
// Full brief reader — primarily server-rendered
// Client islands: ScrollSpyTOC, CollapsibleSignalList, PrintButton
// ---------------------------------------------------------------------------

function BriefReader({ issue }: { issue: NewsletterIssue }) {
  const sections = issue.sections_json ?? {} as BriefSections;
  const topSignals = deriveTopSignals(sections);
  const topSignalTitles = new Set(topSignals.map((s) => s.title));

  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const allSignals = Object.values(sections).flat().filter(Boolean) as BriefSignal[];
  const criticalCount = allSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "critical").length;
  const highCount     = allSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "high").length;
  const domains       = deriveDomainCoverage(sections);
  const readingTime   = estimateReadingTime(issue, allSignals);

  const sectionOrder = ["securityIncidents", "aiGovernance", "regulations", "vendorRisk", "compliance"] as const;

  const hasCategoryContent = sectionOrder.some((key) => {
    const items = (sections[key] ?? []) as BriefSignal[];
    return items.some((s) => !topSignalTitles.has(s.title));
  });

  const hasActionItems = issue.action_summary_json != null && (
    (issue.action_summary_json.thisWeek?.length  ?? 0) > 0 ||
    (issue.action_summary_json.thisMonth?.length ?? 0) > 0 ||
    (issue.action_summary_json.monitor?.length   ?? 0) > 0
  );

  const tocSections: TocEntry[] = [
    ...((issue.thesis_headline || issue.summary)
      ? [{ id: "intelligence-thesis",   label: "Intelligence Thesis" }]   : []),
    ...(hasActionItems
      ? [{ id: "action-roadmap",         label: "Action Roadmap" }]        : []),
    ...(topSignals.length > 0
      ? [{ id: "priority-intelligence",  label: "Priority Intelligence" }] : []),
    ...(issue.cross_domain_analysis
      ? [{ id: "pattern-recognition",    label: "Pattern Recognition" }]   : []),
    ...(hasCategoryContent
      ? [{ id: "domain-intelligence",    label: "Domain Intelligence" }]   : []),
  ];

  const issueLabel = issue.issue_number ? `Issue #${issue.issue_number}` : null;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">

      {/* Breadcrumb */}
      <div className="mb-10">
        <Link
          href="/briefs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← All Briefs
        </Link>
      </div>

      {/* [1] Header */}
      <div className="mb-8 pb-8 border-b border-slate-200">
        <div className="flex items-start justify-between gap-4 mb-6">
          {/* Publication eyebrow */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
            <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">SecureLogic AI</span>
            <span className="text-slate-300 select-none">·</span>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Intelligence Brief</span>
            {issueLabel && (
              <>
                <span className="text-slate-300 select-none">·</span>
                <span className="text-xs font-semibold text-slate-500">{issueLabel}</span>
              </>
            )}
            <span className="text-slate-300 select-none">·</span>
            <span className="text-xs text-slate-400">{date}</span>
            <span className="text-slate-300 select-none">·</span>
            <span className="text-xs text-slate-400">~{readingTime} min read</span>
          </div>
          {/* Print button — client component, hidden from print output */}
          <PrintButton />
        </div>

        {(criticalCount > 0 || highCount > 0) && (
          <div className="flex items-center gap-2.5 mb-5">
            {criticalCount > 0 && (
              <span className="bg-red-600 text-white px-3.5 py-1.5 rounded text-sm font-bold uppercase tracking-wide">
                {criticalCount} Critical
              </span>
            )}
            {highCount > 0 && (
              <span className="bg-orange-500 text-white px-3.5 py-1.5 rounded text-sm font-bold uppercase tracking-wide">
                {highCount} High
              </span>
            )}
          </div>
        )}

        <h1 className="text-3xl font-bold text-slate-900 leading-tight">
          {issue.title}
        </h1>
      </div>

      {/* [2] Risk Snapshot */}
      {allSignals.length > 0 && (
        <div className="mb-8">
          <RiskSnapshot allSignals={allSignals} domains={domains} />
        </div>
      )}

      {/* [3] Sticky scrollspy TOC — client component */}
      <div className="mb-12">
        <ScrollSpyTOC sections={tocSections} />
      </div>

      <div className="space-y-12">

        {/* [4] Intelligence Thesis */}
        {(issue.thesis_headline || issue.summary) && (
          <section id="intelligence-thesis">
            <SectionHeader label="Intelligence Thesis" accent="bg-teal-500" tier="primary" />
            <div className="bg-white border border-slate-200 border-l-4 border-l-teal-500 rounded-xl overflow-hidden shadow-sm">
              {issue.thesis_headline && (
                <div className="bg-teal-50 border-b border-teal-100 px-7 py-5">
                  <p className="text-teal-900 font-bold text-lg leading-snug">{issue.thesis_headline}</p>
                </div>
              )}
              {issue.summary && (
                <div className="px-7 py-6">
                  <p className="text-slate-700 text-base leading-loose">{issue.summary}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* [5] Action Roadmap */}
        {issue.action_summary_json && (
          <ActionSummarySection summary={issue.action_summary_json} id="action-roadmap" />
        )}

        {/* [6] Priority Intelligence — ranked, linked to detail pages */}
        {topSignals.length > 0 && (
          <section id="priority-intelligence">
            <SectionHeader label="Priority Intelligence — Requires Your Attention" accent="bg-slate-800" tier="primary" />
            <div className="space-y-5">
              {topSignals.map((signal, i) => (
                <PrioritySignalCard
                  key={signal.id ?? signal.signalId ?? i}
                  signal={signal}
                  rank={i + 1}
                  issueId={issue.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* [7] Pattern Recognition */}
        {issue.cross_domain_analysis && (
          <section id="pattern-recognition">
            <SectionHeader label="Pattern Recognition" accent="bg-teal-600" tier="primary" />
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-100 px-7 py-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                  Cross-Domain Analysis
                </p>
              </div>
              <div className="px-7 py-6">
                {issue.cross_domain_analysis.split("\n\n").map((para, i) => (
                  <p key={i} className={`text-slate-700 text-sm leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* [8] Domain Intelligence — collapsible, expandable on print */}
        {hasCategoryContent && (
          <section id="domain-intelligence">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-1 h-6 bg-slate-300 rounded-full flex-shrink-0" />
              <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">
                Domain Intelligence
              </h2>
            </div>
            <p className="text-sm text-slate-400 italic mb-8 pl-4">
              Supporting signals by domain. These inform your monitoring posture and do not require
              immediate executive action. Source documentation is linked where available.
            </p>
            <div className="space-y-10">
              {sectionOrder.map((key) => {
                const items = (sections[key] ?? []) as BriefSignal[];
                // Keep original indices for signal detail page routing
                const filteredWithIndex = items
                  .map((signal, originalIndex) => ({ signal, originalIndex }))
                  .filter(({ signal }) => !topSignalTitles.has(signal.title));

                if (!filteredWithIndex.length) return null;

                const filteredSignals = filteredWithIndex.map(({ signal }) => signal);
                const signalHrefs = filteredWithIndex.map(
                  ({ originalIndex }) => `/briefs/${issue.id}/signal/${key}/${originalIndex}`
                );

                return (
                  <div key={key}>
                    <SectionHeader
                      label={deriveSectionLabel(key)}
                      accent={deriveSectionAccent(key)}
                      tier="secondary"
                    />
                    <CollapsibleSignalList
                      signals={filteredSignals}
                      signalHrefs={signalHrefs}
                    />
                  </div>
                );
              })}
            </div>
          </section>
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
