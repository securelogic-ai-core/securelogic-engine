import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getIssues } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";

export default async function BriefsPage() {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const data = await getIssues(session.apiKey);
  const issues = data?.issues ?? [];
  const isPremium =
    session.entitlementLevel === "premium" ||
    session.entitlementLevel === "professional";
  const lockedCount = issues.filter((i) => i.locked).length;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">
            Intelligence Briefs
          </h1>
          <p className="text-slate-600 text-sm">
            {issues.length > 0
              ? `${issues.length} briefs — ${issues.length - lockedCount} available`
              : "No briefs published yet."}
          </p>
        </div>

        {!isPremium && lockedCount > 0 && (
          <CheckoutButton tier="team" label="Upgrade" variant="outline" />
        )}
      </div>

      {issues.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-slate-500">
            No briefs have been published yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {issues.map((issue) => (
            <BriefCard key={issue.id} issue={issue} />
          ))}
        </div>
      )}

      {!isPremium && lockedCount > 0 && (
        <div className="mt-10 bg-indigo-50 border border-indigo-200 rounded-lg p-6 text-center">
          <p className="text-indigo-900 font-semibold mb-1">
            {lockedCount} brief{lockedCount !== 1 ? "s" : ""} locked
          </p>
          <p className="text-indigo-700 text-sm mb-4">
            Upgrade for full access to all Intelligence Brief content.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <CheckoutButton tier="professional" label="Professional — $39/mo" variant="outline" />
            <CheckoutButton tier="team" label="Team — $209/mo" variant="solid" />
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
      ? `${base} bg-indigo-600 hover:bg-indigo-700 text-white`
      : `${base} bg-white border border-indigo-300 text-indigo-700 hover:border-indigo-500`;

  return (
    <form action="/api/billing/checkout" method="POST">
      <input type="hidden" name="tier" value={tier} />
      <button type="submit" className={styles}>
        {label}
      </button>
    </form>
  );
}
