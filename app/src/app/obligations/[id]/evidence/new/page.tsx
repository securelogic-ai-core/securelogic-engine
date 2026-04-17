import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getObligation, getObligationAssessments } from "@/lib/api";
import { EvidenceForm } from "./EvidenceForm";

export default async function ObligationEvidenceNewPage({
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

  const [obligation, assessmentsData] = await Promise.all([
    getObligation(token, id),
    getObligationAssessments(token, id, 20),
  ]);

  if (!obligation) redirect("/obligations");

  const assessments = assessmentsData?.assessments ?? [];

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
          Add Evidence
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Attach evidence to support compliance with this obligation.
        </p>
      </div>

      <EvidenceForm
        obligationId={obligation.id}
        obligationTitle={obligation.title}
        assessments={assessments}
      />
    </div>
  );
}
