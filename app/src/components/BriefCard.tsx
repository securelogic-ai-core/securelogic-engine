import Link from "next/link";
import type { NewsletterIssue, BriefSignal, BriefSections } from "@/lib/api";
import { briefAgeDays, staleAgeLabel, isBriefStale } from "@/lib/briefStaleness";

interface BriefCardProps {
  issue: NewsletterIssue;
  /**
   * True when the viewer holds a platform-family entitlement (premium /
   * platform / team). A platform tenant must NEVER be shown Free-tier or
   * Brief Pro upsell messaging — if the engine returns a locked issue anyway
   * (entitlement drift), the card degrades to a neutral unavailable state
   * instead of the consumer teaser.
   */
  viewerIsPlatform?: boolean;
  /**
   * Enable the stale-age warning. Set on "Latest Brief" surfaces (dashboard),
   * where an old brief silently presenting as current is a defect — NOT on
   * the /briefs archive grid, where old issues are simply the archive.
   */
  showStaleWarning?: boolean;
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

function issueDateForStaleness(issue: NewsletterIssue): string {
  return issue.publish_date ?? issue.created_at;
}

/**
 * Amber stale-content warning (walkthrough item 4, extended to the legacy
 * newsletter-issue fallback). Same rule + label as the canonical
 * IntelligenceBriefDashboardCard, via @/lib/briefStaleness.
 */
function StaleNotice({ issue }: { issue: NewsletterIssue }) {
  const ageDays = briefAgeDays(issueDateForStaleness(issue));
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/30 px-3 py-2">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      <p className="text-xs font-semibold text-amber-300">
        {staleAgeLabel(ageDays)} Last published {formatDate(issueDateForStaleness(issue))}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Neutral unavailable card — a platform-entitled viewer holding a locked
// issue. That combination is entitlement drift (the platform plan includes
// the full brief), so the card states unavailability plainly: no Free-tier
// framing, no Brief Pro upsell, no checkout link.
// ---------------------------------------------------------------------------

function PlatformUnavailableCard({ issue, stale }: { issue: NewsletterIssue; stale: boolean }) {
  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const teaser = issue.thesis_headline ?? issue.summary;

  return (
    <div className="bg-brand-surface border border-brand-line border-l-4 border-l-slate-600 rounded-xl p-6">
      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">
        {date}
      </p>

      {stale && <StaleNotice issue={issue} />}

      <h3 className="text-slate-100 font-bold text-base leading-snug mb-2">
        {issue.title}
      </h3>

      {teaser && (
        <p className="text-slate-400 text-sm leading-relaxed mb-4">{teaser}</p>
      )}

      <div className="pt-4 border-t border-brand-line">
        <p className="text-slate-400 text-sm">
          The full content of this brief isn&apos;t available right now. Your plan
          includes the Intelligence Brief — no upgrade is needed. If this
          persists, contact{" "}
          <a href="mailto:hello@securelogicai.com" className="text-brand-teal hover:text-teal-300 transition-colors">
            hello@securelogicai.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locked card — value-demonstrating teaser for free plan users
// ---------------------------------------------------------------------------

function LockedCard({ issue, stale }: { issue: NewsletterIssue; stale: boolean }) {
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

      {stale && <StaleNotice issue={issue} />}

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

function UnlockedCard({ issue, stale }: { issue: NewsletterIssue; stale: boolean }) {
  const date = issue.publish_date
    ? formatDate(issue.publish_date)
    : formatDate(issue.created_at);

  const { critical, high, signalCount, domains } = parseRiskCounts(issue.sections_json);
  // A stale brief drops its risk accent — an 8-week-old critical stripe is
  // itself a false claim of currency (same rule as the canonical card).
  const borderAccent = stale ? "border-l-slate-600" : cardBorderAccent(critical, high);

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
        {stale && <StaleNotice issue={issue} />}
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

export function BriefCard({
  issue,
  viewerIsPlatform = false,
  showStaleWarning = false,
}: BriefCardProps) {
  const stale = showStaleWarning && isBriefStale(issueDateForStaleness(issue));
  if (issue.locked && viewerIsPlatform) {
    return <PlatformUnavailableCard issue={issue} stale={stale} />;
  }
  if (issue.locked) return <LockedCard issue={issue} stale={stale} />;
  return <UnlockedCard issue={issue} stale={stale} />;
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
