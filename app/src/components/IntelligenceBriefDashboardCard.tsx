import Link from "next/link";
import type {
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
} from "@/lib/api";

interface IntelligenceBriefDashboardCardProps {
  brief: IntelligenceBriefDetailResponse;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type UrgencyCounts = {
  immediate: number;
  near_term: number;
  far_term: number;
};

function countByUrgency(items: ReadonlyArray<IntelligenceBriefItem>): UrgencyCounts {
  const counts: UrgencyCounts = { immediate: 0, near_term: 0, far_term: 0 };
  for (const item of items) {
    if (item.urgency === "immediate") counts.immediate++;
    else if (item.urgency === "near_term") counts.near_term++;
    else if (item.urgency === "far_term") counts.far_term++;
  }
  return counts;
}

/**
 * Map item-level urgency mix to the card's left-border accent. Echoes the
 * BriefCard.tsx vocabulary (red → orange → teal default), but driven by
 * urgency rather than legacy severity counts.
 */
function borderAccent(counts: UrgencyCounts): string {
  if (counts.immediate > 0) return "border-l-red-500";
  if (counts.near_term > 0) return "border-l-orange-400";
  return "border-l-brand-teal";
}

/**
 * Build the single-line teaser from the urgency mix. Zero-count buckets
 * are omitted so a brief with only near-term items reads "3 near-term"
 * rather than "0 immediate · 3 near-term · 0 monitoring".
 *
 * Returns null when no item carries any urgency (legacy briefs pre-D1
 * with all-null urgency, or empty briefs) — caller hides the teaser
 * rather than rendering a placeholder.
 */
function urgencyTeaser(counts: UrgencyCounts): string | null {
  const parts: string[] = [];
  if (counts.immediate > 0) parts.push(`${counts.immediate} immediate`);
  if (counts.near_term > 0) parts.push(`${counts.near_term} near-term`);
  if (counts.far_term > 0) parts.push(`${counts.far_term} monitoring`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function IntelligenceBriefDashboardCard({
  brief,
}: IntelligenceBriefDashboardCardProps) {
  const date = formatDate(brief.period_end);
  const headline = brief.content_json?.synthesis?.headline ?? null;
  const counts = countByUrgency(brief.items);
  const accent = borderAccent(counts);
  const teaser = urgencyTeaser(counts);
  const title = headline ?? "Daily Intelligence Brief";

  return (
    <Link href={`/briefs/${brief.id}`} className="block group">
      <div
        className={`bg-brand-surface border border-brand-line border-l-4 ${accent} rounded-xl p-6 hover:border-slate-600 transition-all`}
      >
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
          Intelligence Brief · {date}
        </p>

        <h3 className="text-slate-100 font-bold text-base leading-snug mt-2 mb-2 group-hover:text-brand-teal transition-colors">
          {title}
        </h3>

        {teaser && (
          <p className="text-slate-400 text-sm leading-relaxed line-clamp-3">
            {teaser}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-brand-line flex items-center justify-between">
          <span className="text-brand-teal group-hover:text-teal-300 text-sm font-semibold transition-colors">
            Read brief →
          </span>
          {brief.signal_count > 0 && (
            <span className="text-xs text-slate-500">
              {brief.signal_count} signal{brief.signal_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
