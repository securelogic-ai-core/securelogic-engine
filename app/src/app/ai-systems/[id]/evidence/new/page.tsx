import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAiSystem, getGovernanceReviewsForSystem, getAiGovernanceAssessments } from "@/lib/api";
import { AiEvidenceForm } from "./AiEvidenceForm";

export default async function AiSystemEvidenceNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [system, reviewsData, assessmentsData] = await Promise.all([
    getAiSystem(token, id),
    getGovernanceReviewsForSystem(token, id, 20),
    getAiGovernanceAssessments(token, id, 20),
  ]);

  if (!system) redirect("/ai-systems");

  const reviews = reviewsData?.reviews ?? [];
  const assessments = assessmentsData?.assessments ?? [];

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/ai-systems/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {system.name}
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Add Evidence
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Attach evidence documents, screenshots, or test results to support {system.name}&apos;s governance record.
      </p>

      <AiEvidenceForm
        systemId={system.id}
        systemName={system.name}
        reviews={reviews}
        assessments={assessments}
      />
    </div>
  );
}
