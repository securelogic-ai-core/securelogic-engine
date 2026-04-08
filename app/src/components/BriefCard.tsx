import Link from "next/link";
import type { NewsletterIssue } from "@/lib/api";

interface BriefCardProps {
  issue: NewsletterIssue;
}

type SectionItem = { riskLevel?: string; risk_level?: string };
type Sections = { [key: string]: SectionItem[] | undefined };

function parseRiskCounts(sectionsJson: unknown): { critical: number; high: number } {
  if (!sectionsJson || typeof sectionsJson !== "object") return { critical: 0, high: 0 };
  const sections = sectionsJson as Sections;
  let critical = 0;
  let high = 0;

  for (const items of Object.values(sections)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const level = (item.riskLevel ?? item.risk_level ?? "").toLowerCase();
      if (level === "critical") critical++;
      else if (level === "high") high++;
    }
  }

  return { critical, high };
}

function RiskBadge({ critical, high }: { critical: number; high: number }) {
  if (critical === 0 && high === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mt-3">
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

export function BriefCard({ issue }: BriefCardProps) {
  const date = issue.publish_date
    ? new Date(issue.publish_date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date(issue.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  const { critical, high } = parseRiskCounts(issue.sections_json);

  if (issue.locked) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 bg-slate-100 text-slate-500 text-xs font-medium px-3 py-1 rounded-bl-lg flex items-center gap-1">
          <LockIcon />
          Subscribers only
        </div>

        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">
          {date}
        </p>
        <h3 className="text-slate-900 font-semibold text-base leading-snug mb-2">
          {issue.title}
        </h3>
        {issue.summary && (
          <p className="text-slate-500 text-sm leading-relaxed line-clamp-2">
            {issue.summary}
          </p>
        )}
        <RiskBadge critical={critical} high={high} />
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-slate-400 text-sm">
            {critical > 0
              ? `${critical} critical signal${critical !== 1 ? "s" : ""} this issue — upgrade to read`
              : "Full content available for subscribers"}
          </span>
          <Link
            href="/account"
            className="text-teal-600 hover:text-teal-700 text-sm font-medium transition-colors"
          >
            Upgrade →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Link href={`/briefs/${issue.id}`} className="block group">
      <div className="bg-white border border-slate-200 rounded-lg p-6 hover:border-teal-300 hover:shadow-sm transition-all">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">
          {date}
        </p>
        <h3 className="text-slate-900 font-semibold text-base leading-snug mb-2 group-hover:text-teal-700 transition-colors">
          {issue.title}
        </h3>
        {issue.summary && (
          <p className="text-slate-600 text-sm leading-relaxed line-clamp-3">
            {issue.summary}
          </p>
        )}
        <RiskBadge critical={critical} high={high} />
        <p className="mt-4 text-teal-600 text-sm font-medium">
          Read brief →
        </p>
      </div>
    </Link>
  );
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
