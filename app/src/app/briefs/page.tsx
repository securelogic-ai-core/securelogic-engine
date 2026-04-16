import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getMe } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";
import type { NewsletterIssue } from "@/lib/api";

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
          Read this week's brief →
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

  const [data, me] = await Promise.all([
    getIssues(token),
    getMe(token),
  ]);
  const issues = data?.issues ?? [];
  const entitlementLevel = me?.entitlementLevel ?? session.entitlementLevel ?? "free";
  const isPremium =
    entitlementLevel === "premium" ||
    entitlementLevel === "professional";
  const lockedCount = issues.filter((i) => i.locked).length;

  // Latest unlocked issue for the featured card
  const latestUnlocked = issues.find((i) => !i.locked) ?? null;
  // Remaining issues shown in the grid (exclude the featured one)
  const remainingIssues = latestUnlocked
    ? issues.filter((i) => i.id !== latestUnlocked.id)
    : issues;

  return (
    <div className="max-w-4xl mx-auto px-6 py-14">
      {/* Publication masthead */}
      <div className="mb-10 pb-8 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">SecureLogic AI</span>
          <span className="text-slate-300 select-none">·</span>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Intelligence Brief</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 leading-tight mb-3">
          Intelligence Brief
        </h1>
        <p className="text-sm text-slate-500 mb-4 max-w-xl leading-relaxed">
          Weekly risk intelligence across AI governance, security, regulatory, and vendor domains —
          distilled into executive-ready analysis and staged action roadmaps.
        </p>
        {issues.length > 0 && (
          <p className="text-xs text-slate-400">
            {issues.length - lockedCount} of {issues.length} issues available
          </p>
        )}
      </div>

      {issues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
          <p className="text-slate-400 text-sm">
            No briefs have been published yet. Check back soon.
          </p>
        </div>
      ) : (
        <>
          {/* Featured latest unlocked issue */}
          {latestUnlocked && <FeaturedIssueCard issue={latestUnlocked} />}

          {/* Archive grid */}
          {remainingIssues.length > 0 && (
            <>
              {latestUnlocked && (
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-5">
                  Previous Issues
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {remainingIssues.map((issue) => (
                  <BriefCard key={issue.id} issue={issue} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!isPremium && lockedCount > 0 && (
        <div className="mt-10 bg-teal-50 border border-teal-200 rounded-xl p-6 text-center">
          <p className="text-teal-900 font-semibold mb-1">
            {lockedCount} brief{lockedCount !== 1 ? "s" : ""} locked
          </p>
          <p className="text-teal-700 text-sm mb-4">
            Upgrade for full access to all Intelligence Brief content.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <CheckoutButton tier="professional" label="Professional — $29/mo" variant="solid" />
            <CheckoutButton tier="team" label="Team — $209/mo" variant="outline" />
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
  tier: "professional" | "team";
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
