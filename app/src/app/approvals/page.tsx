import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMe, getAuthMe, getApprovalsServer } from "@/lib/api";
import { ApprovalsQueue } from "@/components/approvals/ApprovalsQueue";

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

  const [authMe, approvalsResult] = await Promise.all([
    session.jwtToken ? getAuthMe(session.jwtToken) : Promise.resolve(null),
    getApprovalsServer(token, "pending"),
  ]);
  const userRole = authMe?.role ?? null;

  const disabled = !approvalsResult.ok && approvalsResult.disabled;

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
    </div>
  );
}
