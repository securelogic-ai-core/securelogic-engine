import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getMe,
  getAuthMe,
  getApprovalsServer,
  getRiskAcceptanceQueueServer,
  getRiskAcceptanceSummaryServer,
} from "@/lib/api";
import { ApprovalsQueue } from "@/components/approvals/ApprovalsQueue";
import { RiskAcceptanceApprovals } from "@/components/approvals/RiskAcceptanceApprovals";

/**
 * Approvals queue page (R3, spec §4.3) — the org-wide queue of treatment plans
 * awaiting executive approval, read from GET /api/approvals.
 *
 * Gating:
 *   - entitlement < premium → redirect to /dashboard (same as the risk family).
 *   - risk-lifecycle flag off → the engine returns 404, surfaced here as an
 *     "unavailable" state (no lifecycle affordances).
 * Approver authority and SoD are enforced by the engine; the UI reflects them.
 */
export default async function ApprovalsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Entitlement is authoritative from getMe (never the session cookie).
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  // The two approval families are fetched INDEPENDENTLY and degrade independently. They sit
  // behind DIFFERENT feature flags (risk-lifecycle vs risk-acceptance), so one being dark or
  // broken must never blank the other — that is precisely how a pending governance decision
  // would go unseen.
  const [authMe, approvalsResult, acceptanceResult, acceptanceSummary] = await Promise.all([
    session.jwtToken ? getAuthMe(session.jwtToken) : Promise.resolve(null),
    getApprovalsServer(token, "pending"),
    getRiskAcceptanceQueueServer(token, { state: "proposed" }),
    getRiskAcceptanceSummaryServer(token),
  ]);
  const userRole = authMe?.role ?? null;

  const disabled = !approvalsResult.ok && approvalsResult.disabled;

  // Flag off (404) => the section does not render at all. Not an empty state: an empty state
  // asserts "nothing is pending", which we cannot know while the route is dark.
  const acceptancesDark = !acceptanceResult.ok && acceptanceResult.disabled;
  const acceptancesFailed = !acceptanceResult.ok && !acceptanceResult.disabled;

  // The authoritative pending count is the engine's own counter. Fall back to the register's
  // total (same filter, same rows) if the summary route is unavailable — never to the page
  // length, which would under-report a queue longer than one page.
  const pendingCount = acceptanceSummary.ok
    ? acceptanceSummary.summary.awaiting_approval
    : acceptanceResult.ok
      ? acceptanceResult.total
      : 0;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link href="/risks" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
          ← Risk Register
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Approvals</h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Decisions awaiting your sign-off, org-wide.
        </p>
      </div>

      {/* Risk acceptances — a proposal to close a Finding by accepting its risk. Rendered
          FIRST: it is the surface with a hard separation-of-duties gate, and the one whose
          absence made the workflow unexecutable. */}
      {!acceptancesDark ? (
        <section className="mb-10">
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>
              Risk acceptances
            </h2>
            {!acceptancesFailed ? (
              <span className="text-sm" style={{ color: "#94a3b8" }}>
                {pendingCount} awaiting decision
              </span>
            ) : null}
          </div>

          {acceptancesFailed ? (
            <div
              className="p-8 text-center"
              style={{ background: "var(--color-brand-surface, #111827)", border: "1px solid #1e293b", borderRadius: 12 }}
            >
              {/* Explicitly NOT an empty state — we do not know that nothing is pending. */}
              <p className="text-sm" style={{ color: "#fca5a5" }}>
                Could not load risk acceptances. Refresh to try again.
              </p>
            </div>
          ) : acceptanceResult.ok ? (
            <RiskAcceptanceApprovals
              initialAcceptances={acceptanceResult.acceptances}
              total={acceptanceResult.total}
              currentUserId={session.userId ?? null}
            />
          ) : null}
        </section>
      ) : null}

      {/* Treatment plans — the Risk-Register lifecycle. A DIFFERENT object and a different
          engine route; kept as its own section rather than merged into one list. */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>
            Treatment plans
          </h2>
          {/* The page's original promise, kept — but moved to the section it is actually
              true of. The page as a whole is no longer only treatment plans. */}
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Treatment plans awaiting executive approval, org-wide.
          </p>
        </div>

        {disabled ? (
          <div
            className="p-8 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", border: "1px solid #1e293b", borderRadius: 12 }}
          >
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              The risk approval workflow isn’t enabled for your organization yet.
            </p>
          </div>
        ) : !approvalsResult.ok ? (
          <div
            className="p-8 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", border: "1px solid #1e293b", borderRadius: 12 }}
          >
            <p className="text-sm" style={{ color: "#fca5a5" }}>Could not load approvals.</p>
          </div>
        ) : (
          <ApprovalsQueue initialApprovals={approvalsResult.approvals} userRole={userRole} />
        )}
      </section>
    </div>
  );
}
