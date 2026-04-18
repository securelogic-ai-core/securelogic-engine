import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPolicies, type Policy } from "@/lib/api";
import { PoliciesList } from "./PoliciesList";

export default async function PoliciesPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const policiesData = await getPolicies(token, { limit: 100 });
  const policies: Policy[] = policiesData?.policies ?? [];
  const overdueCount = policies.filter((p) => p.is_overdue).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Policy Register
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Maintain your organization's security policies with version tracking and review cycles.
          </p>
          {overdueCount > 0 && (
            <p className="text-sm mt-1.5" style={{ color: "#fca5a5" }}>
              {overdueCount} {overdueCount === 1 ? "policy" : "policies"} overdue for review
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {policies.length > 0 && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {policies.length} {policies.length === 1 ? "policy" : "policies"}
            </span>
          )}
          <Link
            href="/policies/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Policy
          </Link>
        </div>
      </div>

      {policiesData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Policies data is not available for your current plan.
          </p>
        </div>
      )}

      {policiesData !== null && policies.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No policies defined yet.
          </p>
          <p className="text-xs mb-4" style={{ color: "#475569" }}>
            Add your security policies to track versions, review cycles, and control linkage.
          </p>
          <Link
            href="/policies/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add your first policy
          </Link>
        </div>
      )}

      {policies.length > 0 && <PoliciesList policies={policies} />}
    </div>
  );
}
