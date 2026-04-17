import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAiSystem, getAiSystemGovernanceContext } from "@/lib/api";
import { GovernanceAssessmentForm } from "./GovernanceAssessmentForm";

export default async function GovernanceAssessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [system, governanceContext] = await Promise.all([
    getAiSystem(token, id),
    getAiSystemGovernanceContext(token, id),
  ]);

  if (!system) redirect("/ai-systems");

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
        New Governance Assessment
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Track the governance assessment workflow for {system.name}.
      </p>

      <GovernanceAssessmentForm
        systemId={system.id}
        systemName={system.name}
        governanceContext={governanceContext}
      />
    </div>
  );
}
