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
  COMPLIANCE_UPDATE: "Compliance",
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

/**
 * Related signals: other signals from the same category, excluding self.
 * For priority signals, the other top signals serve as related.
 */
function resolveRelated(
  sections: BriefSections,
  category: string,
  selfIndex: number
): Array<{ signal: BriefSignal; href: string; issueId: string }> {
  return [];  // populated by the caller with hrefs
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
}: {
  issue: NewsletterIssue;
  signal: BriefSignal;
  category: string;
  index: number;
  related: Array<{ signal: BriefSignal; href: string }>;
}) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const analysis = signal.whyItMatters || signal.analysis || signal.summary || "";
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">

      {/* Breadcrumb */}
      <div className="mb-10">
        <Link
          href={`/briefs/${issue.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← {issueLabel}: {issue.title}
        </Link>
      </div>

      {/* Signal header */}
      <div className="mb-8 pb-8 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-5">
          <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-300 select-none">·</span>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            {SECTION_LABELS[category] ?? "Signal Detail"}
          </span>
          <span className="text-slate-300 select-none">·</span>
          <span className="text-xs text-slate-400">{date}</span>
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

        <h1 className="text-2xl font-bold text-slate-900 leading-tight">
          {signal.title}
        </h1>
      </div>

      {/* Signal body */}
      <div className="space-y-8">

        {signal.riskRationale && (
          <section>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              Why It Matters
            </p>
            <p className="text-base text-slate-700 leading-relaxed">
              {signal.riskRationale}
            </p>
          </section>
        )}

        {analysis && (
          <section>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              Analysis
            </p>
            <p className="text-base text-slate-700 leading-relaxed">
              {analysis}
            </p>
          </section>
        )}

        {action && (
          <section>
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wide mb-3">
              Your Action
            </p>
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-6">
              <p className="text-base text-slate-700 leading-relaxed">
                {action}
              </p>
            </div>
          </section>
        )}

        {sourceHref ? (
          <section className="pt-6 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              Supporting Intelligence
            </p>
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-teal-600 hover:text-teal-700 transition-colors"
            >
              {signal.source ?? "View source"} →
            </a>
          </section>
        ) : signal.source ? (
          <section className="pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-medium">Via {signal.source}</p>
          </section>
        ) : null}

        {/* Related signals from the same section */}
        {related.length > 0 && (
          <section className="pt-8 border-t border-slate-200">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">
              Related Signals — {SECTION_LABELS[category] ?? "Same Section"}
            </p>
            <div className="space-y-3">
              {related.map((r, i) => (
                <RelatedCard key={i} signal={r.signal} href={r.href} />
              ))}
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

  if (!session.apiKey) {
    redirect("/login");
  }

  const issue = await getIssue(session.apiKey, id);

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

  if (category === "priority") {
    const topSignals = deriveTopSignals(sections);
    topSignals.forEach((s, i) => {
      if (i !== index && related.length < 3) {
        related.push({ signal: s, href: `/briefs/${id}/signal/priority/${i}` });
      }
    });
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
    />
  );
}
