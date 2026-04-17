import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAiSystem } from "@/lib/api";
import { GovernanceReviewForm } from "./GovernanceReviewForm";

export default async function GovernanceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const system = await getAiSystem(token, id);
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
        New Governance Review
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Record a point-in-time governance review for {system.name}.
      </p>

      <GovernanceReviewForm systemId={system.id} systemName={system.name} />
    </div>
  );
}
