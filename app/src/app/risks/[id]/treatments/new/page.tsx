import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getRiskById } from "@/lib/api";
import { CreateTreatmentForm } from "./CreateTreatmentForm";

export default async function NewTreatmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const risk = await getRiskById(token, id);
  if (!risk) notFound();

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/risks/${id}`}
          style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}
        >
          ← {risk.title}
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: "#f1f5f9" }}>
          New Treatment
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Treatments start as Not Started. Use the treatment detail page to
          move it forward.
        </p>
      </div>

      <CreateTreatmentForm riskId={id} organizationId={me?.organizationId ?? ""} />
    </div>
  );
}
