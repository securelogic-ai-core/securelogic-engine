import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIntelligenceBriefs, getIssues, getMe } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";
import type { IntelligenceBrief, NewsletterIssue } from "@/lib/api";

// ---------------------------------------------------------------------------
// Canonical intelligence-brief cards — the forward archive. Briefs are
// period-based (no editorial title); the period IS the identity.
// ---------------------------------------------------------------------------

function briefPeriodLabel(b: IntelligenceBrief): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(b.period_start).toLocaleDateString("en-US", opts);
  const end = new Date(b.period_end).toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `${start} – ${end}`;
}

function FeaturedBriefCard({ brief }: { brief: IntelligenceBrief }) {
  return (
    <Link href={`/briefs/${brief.id}`} className="block group mb-10">
      <div className="bg-white border border-teal-200 border-l-4 border-l-teal-500 rounded-xl p-7 shadow-sm hover:shadow-md transition-all">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-bold bg-teal-600 text-white px-2.5 py-1 rounded uppercase tracking-widest">
            Latest Brief
          </span>
          <span className="text-xs text-slate-400 font-semibold">{briefPeriodLabel(brief)}</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 leading-snug mb-3 group-hover:text-teal-700 transition-colors">
          Intelligence Brief — {briefPeriodLabel(brief)}
        </h2>
        <p className="text-slate-500 text-sm leading-relaxed mb-5 max-w-2xl">
          {brief.item_count} analyzed developments from {brief.signal_count} signals this period.
        </p>
        <span className="text-teal-600 text-sm font-semibold group-hover:text-teal-700 transition-colors">
          Read this week&apos;s brief →
        </span>
      </div>
    </Link>
  );
}

function ArchiveBriefCard({ brief }: { brief: IntelligenceBrief }) {
  return (
    <Link href={`/briefs/${brief.id}`} className="block group">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-teal-200 transition-all h-full">
        <p className="text-xs text-slate-400 font-semibold mb-2">{briefPeriodLabel(brief)}</p>
        <h3 className="text-base font-bold text-slate-900 leading-snug mb-2 group-hover:text-teal-700 transition-colors">
          Intelligence Brief
        </h3>
        <p className="text-slate-500 text-xs leading-relaxed">
          {brief.item_count} developments · {brief.signal_count} signals
        </p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Featured latest issue — highlights the most recent unlocked brief
// ---------------------------------------------------------------------------

function FeaturedIssueCard({ issue }: { issue: NewsletterIssue }) {
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

  const hook = issue.thesis_headline ?? issue.summary;

  return (
    <Link href={`/briefs/${issue.id}`} className="block group mb-10">
      <div className="bg-white border border-teal-200 border-l-4 border-l-teal-500 rounded-xl p-7 shadow-sm hover:shadow-md transition-all">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-bold bg-teal-600 text-white px-2.5 py-1 rounded uppercase tracking-widest">
            Latest Issue
          </span>
          <span className="text-xs text-slate-400 font-semibold">{date}</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 leading-snug mb-3 group-hover:text-teal-700 transition-colors">
          {issue.title}
        </h2>
        {hook && (
          <p className="text-slate-500 text-sm leading-relaxed mb-5 max-w-2xl">
            {hook}
          </p>
        )}
        <span className="text-teal-600 text-sm font-semibold group-hover:text-teal-700 transition-colors">
          Read this week&apos;s brief →
        </span>
      </div>
    </Link>
  );
}

export default async function BriefsPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  // The canonical archive is intelligence_briefs (what the dashboard's Latest
  // Brief card opens). The legacy newsletter table — whose generation pipeline
  // is off by default — stays as a secondary section so old links keep working.
  const [briefList, data, me] = await Promise.all([
    getIntelligenceBriefs(token, { limit: 24, status: "published" }),
    getIssues(token),
    getMe(token),
  ]);
  const briefs = briefList?.briefs ?? [];
  const issues = data?.issues ?? [];
  const entitlementLevel = me?.entitlementLevel ?? session.entitlementLevel ?? "free";
  // Platform-family rule mirrors the dashboard's isPlatformUser: a platform
  // tenant must never see Free-tier or Brief Pro upsell messaging, even when
  // the engine returns a locked issue (entitlement drift).
  const isPlatformFamily =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  const suppressUpsell = isPlatformFamily || entitlementLevel === "professional";
  const lockedCount = issues.filter((i) => i.locked).length;

  // Featured card: the newest published canonical brief; legacy issues only
  // feature when no canonical brief exists yet.
  const latestBrief = briefs[0] ?? null;
  const remainingBriefs = latestBrief ? briefs.slice(1) : briefs;

  // Latest unlocked issue for the legacy featured card (canonical-empty orgs only)
  const latestUnlocked = issues.find((i) => !i.locked) ?? null;
  const remainingIssues =
    latestBrief === null && latestUnlocked
      ? issues.filter((i) => i.id !== latestUnlocked.id)
      : issues;

  return (
    <div className="max-w-4xl mx-auto px-6 py-14">
      {/* Publication masthead */}
      <div className="mb-10 pb-8 border-b border-slate-700">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-brand-teal uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-600 select-none">·</span>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Intelligence Brief</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-100 leading-tight mb-3">
          Intelligence Brief
        </h1>
        <p className="text-sm text-slate-400 mb-4 max-w-xl leading-relaxed">
          Weekly risk intelligence across AI governance, security, regulatory, and vendor domains —
          distilled into executive-ready analysis and staged action roadmaps.
        </p>
        {briefs.length > 0 ? (
          <p className="text-xs text-slate-500">
            {briefs.length} brief{briefs.length !== 1 ? "s" : ""}
            {issues.length > 0
              ? ` · ${issues.length} archived issue${issues.length !== 1 ? "s" : ""}`
              : " in the archive"}
          </p>
        ) : issues.length > 0 ? (
          <p className="text-xs text-slate-500">
            {issues.length - lockedCount} of {issues.length} issues available
          </p>
        ) : null}
      </div>

      {briefs.length === 0 && issues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
          <p className="text-slate-400 text-sm">
            No briefs have been published yet — the weekly Intelligence Brief is
            generated every Tuesday and will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Canonical archive: featured latest brief + period grid */}
          {latestBrief && <FeaturedBriefCard brief={latestBrief} />}
          {remainingBriefs.length > 0 && (
            <>
              {latestBrief && (
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">
                  Previous Briefs
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {remainingBriefs.map((b) => (
                  <ArchiveBriefCard key={b.id} brief={b} />
                ))}
              </div>
            </>
          )}

          {/* Legacy newsletter issues — old links keep working; featured only
              when no canonical brief exists yet. */}
          {latestBrief === null && latestUnlocked && <FeaturedIssueCard issue={latestUnlocked} />}
          {remainingIssues.length > 0 && (
            <>
              <p className={`text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5${latestBrief || latestUnlocked ? " mt-10" : ""}`}>
                {briefs.length > 0 ? "Archived Issues" : "Previous Issues"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {remainingIssues.map((issue) => (
                  <BriefCard key={issue.id} issue={issue} viewerIsPlatform={isPlatformFamily} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!suppressUpsell && lockedCount > 0 && (
        <div className="mt-10 bg-teal-50 border border-teal-200 rounded-xl p-6 text-center">
          <p className="text-teal-900 font-semibold mb-1">
            {lockedCount} brief{lockedCount !== 1 ? "s" : ""} locked
          </p>
          <p className="text-teal-700 text-sm mb-4">
            Upgrade for full access to all Intelligence Brief content.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <CheckoutButton tier="professional" label="Brief Pro — $49/mo" variant="solid" />
            <CheckoutButton tier="teams" label="Brief Team — $199/mo" variant="outline" />
          </div>
        </div>
      )}
    </div>
  );
}

function CheckoutButton({
  tier,
  label,
  variant = "outline",
}: {
  tier: "professional" | "teams" | "platform" | "platform_annual";
  label: string;
  variant?: "outline" | "solid";
}) {
  const base = "font-semibold text-sm py-2 px-5 rounded-lg transition-colors";
  const styles =
    variant === "solid"
      ? `${base} bg-teal-600 hover:bg-teal-500 text-white`
      : `${base} bg-white border border-teal-300 text-teal-700 hover:border-teal-500`;

  return (
    <form action="/api/billing/checkout" method="POST">
      <input type="hidden" name="tier" value={tier} />
      <button type="submit" className={styles}>
        {label}
      </button>
    </form>
  );
}
