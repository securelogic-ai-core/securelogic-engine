import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getObligation, getObligationComplianceContext } from "@/lib/api";
import { ObligationAssessmentForm } from "./ObligationAssessmentForm";

export default async function ObligationAssessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [obligation, complianceContext] = await Promise.all([
    getObligation(token, id),
    getObligationComplianceContext(token, id),
  ]);

  if (!obligation) redirect("/obligations");

  if (obligation.status !== "active") {
    redirect(`/obligations/${id}`);
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href={`/obligations/${id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← {obligation.title}
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          New Obligation Assessment
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Record a compliance review against this obligation.
        </p>
      </div>

      <ObligationAssessmentForm
        obligationId={obligation.id}
        obligationTitle={obligation.title}
        complianceContext={complianceContext}
      />
    </div>
  );
}
