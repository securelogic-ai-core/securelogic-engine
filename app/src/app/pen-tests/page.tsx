import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPenTestEngagements, type PenTestEngagement } from "@/lib/api";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { isUnavailable } from "@/lib/edx/loadState";

/**
 * /pen-tests — the organization's penetration-test engagements (PEN-1).
 *
 * Before this page a customer had to call the API for an engagement UUID and
 * paste it into a CSV column. The engagement is a SOURCE, not a lifecycle —
 * each row is provenance (which test, run by whom, when, where the report is)
 * plus the count of the ordinary Findings the test produced. Everything
 * finding-shaped stays on /findings; nothing here duplicates that lifecycle.
 */

function fmtDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/** "Jul 1 – Jul 12, 2026", or whichever half of the period is on record. */
function periodLabel(e: PenTestEngagement): string | null {
  const start = fmtDate(e.started_on);
  const end = fmtDate(e.ended_on);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Started ${start}`;
  if (end) return `Ended ${end}`;
  return null;
}

export default async function PenTestsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Gated identically to the other assessment-family surfaces (the engine's
  // routes are requireEntitlement("premium")): a sub-platform user gets a clean
  // /dashboard redirect instead of a page whose every fetch would 403.
  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const data = await getPenTestEngagements(token);
  const engagements = data?.engagements ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Pen Tests</h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Penetration-test engagements and the findings they produced. Most recent first.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/findings/import"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:border-teal-500 hover:text-teal-300"
            style={{ border: "1px solid #1e2d45", color: "#cbd5e1", background: "transparent" }}
          >
            Import Findings
          </Link>
          <Link
            href="/pen-tests/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Record Pen Test
          </Link>
        </div>
      </div>

      {/* A failed fetch is an outage, never an empty register — the empty state
          below is a claim about the customer's testing history and must not be
          reachable through a hiccup. */}
      {isUnavailable(data) && (
        <UnavailableNotice
          subject="Pen tests"
          denial="not a limit of your plan, and not an empty register"
          reassurance="Your recorded engagements are unchanged."
          retryHref="/pen-tests"
        />
      )}

      {/* Genuinely empty: say exactly what would populate this view. */}
      {data !== null && engagements.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No penetration tests recorded.{" "}
            <Link
              href="/pen-tests/new"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              Record your first pen test
            </Link>{" "}
            to give imported findings their provenance.
          </p>
        </div>
      )}

      {engagements.length > 0 && (
        <div className="space-y-3">
          {engagements.map((e) => (
            <Link key={e.id} href={`/pen-tests/${e.id}`} className="block">
              <EngagementRow engagement={e} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function EngagementRow({ engagement }: { engagement: PenTestEngagement }) {
  const period = periodLabel(engagement);
  return (
    <div className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 cursor-pointer transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm font-semibold truncate block" style={{ color: "#f1f5f9" }}>
            {engagement.name}
          </span>
          <div className="mt-2 flex flex-wrap gap-3">
            {engagement.provider && (
              <span className="text-xs" style={{ color: "#94a3b8" }}>
                {engagement.provider}
              </span>
            )}
            {period && (
              <span className="text-xs" style={{ color: "#475569" }}>
                {period}
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          {/* Zero is stated, not hidden: an engagement showing no findings is
              either brand new or an import that failed, and silence would make
              those look identical. */}
          <span
            className="text-xs font-semibold"
            style={{ color: engagement.finding_count > 0 ? "#fdba74" : "#64748b" }}
          >
            {engagement.finding_count} finding{engagement.finding_count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
