import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getRiskById, getRiskScale } from "@/lib/api";
import { EditRiskForm } from "./EditRiskForm";

export default async function EditRiskPage({
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

  const [risk, scale] = await Promise.all([
    getRiskById(token, id),
    getRiskScale(token),
  ]);

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
          Edit Risk
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Update any field. Changes are saved to the audit log.
        </p>
      </div>

      <EditRiskForm
        risk={risk}
        scaleLevels={scale?.levels ?? []}
        organizationId={me?.organizationId ?? ""}
      />
    </div>
  );
}
