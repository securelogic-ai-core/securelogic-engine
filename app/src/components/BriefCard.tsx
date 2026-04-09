import Link from "next/link";
import type { NewsletterIssue, BriefSignal, BriefSections } from "@/lib/api";

interface BriefCardProps {
  issue: NewsletterIssue;
}

function parseRiskCounts(sectionsJson: BriefSections | null): {
  critical: number;
  high: number;
  signalTitles: string[];
} {
  if (!sectionsJson || typeof sectionsJson !== "object") {
    return { critical: 0, high: 0, signalTitles: [] };
  }

  let critical = 0;
  let high = 0;
  const signalTitles: string[] = [];

  for (const items of Object.values(sectionsJson)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as BriefSignal[]) {
      const level = (item.riskLevel ?? item.risk_level ?? "").toLowerCase();
      if (level === "critical") critical++;
      else if (level === "high") high++;
      if (item.title) signalTitles.push(item.title);
    }
  }

  return { critical, high, signalTitles };
}

function riskLevelColor(level: string) {
  const l = level.toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700";
  if (l === "high") return "bg-orange-100 text-orange-700";
  if (l === "medium") return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function RiskBadges({ critical, high }: { critical: number; high: number }) {
  if (critical === 0 && high === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
      {critical > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" />
          {critical} Critical
        </span>
      )}
      {high > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700">
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
// Locked card — value-demonstrating teaser
// Shows thesis headline, signal titles (blurred), and what's behind the gate
// ---------------------------------------------------------------------------

function LockedCard({ issue }: { issue: NewsletterIssue }) {
  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  // For locked issues, sections_json is null — we can only show what the API returns
  // thesis_headline and summary are always returned even when locked
  const teaser = issue.thesis_headline ?? issue.summary;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-slate-100 text-slate-500 text-xs font-medium px-3 py-1 rounded-bl-lg flex items-center gap-1">
        <LockIcon />
        Subscribers only
      </div>

      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2 pr-24">
        {date}
      </p>

      <h3 className="text-slate-900 font-semibold text-base leading-snug mb-2">
        {issue.title}
      </h3>

      {teaser && (
        <p className="text-slate-500 text-sm leading-relaxed mb-3">
          {teaser}
        </p>
      )}

      {/* Teaser of what's locked */}
      <div className="space-y-1.5 mb-4">
        {[
          "Full signal analysis and risk scoring rationale",
          "Staged action roadmap (this week / this month / monitor)",
          "Cross-domain risk pattern analysis",
        ].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="w-1 h-1 bg-slate-300 rounded-full flex-shrink-0" />
            <span className="text-slate-400 text-xs">{item}</span>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
        <span className="text-slate-400 text-xs">
          Full content available for Professional and Team subscribers
        </span>
        <Link
          href="/account"
          className="text-teal-600 hover:text-teal-700 text-sm font-medium transition-colors flex-shrink-0 ml-3"
        >
          Upgrade →
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

  const { critical, high } = parseRiskCounts(issue.sections_json);

  // Prefer thesis_headline as the descriptive hook; fall back to summary
  const hook = issue.thesis_headline ?? issue.summary;

  return (
    <Link href={`/briefs/${issue.id}`} className="block group">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:border-teal-300 hover:shadow-md transition-all">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">
          {date}
        </p>
        <h3 className="text-slate-900 font-semibold text-base leading-snug mb-2 group-hover:text-teal-700 transition-colors">
          {issue.title}
        </h3>
        {hook && (
          <p className="text-slate-600 text-sm leading-relaxed line-clamp-3 mb-1">
            {hook}
          </p>
        )}
        <RiskBadges critical={critical} high={high} />
        <p className="mt-4 text-teal-600 text-sm font-medium group-hover:text-teal-700">
          Read brief →
        </p>
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
