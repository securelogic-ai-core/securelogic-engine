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

type CardAccent = {
  /** Inline-style hex for the left-border stripe. Hex (not Tailwind tokens) so the brand teal can match the palette exactly. */
  stripe: string;
  /** Eyebrow text — stacked above the date. */
  eyebrow: string;
  /** Eyebrow text colour (hex). Distinct from stripe — slightly darker for contrast against slate-800 surface. */
  eyebrowColor: string;
};

/**
 * Map the urgency mix to the card's stripe + eyebrow.
 *
 *   any immediate>0 → red    ("Immediate action")
 *   else any near_term>0 → amber ("Near-term focus")
 *   else                 → teal  ("Latest intelligence")
 *
 * Hex codes rather than Tailwind tokens because the inline-style stripe
 * needs an exact value and the eyebrow contrasts against slate-800.
 */
function cardAccent(counts: UrgencyCounts): CardAccent {
  if (counts.immediate > 0) {
    return { stripe: "#E24B4A", eyebrow: "Immediate action", eyebrowColor: "#A32D2D" };
  }
  if (counts.near_term > 0) {
    return { stripe: "#EF9F27", eyebrow: "Near-term focus", eyebrowColor: "#854F0B" };
  }
  // Was "Today's intelligence" — a hardcoded claim of currency the card cannot
  // make (walkthrough item 4: an 8-week-old brief presented itself as today's).
  return { stripe: "#1D9E75", eyebrow: "Latest intelligence", eyebrowColor: "#0F6E56" };
}

/**
 * Staleness rule (walkthrough item 4): briefs are generated WEEKLY (engine cron
 * "0 7 * * 2", Tuesday 07:00 UTC — schedulerRunner.ts). A Latest Brief older
 * than one cadence window must carry a visible staleness signal — old
 * intelligence never silently presents as current. 9 days = one 7-day window
 * plus 2 days' grace for send-time jitter.
 */
export const BRIEF_STALE_AFTER_DAYS = 9;

/** Whole days between the brief's period_end and now (never negative). */
export function briefAgeDays(periodEnd: string, nowMs: number): number {
  const t = Date.parse(periodEnd);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

/** Human age label for the staleness banner ("12 days old", "8 weeks old"). */
export function briefAgeLabel(ageDays: number): string {
  if (ageDays < 14) return `${ageDays} day${ageDays === 1 ? "" : "s"} old`;
  const weeks = Math.floor(ageDays / 7);
  return `${weeks} weeks old`;
}

/**
 * Fallback teaser built from the urgency mix when synthesis.teaser is null.
 * Used for legacy briefs (pre-exec-summary) and briefs whose synthesis
 * call failed. Zero-count buckets are omitted.
 *
 * Returns null when no item carries any urgency — caller hides the teaser
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
  const synthesis = brief.content_json?.synthesis ?? null;
  const headline = synthesis?.headline ?? null;
  const counts = countByUrgency(brief.items);
  const ageDays = briefAgeDays(brief.period_end, Date.now());
  const isStale = ageDays > BRIEF_STALE_AFTER_DAYS;
  // A stale brief must not wear an urgency eyebrow as if its calls-to-action were
  // current — the staleness signal replaces it.
  const accent: CardAccent = isStale
    ? { stripe: "#64748b", eyebrow: "Older intelligence", eyebrowColor: "#94a3b8" }
    : cardAccent(counts);
  const teaser = synthesis?.teaser ?? urgencyTeaser(counts);
  const title = headline ?? "Intelligence Brief";

  return (
    <Link href={`/briefs/${brief.id}`} className="block group">
      <div
        className="bg-brand-surface border border-brand-line border-l-4 rounded-xl p-6 hover:border-slate-600 transition-all"
        style={{ borderLeftColor: accent.stripe }}
      >
        <p
          className="text-xs font-bold uppercase tracking-wide"
          style={{ color: accent.eyebrowColor }}
        >
          {accent.eyebrow}
        </p>
        <p className="text-xs text-slate-500 font-medium mt-0.5">
          Intelligence Brief · {date}
        </p>

        {/* Walkthrough item 4: a Latest Brief older than the weekly cadence window
            carries an explicit staleness indicator. */}
        {isStale && (
          <p
            className="text-xs font-medium mt-2 px-2 py-1 rounded inline-block"
            style={{ background: "rgba(245,158,11,0.12)", color: "#fcd34d" }}
          >
            ⚠ This brief is {briefAgeLabel(ageDays)} — no newer brief has been published.
          </p>
        )}

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
