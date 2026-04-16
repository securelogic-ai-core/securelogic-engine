import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssue } from "@/lib/api";
import type { BriefSignal, BriefSections, NewsletterIssue } from "@/lib/api";

interface Props {
  params: Promise<{ id: string; category: string; index: string }>;
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

function riskBorderClass(level: string): string {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "border-l-red-500";
  if (l === "high")     return "border-l-orange-400";
  if (l === "medium")   return "border-l-yellow-400";
  return "border-l-green-400";
}

function riskPillClass(level: string): string {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high")     return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium")   return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

const CATEGORY_LABELS: Record<string, string> = {
  AI_GOVERNANCE:     "AI Governance",
  SECURITY_INCIDENT: "Security",
  REGULATION:        "Regulatory",
  VENDOR_RISK:       "Vendor Risk",
  COMPLIANCE:        "Compliance",
  COMPLIANCE_UPDATE: "Compliance",
  GENERAL:           "General",
};

const SECTION_LABELS: Record<string, string> = {
  aiGovernance:     "AI Governance",
  securityIncidents:"Security Incidents",
  regulations:      "Regulatory Changes",
  vendorRisk:       "Vendor Risk",
  compliance:       "Compliance",
  priority:         "Priority Intelligence",
};

function deriveTopSignals(sections: BriefSections): BriefSignal[] {
  const all: BriefSignal[] = Object.values(sections)
    .flat()
    .filter((s): s is BriefSignal => !!s && typeof s === "object");

  return all
    .sort((a, b) => {
      const scoreDiff = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const rankMap: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (rankMap[(b.riskLevel ?? "low").toLowerCase()] ?? 1) -
        (rankMap[(a.riskLevel ?? "low").toLowerCase()] ?? 1)
      );
    })
    .slice(0, 3);
}

/**
 * Resolve a signal from the issue by category key + index.
 * category="priority" → top-3 sorted signals
 * category=section key → raw sections_json[category][index]
 */
function resolveSignal(
  sections: BriefSections,
  category: string,
  index: number
): BriefSignal | null {
  if (category === "priority") {
    return deriveTopSignals(sections)[index] ?? null;
  }
  const key = category as keyof BriefSections;
  const arr = sections[key];
  if (!Array.isArray(arr)) return null;
  return arr[index] ?? null;
}

// ---------------------------------------------------------------------------
// Related signal compact card
// ---------------------------------------------------------------------------

function RelatedCard({
  signal,
  href,
}: {
  signal: BriefSignal;
  href: string;
}) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  return (
    <Link
      href={href}
      className={`block border border-slate-200 border-l-4 ${riskBorderClass(risk)} rounded-lg p-4 bg-white hover:shadow-sm transition-all group`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h4 className="text-slate-900 font-semibold text-sm leading-snug flex-1 group-hover:text-teal-700 transition-colors">
          {signal.title}
        </h4>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
          {risk}
        </span>
      </div>
      {(signal.whyItMatters || signal.analysis || signal.summary) && (
        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
          {signal.whyItMatters || signal.analysis || signal.summary}
        </p>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Signal Detail View
// ---------------------------------------------------------------------------

function SignalDetail({
  issue,
  signal,
  category,
  index,
  related,
  prevHref,
  nextHref,
}: {
  issue: NewsletterIssue;
  signal: BriefSignal;
  category: string;
  index: number;
  related: Array<{ signal: BriefSignal; href: string }>;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const whyItMattersText = signal.whyItMatters || "";
  const analysisText = signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const sourceHref = signal.sourceUrl ?? signal.source_url;
  const tier = signal.priorityTier ?? "";

  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const issueLabel = issue.issue_number ? `Issue #${issue.issue_number}` : "Intelligence Brief";

  const tierBarBg =
    tier === "IMMEDIATE" ? "bg-red-600" :
    tier === "NEAR-TERM" ? "bg-orange-500" :
    "bg-slate-700";

  // Issue-level context — posture, severity counts, active domains
  const issueSections = (issue.sections_json ?? {}) as BriefSections;
  const allIssueSignals = Object.values(issueSections)
    .flat()
    .filter((s): s is BriefSignal => !!s && typeof s === "object");
  const issueCriticalCount = allIssueSignals.filter(
    (s) => (s.riskLevel ?? "").toLowerCase() === "critical"
  ).length;
  const issueHighCount = allIssueSignals.filter(
    (s) => (s.riskLevel ?? "").toLowerCase() === "high"
  ).length;
  const issueHasImmediate =
    allIssueSignals.some((s) => s.priorityTier === "IMMEDIATE") || issueCriticalCount > 0;
  const issuePosture = issueHasImmediate
    ? "Act Now"
    : allIssueSignals.some((s) => s.priorityTier === "NEAR-TERM") || issueHighCount > 0
    ? "Watch Closely"
    : "Monitor";
  const issuePostureColor =
    issuePosture === "Act Now"
      ? "text-red-600"
      : issuePosture === "Watch Closely"
      ? "text-orange-600"
      : "text-slate-500";
  const issueDomains = Object.entries(issueSections)
    .filter(([, items]) => Array.isArray(items) && (items as BriefSignal[]).length > 0)
    .map(([key]) => SECTION_LABELS[key] ?? key)
    .filter((l) => l !== "Priority Intelligence");

  // Tier-relevant action items from the issue action roadmap
  const actionJson = issue.action_summary_json;
  const tierActions: string[] =
    actionJson
      ? tier === "IMMEDIATE"
        ? actionJson.thisWeek ?? []
        : tier === "NEAR-TERM"
        ? actionJson.thisMonth ?? []
        : actionJson.monitor ?? []
      : [];
  const tierActionsLabel =
    tier === "IMMEDIATE"
      ? "Act This Week"
      : tier === "NEAR-TERM"
      ? "Address This Month"
      : "Monitor";

  // Signal position label
  const signalPositionLabel =
    category === "priority"
      ? `Priority #${index + 1} of ${allIssueSignals.length} signals in this issue`
      : `${SECTION_LABELS[category] ?? "Domain"} · ${allIssueSignals.length} total signals this issue`;

  return (
    <div className="max-w-3xl mx-auto px-6 pb-12">

      {/* Brand masthead */}
      <div className="-mx-6 mb-10 bg-slate-900 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-500 select-none">·</span>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Intelligence Brief</span>
        </div>
        <span className="text-xs font-medium text-slate-500 flex-shrink-0">
          {issueLabel} · {date}
        </span>
      </div>

      {/* Breadcrumb */}
      <div className="mb-8">
        <Link
          href={`/briefs/${issue.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← {issue.title}
        </Link>
      </div>

      {/* Issue context panel — situates the signal within the publication */}
      <div className="mb-8 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">From this brief</p>
            <p className="text-sm font-semibold text-slate-800 truncate">{issue.title}</p>
          </div>
          <Link
            href={`/briefs/${issue.id}`}
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors flex-shrink-0"
          >
            Read the brief →
          </Link>
        </div>
        <div className="px-5 py-4 space-y-3">
          {(issue.thesis_headline || issue.summary) && (
            <p className="text-sm text-slate-700 leading-relaxed">
              {issue.thesis_headline || issue.summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="text-slate-500 font-medium">
              {allIssueSignals.length} signal{allIssueSignals.length !== 1 ? "s" : ""} this issue
            </span>
            {issueCriticalCount > 0 && (
              <>
                <span className="text-slate-300 select-none">·</span>
                <span className="text-red-600 font-semibold">{issueCriticalCount} critical</span>
              </>
            )}
            {issueHighCount > 0 && (
              <>
                <span className="text-slate-300 select-none">·</span>
                <span className="text-orange-600 font-semibold">{issueHighCount} high</span>
              </>
            )}
            <span className="text-slate-300 select-none">·</span>
            <span className={`font-bold uppercase ${issuePostureColor}`}>{issuePosture}</span>
          </div>
          {issueDomains.length > 0 && (
            <p className="text-xs text-slate-400">{issueDomains.join(" · ")}</p>
          )}
          <p className="text-xs text-slate-400 font-medium pt-0.5 border-t border-slate-200">
            {signalPositionLabel}
          </p>
        </div>
      </div>

      {/* Signal header */}
      <div className="mb-8 pb-8 border-b border-slate-200">
        <div className="mb-5 flex items-center gap-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            {SECTION_LABELS[category] ?? "Signal Detail"}
          </p>
          {category === "priority" && (
            <>
              <span className="text-slate-300 select-none">·</span>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>
                #{index + 1} Priority
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 mb-5 flex-wrap">
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wide ${riskPillClass(risk)}`}>
            {risk}
          </span>
          {signal.category && (
            <span className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded">
              {CATEGORY_LABELS[signal.category] ?? signal.category}
            </span>
          )}
          {tier && (
            <span className={`text-xs font-bold text-white px-3 py-1.5 rounded uppercase tracking-wide ${tierBarBg}`}>
              {tier}
            </span>
          )}
        </div>

        <h1 className="text-2xl font-bold leading-tight" style={{ color: '#f1f5f9', fontWeight: '700' }}>
          {signal.title}
        </h1>

        {(signal.priorityScore !== undefined && signal.priorityScore > 0) && (
          <div className="mt-4 flex items-center gap-1.5 text-xs font-medium" style={{ color: '#94a3b8' }}>
            <span>Signal priority score</span>
            <span className="select-none">·</span>
            <span className="font-bold tabular-nums" style={{ color: '#94a3b8' }}>{signal.priorityScore}</span>
          </div>
        )}
      </div>

      {/* Signal body */}
      <div className="space-y-8">

        {signal.riskRationale && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#94a3b8' }}>
              What Happened
            </p>
            <p className="text-base leading-relaxed" style={{ color: '#cbd5e1' }}>
              {signal.riskRationale}
            </p>
          </section>
        )}

        {action && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#00c4b4' }}>
              Decision Guidance
            </p>
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-6">
              <p className="text-base leading-relaxed" style={{ color: '#374151' }}>
                {action}
              </p>
            </div>
            {tierActions.length > 0 && (
              <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden" style={{ backgroundColor: '#ffffff' }}>
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#94a3b8' }}>
                    {tierActionsLabel} — From This Issue
                  </p>
                  <Link
                    href={`/briefs/${issue.id}#action-roadmap`}
                    className="text-xs font-semibold hover:text-teal-300 transition-colors flex-shrink-0"
                    style={{ color: '#00c4b4' }}
                  >
                    Full roadmap →
                  </Link>
                </div>
                <ol className="divide-y divide-slate-100">
                  {tierActions.slice(0, 3).map((item, i) => (
                    <li key={i} className="px-5 py-3 flex items-start gap-3">
                      <span className="text-xs font-bold tabular-nums flex-shrink-0 mt-0.5 w-5 text-right" style={{ color: '#94a3b8' }}>
                        {String(i + 1).padStart(2, "0")}.
                      </span>
                      <span className="text-sm leading-snug" style={{ color: '#374151' }}>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}

        {whyItMattersText && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#94a3b8' }}>
              Organizational Exposure
            </p>
            <p className="text-base leading-relaxed" style={{ color: '#cbd5e1' }}>
              {whyItMattersText}
            </p>
          </section>
        )}

        {analysisText && (
          <section>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#94a3b8' }}>
              Analyst Notes
            </p>
            <p className="text-base leading-relaxed" style={{ color: '#cbd5e1' }}>
              {analysisText}
            </p>
          </section>
        )}

        {issue.cross_domain_analysis && (
          <section className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-800 px-6 py-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">Issue Analysis</p>
              <Link
                href={`/briefs/${issue.id}#pattern-recognition`}
                className="text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
              >
                Back to brief →
              </Link>
            </div>
            <div className="px-6 py-5 bg-white">
              {issue.cross_domain_analysis.split("\n\n").map((para, i) => (
                <p key={i} className={`text-sm text-slate-700 leading-relaxed ${i > 0 ? "mt-4" : ""}`}>
                  {para}
                </p>
              ))}
            </div>
          </section>
        )}

        {sourceHref ? (
          <section className="pt-6 border-t border-slate-700">
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#94a3b8' }}>
              Primary Source
            </p>
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold hover:text-teal-300 transition-colors"
              style={{ color: '#00c4b4' }}
            >
              {signal.source ?? "View source"} →
            </a>
          </section>
        ) : signal.source ? (
          <section className="pt-6 border-t border-slate-700">
            <p className="text-xs font-medium" style={{ color: '#94a3b8' }}>Via {signal.source}</p>
          </section>
        ) : null}

        {/* Related signals from the same section */}
        {related.length > 0 && (
          <section className="pt-8 border-t border-slate-700">
            <p className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: '#94a3b8' }}>
              Related Signals — {SECTION_LABELS[category] ?? "Same Section"}
            </p>
            <div className="space-y-3">
              {related.map((r, i) => (
                <RelatedCard key={i} signal={r.signal} href={r.href} />
              ))}
            </div>
          </section>
        )}

        {/* Prev / next navigation for priority signals */}
        {(prevHref || nextHref) && (
          <section className="pt-8 border-t border-slate-700">
            <div className="flex items-center justify-between gap-4">
              {prevHref ? (
                <Link
                  href={prevHref}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-teal-300 transition-colors"
                  style={{ color: '#94a3b8' }}
                >
                  ← Previous signal
                </Link>
              ) : <span />}
              <Link
                href={`/briefs/${issue.id}`}
                className="text-xs font-semibold hover:text-slate-200 transition-colors"
                style={{ color: '#94a3b8' }}
              >
                Back to brief
              </Link>
              {nextHref ? (
                <Link
                  href={nextHref}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-teal-300 transition-colors"
                  style={{ color: '#94a3b8' }}
                >
                  Next signal →
                </Link>
              ) : <span />}
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

export default async function SignalDetailPage({ params }: Props) {
  const { id, category, index: indexStr } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const issue = await getIssue(token, id);

  if (!issue || issue.locked) {
    notFound();
  }

  const sections = issue.sections_json ?? {} as BriefSections;
  const index = parseInt(indexStr, 10);

  if (!Number.isFinite(index) || index < 0) {
    notFound();
  }

  const signal = resolveSignal(sections, category, index);

  if (!signal) {
    notFound();
  }

  // Build related signals: others from the same category, excluding self, up to 3
  const related: Array<{ signal: BriefSignal; href: string }> = [];
  let prevHref: string | null = null;
  let nextHref: string | null = null;

  if (category === "priority") {
    const topSignals = deriveTopSignals(sections);
    topSignals.forEach((s, i) => {
      if (i !== index && related.length < 3) {
        related.push({ signal: s, href: `/briefs/${id}/signal/priority/${i}` });
      }
    });
    if (index > 0) prevHref = `/briefs/${id}/signal/priority/${index - 1}`;
    if (index < topSignals.length - 1) nextHref = `/briefs/${id}/signal/priority/${index + 1}`;
  } else {
    const key = category as keyof BriefSections;
    const arr = sections[key];
    if (Array.isArray(arr)) {
      arr.forEach((s, i) => {
        if (i !== index && related.length < 3) {
          related.push({ signal: s, href: `/briefs/${id}/signal/${category}/${i}` });
        }
      });
    }
  }

  return (
    <SignalDetail
      issue={issue}
      signal={signal}
      category={category}
      index={index}
      related={related}
      prevHref={prevHref}
      nextHref={nextHref}
    />
  );
}
