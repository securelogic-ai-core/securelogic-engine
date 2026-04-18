import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPolicy } from "@/lib/api";
import { EditPolicyForm } from "./EditPolicyForm";

export default async function EditPolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const policyData = await getPolicy(token, id);
  if (!policyData) redirect("/policies");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href={`/policies/${id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Back to policy
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          Edit Policy
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          {policyData.policy.name}
        </p>
      </div>
      <EditPolicyForm policy={policyData.policy} />
    </div>
  );
}
