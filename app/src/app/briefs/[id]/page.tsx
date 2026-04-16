import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getIssue } from "@/lib/api";
import type {
  NewsletterIssue,
  BriefSections,
  BriefSignal,
  ActionSummary,
} from "@/lib/api";
import { ScrollSpyTOC, type TocEntry } from "@/components/ScrollSpyTOC";
import { CollapsibleSignalList } from "@/components/CollapsibleSignalList";
import { PrintButton } from "@/components/PrintButton";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function riskColor(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "border-l-red-500";
  if (l === "high") return "border-l-orange-400";
  if (l === "medium") return "border-l-yellow-400";
  return "border-l-green-400";
}

function riskPillClass(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high") return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium") return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    AI_GOVERNANCE: "AI Governance",
    SECURITY_INCIDENT: "Security",
    REGULATION: "Regulatory",
    VENDOR_RISK: "Vendor Risk",
    COMPLIANCE: "Compliance",
    COMPLIANCE_UPDATE: "Compliance",
    GENERAL: "General",
  };
  return labels[category] ?? category ?? "General";
}

function deriveSectionLabel(key: string) {
  const labels: Record<string, string> = {
    aiGovernance: "AI Governance",
    securityIncidents: "Security Incidents",
    regulations: "Regulatory Changes",
    vendorRisk: "Vendor Risk",
    compliance: "Compliance",
    general: "General",
  };
  return labels[key] ?? key;
}

function deriveSectionAccent(key: string) {
  const accents: Record<string, string> = {
    aiGovernance: "bg-purple-500",
    securityIncidents: "bg-red-500",
    regulations: "bg-blue-500",
    vendorRisk: "bg-orange-400",
    compliance: "bg-cyan-500",
    general: "bg-slate-500",
  };
  return accents[key] ?? "bg-slate-400";
}

function tierLabel(tier: string): string {
  if (tier === "IMMEDIATE") return "IMMEDIATE";
  if (tier === "NEAR-TERM") return "NEAR TERM";
  if (tier === "MONITOR") return "MONITOR";
  return tier || "INTELLIGENCE";
}

function estimateReadingTime(issue: NewsletterIssue): number {
  const parts: string[] = [];

  if (issue.thesis_headline) parts.push(issue.thesis_headline);
  if (issue.summary) parts.push(issue.summary);
  if (issue.cross_domain_analysis) parts.push(issue.cross_domain_analysis);

  if (issue.action_summary_json) {
    const a = issue.action_summary_json;
    parts.push(...(a.thisWeek ?? []), ...(a.thisMonth ?? []), ...(a.monitor ?? []));
  }

  const sections = issue.sections_json ?? {};
  for (const items of Object.values(sections)) {
    if (!Array.isArray(items)) continue;
    for (const s of items as BriefSignal[]) {
      if (s.title) parts.push(s.title);
      if (s.riskRationale) parts.push(s.riskRationale);
      if (s.whyItMatters) parts.push(s.whyItMatters);
      if (s.analysis) parts.push(s.analysis);
      if (s.summary) parts.push(s.summary);
      if (s.recommendedAction) parts.push(s.recommendedAction);
      if (s.recommendation) parts.push(s.recommendation);
    }
  }

  const wordCount = parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

function derivePosture(signals: BriefSignal[]): {
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
} {
  const hasImmediate = signals.some((s) => s.priorityTier === "IMMEDIATE");
  const hasCritical = signals.some((s) => (s.riskLevel ?? "").toLowerCase() === "critical");
  const hasNearTerm = signals.some((s) => s.priorityTier === "NEAR-TERM");
  const hasHigh = signals.some((s) => (s.riskLevel ?? "").toLowerCase() === "high");

  if (hasImmediate || hasCritical) {
    return {
      label: "Act Now",
      textClass: "text-red-700",
      bgClass: "bg-red-50",
      borderClass: "border-red-200",
    };
  }

  if (hasNearTerm || hasHigh) {
    return {
      label: "Watch Closely",
      textClass: "text-orange-700",
      bgClass: "bg-orange-50",
      borderClass: "border-orange-200",
    };
  }

  return {
    label: "Monitor",
    textClass: "text-slate-600",
    bgClass: "bg-slate-100",
    borderClass: "border-slate-300",
  };
}

function deriveTopSignals(sections: BriefSections): BriefSignal[] {
  return Object.values(sections)
    .flat()
    .filter(Boolean)
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
    .slice(0, 3);
}

function buildExecutiveSummary(args: {
  issue: NewsletterIssue;
  posture: string;
  topSignals: BriefSignal[];
  domains: string[];
}): {
  summaryText: string;
  requiredActions: string[];
} {
  const { issue, posture, topSignals, domains } = args;

  const rawActions: string[] = [];
  const action = issue.action_summary_json;

  if (action?.thisWeek?.length) rawActions.push(...action.thisWeek.slice(0, 2));
  if (rawActions.length < 3 && action?.thisMonth?.length) {
    rawActions.push(...action.thisMonth.slice(0, 3 - rawActions.length));
  }
  if (!rawActions.length) {
    rawActions.push(
      ...topSignals
        .map((s) => s.recommendedAction || s.recommendation)
        .filter(Boolean)
        .slice(0, 3) as string[]
    );
  }

  // Deduplicate by exact string before rendering
  const requiredActions = [...new Set(rawActions)];

  const domainText =
    domains.length > 0 ? domains.join(", ") : "security, governance, and compliance";

  const leadSignal = topSignals[0]?.title ?? null;
  const summaryText =
    issue.summary ??
    (posture === "Act Now"
      ? `${leadSignal ? `${leadSignal} and related signals require` : "Multiple signals require"} action this week. Review the priority items below and confirm ownership of each required action.`
      : posture === "Watch Closely"
      ? `${leadSignal ? `${leadSignal} and other signals are progressing` : `Signals across ${domainText} are developing`}. No immediate action is required, but track movement through the next issue.`
      : `No escalation this week. Signals across ${domainText} are within normal range — keep them in view.`);

  return { summaryText, requiredActions };
}

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
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{label}</h2>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-0.5 h-4 ${accent} rounded-full flex-shrink-0`} />
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{label}</h2>
    </div>
  );
}

function postureColorOnDark(posture: string): string {
  if (posture === "Act Now") return "text-red-400";
  if (posture === "Watch Closely") return "text-orange-400";
  return "text-slate-400";
}

function ExecutiveSummarySection({
  issue,
  posture,
  topSignals,
  domains,
  totalSignals,
  criticalCount,
  highCount,
  immediateCount,
}: {
  issue: NewsletterIssue;
  posture: string;
  topSignals: BriefSignal[];
  domains: string[];
  totalSignals: number;
  criticalCount: number;
  highCount: number;
  immediateCount: number;
}) {
  const { summaryText, requiredActions } = buildExecutiveSummary({
    issue,
    posture,
    topSignals,
    domains,
  });

  return (
    <section id="executive-summary">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-md">
        <div className="bg-slate-900 px-7 py-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-300">
            Executive Summary
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {immediateCount > 0 && (
              <>
                <span className="text-xs font-bold text-white">{immediateCount} immediate</span>
                <span className="text-slate-600 select-none">·</span>
              </>
            )}
            {criticalCount > 0 && (
              <span className="text-xs font-bold text-red-400">{criticalCount} critical</span>
            )}
            {criticalCount > 0 && highCount > 0 && (
              <span className="text-slate-600 select-none">·</span>
            )}
            {highCount > 0 && (
              <span className="text-xs font-bold text-orange-400">{highCount} high</span>
            )}
            {(criticalCount > 0 || highCount > 0) && (
              <span className="text-slate-600 select-none">·</span>
            )}
            <span className={`text-sm font-bold uppercase tracking-wide ${postureColorOnDark(posture)}`}>
              {posture}
            </span>
          </div>
        </div>

        <div className="px-7 py-6">
          {issue.thesis_headline && (
            <p className="text-slate-900 text-xl font-bold leading-snug mb-3">
              {issue.thesis_headline}
            </p>
          )}

          <p className={`text-slate-800 leading-relaxed ${issue.thesis_headline ? "text-base" : "text-lg font-medium"}`}>
            {summaryText}
          </p>

          {topSignals.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                Priority Signals This Issue
              </p>
              <div className="divide-y divide-slate-100">
                {topSignals.map((s, i) => {
                  const risk = s.riskLevel ?? "low";
                  const tier = s.priorityTier ?? "";
                  const href = `/briefs/${issue.id}/signal/priority/${i}`;
                  return (
                    <div key={s.id ?? s.signalId ?? i} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-300 tabular-nums flex-shrink-0 w-4 text-right">
                          {i + 1}.
                        </span>
                        <Link
                          href={href}
                          className="text-sm font-medium text-slate-800 hover:text-teal-700 transition-colors line-clamp-1"
                        >
                          {s.title}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {tier === "IMMEDIATE" && (
                          <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Immediate</span>
                        )}
                        {tier === "NEAR-TERM" && (
                          <span className="text-xs font-bold text-orange-600 uppercase tracking-wide">Near Term</span>
                        )}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${riskPillClass(risk)}`}>
                          {risk}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {requiredActions.length > 0 && (
            <div className="mt-5 bg-teal-50 border border-teal-100 rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-teal-800 mb-3">
                {posture === "Act Now" ? "Required Actions" : posture === "Watch Closely" ? "Priority Actions" : "Recommended Actions"}
              </p>
              <ul className="space-y-3">
                {requiredActions.map((item, i) => (
                  <li key={`${item}-${i}`} className="flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                    <span className="text-sm text-slate-800 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

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
  const whyItMatters = signal.riskRationale || signal.whyItMatters || "";
  const analysis = signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const tier = signal.priorityTier ?? "";
  const sourceHref = signal.sourceUrl ?? signal.source_url;

  const cardBg =
    tier === "IMMEDIATE"
      ? "bg-red-50/50"
      : tier === "NEAR-TERM"
      ? "bg-orange-50/30"
      : "bg-white";

  const tierBarBg =
    tier === "IMMEDIATE"
      ? "bg-red-600"
      : tier === "NEAR-TERM"
      ? "bg-orange-500"
      : "bg-slate-800";

  // Route: /briefs/[id]/signal/[category]/[index] — category="priority", 0-based index
  const detailHref =
    issueId && typeof rank === "number" ? `/briefs/${issueId}/signal/priority/${rank - 1}` : undefined;

  return (
    <div className={`border border-slate-200 border-l-4 ${riskColor(risk)} rounded-xl overflow-hidden shadow-sm`}>
      <div className={`${tierBarBg} px-5 py-2.5 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-bold text-white uppercase tracking-widest flex-shrink-0">
            {tierLabel(tier)}
          </span>
          <span className="text-white/30 select-none flex-shrink-0">·</span>
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wide truncate">
            {categoryLabel(signal.category)}
          </span>
        </div>
        {rank !== undefined && (
          <span className="text-xs font-semibold text-white/50 uppercase tracking-widest flex-shrink-0">
            #{rank}
          </span>
        )}
      </div>

      <div className={`${cardBg} p-6`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="text-slate-900 font-bold text-base leading-snug flex-1">
            {detailHref ? (
              <Link href={detailHref} className="hover:text-teal-700 transition-colors">
                {signal.title}
              </Link>
            ) : (
              signal.title
            )}
          </h3>

          <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
            {risk}
          </span>
        </div>

        {action && (
          <div className="mb-4 bg-teal-50 rounded-lg p-4 border border-teal-100">
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wide mb-1.5">
              Action
            </p>
            <p className="text-sm text-slate-800 leading-relaxed font-medium">{action}</p>
          </div>
        )}

        {(signal.riskRationale || whyItMatters) && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Context
            </p>
            <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
              {signal.riskRationale || whyItMatters}
            </p>
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
              <span>Source</span>
              {signal.source && (
                <>
                  <span className="text-teal-300">·</span>
                  <span className="font-medium text-slate-500">{signal.source}</span>
                </>
              )}
              <span>→</span>
            </a>
          ) : signal.source ? (
            <p className="text-xs text-slate-400 font-medium">Source: {signal.source}</p>
          ) : (
            <span />
          )}

          {detailHref && (
            <Link
              href={detailHref}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Read full analysis →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionSummarySection({
  summary,
  id,
}: {
  summary: ActionSummary;
  id: string;
}) {
  const groups = [
    {
      label: "Before End of Week",
      key: "thisWeek" as const,
      color: "text-red-700",
      numColor: "text-red-400",
      bg: "bg-red-50 border-red-100",
    },
    {
      label: "Before End of Month",
      key: "thisMonth" as const,
      color: "text-orange-700",
      numColor: "text-orange-400",
      bg: "bg-orange-50 border-orange-100",
    },
    {
      label: "Monitor",
      key: "monitor" as const,
      color: "text-slate-600",
      numColor: "text-slate-400",
      bg: "bg-slate-50 border-slate-200",
    },
  ];

  const hasContent = groups.some((g) => (summary[g.key] ?? []).length > 0);
  if (!hasContent) return null;

  return (
    <section id={id}>
      <SectionHeader label="Action Roadmap" accent="bg-teal-500" tier="primary" />
      <p className="text-sm text-slate-500 mb-5 -mt-2 leading-relaxed">
        All actions from this brief, ordered by urgency.
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

function LockedBrief({ issue }: { issue: NewsletterIssue }) {
  const teaser = issue.thesis_headline ?? issue.summary;

  const lockedSections = (issue.sections_json ?? {}) as BriefSections;
  const lockedSignals = Object.values(lockedSections).flat().filter(Boolean) as BriefSignal[];
  const lockedCritical = lockedSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "critical").length;
  const lockedHigh = lockedSignals.filter((s) => (s.riskLevel ?? "").toLowerCase() === "high").length;
  const lockedDomains = Object.entries(lockedSections)
    .filter(([, items]) => Array.isArray(items) && (items as BriefSignal[]).length > 0)
    .map(([key]) => deriveSectionLabel(key));

  const severityParts: string[] = [];
  if (lockedCritical > 0) severityParts.push(`${lockedCritical} critical`);
  if (lockedHigh > 0) severityParts.push(`${lockedHigh} high`);
  const signalLine = lockedSignals.length > 0
    ? [`${lockedSignals.length} signal${lockedSignals.length !== 1 ? "s" : ""}`, ...severityParts].join(" · ")
    : null;

  const previewItems = [
    signalLine,
    lockedDomains.length > 0 ? lockedDomains.join(" · ") : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className="max-w-3xl mx-auto px-6 pb-14">
      {/* Masthead — matches unlocked brief experience */}
      <div className="-mx-6 mb-10 bg-slate-900 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-500 select-none">·</span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Intelligence Brief</span>
        </div>
        <Link
          href="/briefs"
          className="text-xs font-medium text-slate-500 hover:text-slate-200 transition-colors flex-shrink-0"
        >
          ← All Briefs
        </Link>
      </div>

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-5">
        {issue.publish_date ? formatDate(issue.publish_date) : formatDate(issue.created_at)}
      </p>

      <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-4">{issue.title}</h1>

      {teaser && (
        <div className="border-l-[3px] border-teal-400 pl-5 mb-10">
          <p className="text-slate-700 text-base font-medium leading-relaxed">{teaser}</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-slate-400">
            <path
              fillRule="evenodd"
              d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-2 text-center">
          Full access is limited to subscribers.
        </h2>

        <p className="text-slate-500 text-sm mb-7 text-center max-w-sm mx-auto leading-relaxed">
          The full brief includes complete analysis for every signal and the action roadmap for this issue.
        </p>

        <div className="bg-slate-50 rounded-lg p-5 mb-7 max-w-sm mx-auto">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
            Included in the full brief
          </p>
          <ul className="space-y-2">
            {previewItems.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="w-1 h-1 bg-teal-500 rounded-full flex-shrink-0 mt-1.5" />
                <span className="text-sm text-slate-600">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-center">
          <Link
            href="/account"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 text-white text-sm font-semibold px-4 py-2 hover:bg-slate-800 transition-colors"
          >
            Upgrade to unlock
          </Link>
        </div>
      </div>
    </div>
  );
}

function BriefReader({ issue }: { issue: NewsletterIssue }) {
  const sections = (issue.sections_json ?? {}) as BriefSections;
  const allSignals = Object.values(sections).flat().filter(Boolean) as BriefSignal[];
  const topSignals = deriveTopSignals(sections);
  const topSignalTitles = new Set(topSignals.map((s) => s.title));

  const criticalCount = allSignals.filter(
    (s) => (s.riskLevel ?? "").toLowerCase() === "critical"
  ).length;
  const highCount = allSignals.filter(
    (s) => (s.riskLevel ?? "").toLowerCase() === "high"
  ).length;
  const immediateCount = allSignals.filter(
    (s) => s.priorityTier === "IMMEDIATE"
  ).length;

  const domains = Object.entries(sections)
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([key]) => deriveSectionLabel(key));

  const readingTime = estimateReadingTime(issue);
  const posture = derivePosture(allSignals).label;

  const sectionOrder = [
    "securityIncidents",
    "aiGovernance",
    "regulations",
    "vendorRisk",
    "compliance",
  ] as const;

  const hasCategoryContent = sectionOrder.some((key) => {
    const items = (sections[key] ?? []) as BriefSignal[];
    return items.some((s) => !topSignalTitles.has(s.title));
  });

  const hasActionItems =
    !!issue.action_summary_json &&
    (issue.action_summary_json.thisWeek?.length ||
      issue.action_summary_json.thisMonth?.length ||
      issue.action_summary_json.monitor?.length);

  const tocSections: TocEntry[] = [
    ...(allSignals.length > 0 ? [{ id: "executive-summary", label: "Executive Summary" }] : []),
    ...(hasActionItems ? [{ id: "action-roadmap", label: "Action Roadmap" }] : []),
    ...(topSignals.length > 0
      ? [{ id: "priority-intelligence", label: "Priority Intelligence" }]
      : []),
    ...(issue.cross_domain_analysis
      ? [{ id: "pattern-recognition", label: "Strategic Context" }]
      : []),
    ...(hasCategoryContent
      ? [{ id: "domain-intelligence", label: "Domain Intelligence" }]
      : []),
  ];

  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  return (
    <div className="max-w-3xl mx-auto px-6 pb-12">

      {/* Publication masthead — brand presence from the first pixel */}
      <div className="-mx-6 mb-10 bg-slate-900 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-500 select-none">·</span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Intelligence Brief</span>
        </div>
        <Link
          href="/briefs"
          className="text-xs font-medium text-slate-500 hover:text-slate-200 transition-colors flex-shrink-0"
        >
          ← All Briefs
        </Link>
      </div>

      {/* Issue header */}
      <div className="mb-8 pb-8 border-b border-slate-200">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">{date}</span>
            {issue.issue_number && (
              <>
                <span className="text-slate-300 select-none">·</span>
                <span className="text-xs text-slate-400">Issue #{issue.issue_number}</span>
              </>
            )}
            <span className="text-slate-300 select-none">·</span>
            <span className="text-xs text-slate-400">~{readingTime} min read</span>
          </div>
          <PrintButton />
        </div>

        {(criticalCount > 0 || highCount > 0) && (
          <div className="flex items-center gap-2 mb-4">
            {criticalCount > 0 && (
              <span className="bg-red-100 text-red-700 border border-red-200 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide">
                {criticalCount} Critical
              </span>
            )}
            {highCount > 0 && (
              <span className="bg-orange-100 text-orange-700 border border-orange-200 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide">
                {highCount} High
              </span>
            )}
          </div>
        )}

        <h1 className="text-3xl font-bold text-slate-900 leading-tight">{issue.title}</h1>
      </div>

      <div className="mb-12">
        <ScrollSpyTOC sections={tocSections} />
      </div>

      <div className="space-y-12">
        {allSignals.length > 0 && (
          <ExecutiveSummarySection
            issue={issue}
            posture={posture}
            topSignals={topSignals}
            domains={domains}
            totalSignals={allSignals.length}
            criticalCount={criticalCount}
            highCount={highCount}
            immediateCount={immediateCount}
          />
        )}

        {issue.action_summary_json && (
          <ActionSummarySection summary={issue.action_summary_json} id="action-roadmap" />
        )}

        {topSignals.length > 0 && (
          <section id="priority-intelligence">
            <SectionHeader label="Priority Intelligence" accent="bg-slate-800" tier="primary" />
            <div className="space-y-5">
              {topSignals.map((signal, i) => (
                <PrioritySignalCard
                  key={signal.id ?? signal.signalId ?? i}
                  signal={signal}
                  rank={i + 1}
                  issueId={String(issue.id)}
                />
              ))}
            </div>
          </section>
        )}

        {issue.cross_domain_analysis && (
          <section id="pattern-recognition">
            <SectionHeader label="Strategic Context" accent="bg-teal-600" tier="primary" />
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-slate-800 px-7 py-3">
                <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                  Analyst Assessment
                </p>
              </div>
              <div className="px-7 py-6">
                {issue.cross_domain_analysis.split("\n\n").map((para, i) => (
                  <p key={i} className={`text-slate-700 text-base leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {hasCategoryContent && (
          <section id="domain-intelligence">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-1 h-6 bg-slate-400 rounded-full flex-shrink-0" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                Domain Intelligence
              </h2>
            </div>

            <p className="text-sm text-slate-500 mb-8 pl-4">
              Below-threshold signals flagged for operational tracking. Review for developing movement before the next issue.
            </p>

            <div className="space-y-10">
              {sectionOrder.map((key) => {
                const items = (sections[key] ?? []) as BriefSignal[];
                const filteredWithIdx = items
                  .map((s, idx) => ({ signal: s, idx }))
                  .filter(({ signal }) => !topSignalTitles.has(signal.title));
                if (!filteredWithIdx.length) return null;

                return (
                  <div key={key}>
                    <SectionHeader
                      label={deriveSectionLabel(key)}
                      accent={deriveSectionAccent(key)}
                      tier="secondary"
                    />
                    <CollapsibleSignalList
                      signals={filteredWithIdx.map((f) => f.signal)}
                      issueId={String(issue.id)}
                      sectionKey={key}
                      signalIndices={filteredWithIdx.map((f) => f.idx)}
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

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const issue = await getIssue(token, id);

  if (!issue) notFound();

  if (issue.locked) {
    return <LockedBrief issue={issue} />;
  }

  return <BriefReader issue={issue} />;
}
