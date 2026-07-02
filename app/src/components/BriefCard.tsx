import Link from "next/link";
import type { NewsletterIssue, BriefSignal, BriefSections } from "@/lib/api";

interface BriefCardProps {
  issue: NewsletterIssue;
}

function parseRiskCounts(sectionsJson: BriefSections | null): {
  critical: number;
  high: number;
  signalCount: number;
  domains: string[];
} {
  if (!sectionsJson || typeof sectionsJson !== "object") {
    return { critical: 0, high: 0, signalCount: 0, domains: [] };
  }

  let critical = 0;
  let high = 0;
  let signalCount = 0;

  const domainLabels: Record<string, string> = {
    aiGovernance:      "AI Governance",
    securityIncidents: "Security",
    regulations:       "Regulatory",
    vendorRisk:        "Vendor Risk",
    compliance:        "Compliance",
  };

  const domains: string[] = [];

  for (const [key, items] of Object.entries(sectionsJson)) {
    if (!Array.isArray(items) || items.length === 0) continue;
    if (domainLabels[key]) domains.push(domainLabels[key]);
    for (const item of items as BriefSignal[]) {
      signalCount++;
      const level = (item.riskLevel ?? item.risk_level ?? "").toLowerCase();
      if (level === "critical") critical++;
      else if (level === "high") high++;
    }
  }

  return { critical, high, signalCount, domains };
}

function riskLevelColor(level: string) {
  const l = level.toLowerCase();
  if (l === "critical") return "bg-red-900/40 text-red-300";
  if (l === "high") return "bg-orange-900/40 text-orange-300";
  if (l === "medium") return "bg-yellow-900/40 text-yellow-300";
  return "bg-green-900/40 text-green-300";
}

function cardBorderAccent(critical: number, high: number): string {
  if (critical > 0) return "border-l-red-500";
  if (high > 0) return "border-l-orange-400";
  return "border-l-brand-teal";
}

function RiskBadges({ critical, high }: { critical: number; high: number }) {
  if (critical === 0 && high === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {critical > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-900/40 text-red-300 border border-red-800/50 uppercase tracking-wide">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" />
          {critical} Critical
        </span>
      )}
      {high > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-orange-900/40 text-orange-300 border border-orange-800/50 uppercase tracking-wide">
          <span className="w-1.5 h-1.5 bg-orange-500 rounded-full inline-block" />
          {high} High
        </span>
      )}
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Locked card — value-demonstrating teaser for free plan users
// ---------------------------------------------------------------------------

function LockedCard({ issue }: { issue: NewsletterIssue }) {
  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const teaser = issue.thesis_headline ?? issue.summary;
  const { signalCount } = parseRiskCounts(issue.sections_json);
  const previewBadge =
    signalCount > 3
      ? `Free preview — 3 of ${signalCount} signals`
      : "Free preview";

  return (
    <div className="bg-brand-surface border border-brand-line border-l-4 border-l-slate-600 rounded-xl p-6 relative overflow-hidden">
      {/* Free preview badge */}
      <div className="absolute top-0 right-0 bg-teal-900/40 text-teal-400 text-xs font-semibold px-3 py-1.5 rounded-bl-lg flex items-center gap-1 border-b border-l border-teal-800/50">
        <LockIcon />
        {previewBadge}
      </div>

      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2 pr-40">
        {date}
      </p>

      <h3 className="text-slate-100 font-bold text-base leading-snug mb-2">
        {issue.title}
      </h3>

      {teaser && (
        <p className="text-slate-400 text-sm leading-relaxed mb-4">
          {teaser}
        </p>
      )}

      {/* Included vs excluded */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Your free brief includes
        </p>
        <div className="space-y-1.5">
          {[
            { included: true,  label: "Weekly brief with top 3 signals" },
            { included: true,  label: "Executive summary" },
            { included: true,  label: "Why it matters (preview)" },
            { included: false, label: "Full signal analysis (all signals)" },
            { included: false, label: "Recommended actions" },
            { included: false, label: "Complete brief archive" },
          ].map(({ included, label }) => (
            <div key={label} className="flex items-center gap-2">
              {included ? (
                <span className="text-brand-teal text-xs font-bold flex-shrink-0">✓</span>
              ) : (
                <span className="text-slate-600 text-xs font-bold flex-shrink-0">✗</span>
              )}
              <span className={`text-xs ${included ? "text-slate-300" : "text-slate-500"}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t border-brand-line flex items-center justify-between">
        <span className="text-slate-500 text-xs">
          Available to Brief Pro and Team subscribers
        </span>
        <Link
          href="/account"
          className="text-brand-teal hover:text-teal-300 text-sm font-semibold transition-colors flex-shrink-0 ml-3"
        >
          Upgrade to Brief Pro — $49/mo →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlocked card
// ---------------------------------------------------------------------------

function UnlockedCard({ issue }: { issue: NewsletterIssue }) {
  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const { critical, high, signalCount, domains } = parseRiskCounts(issue.sections_json);
  const borderAccent = cardBorderAccent(critical, high);

  // Prefer thesis_headline as the descriptive hook; fall back to summary
  const hook = issue.thesis_headline ?? issue.summary;

  return (
    <Link href={`/briefs/${issue.id}`} className="block group">
      <div className={`bg-brand-surface border border-brand-line border-l-4 ${borderAccent} rounded-xl p-6 hover:border-slate-600 transition-all`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
            {issue.issue_number ? `Issue #${issue.issue_number} · ` : ""}{date}
          </p>
          <RiskBadges critical={critical} high={high} />
        </div>
        <h3 className="text-slate-100 font-bold text-base leading-snug mb-2 group-hover:text-brand-teal transition-colors">
          {issue.title}
        </h3>
        {hook && (
          <p className="text-slate-400 text-sm leading-relaxed line-clamp-3">
            {hook}
          </p>
        )}
        {/* Domain coverage chips */}
        {domains.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {domains.map((domain) => (
              <span
                key={domain}
                className="text-[10px] text-slate-400 bg-brand-bg border border-brand-line px-2 py-0.5 rounded font-medium"
              >
                {domain}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-brand-line flex items-center justify-between">
          <span className="text-brand-teal text-sm font-semibold group-hover:text-teal-300 transition-colors">
            Read brief →
          </span>
          {signalCount > 0 && (
            <span className="text-xs text-slate-500">
              {signalCount} signal{signalCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function BriefCard({ issue }: BriefCardProps) {
  if (issue.locked) return <LockedCard issue={issue} />;
  return <UnlockedCard issue={issue} />;
}

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="w-3 h-3"
    >
      <path
        fillRule="evenodd"
        d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Named export for use in the brief detail page
export { riskLevelColor };
