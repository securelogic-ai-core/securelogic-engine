import Link from "next/link";
import type { NewsletterIssue } from "@/lib/api";

interface BriefCardProps {
  issue: NewsletterIssue;
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

  if (issue.locked) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 relative overflow-hidden">
        {/* Locked overlay stripe */}
        <div className="absolute top-0 right-0 bg-slate-100 text-slate-500 text-xs font-medium px-3 py-1 rounded-bl-lg flex items-center gap-1">
          <LockIcon />
          Premium
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
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-slate-400 text-sm">Full content is available for subscribers.</span>
          <Link
            href="/account"
            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium transition-colors"
          >
            Upgrade →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Link href={`/briefs/${issue.id}`} className="block group">
      <div className="bg-white border border-slate-200 rounded-lg p-6 hover:border-indigo-300 hover:shadow-sm transition-all">
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">
          {date}
        </p>
        <h3 className="text-slate-900 font-semibold text-base leading-snug mb-2 group-hover:text-indigo-700 transition-colors">
          {issue.title}
        </h3>
        {issue.summary && (
          <p className="text-slate-600 text-sm leading-relaxed line-clamp-3">
            {issue.summary}
          </p>
        )}
        <p className="mt-4 text-indigo-600 text-sm font-medium">
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
