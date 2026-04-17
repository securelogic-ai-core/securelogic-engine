import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getControl, getControlComplianceContext } from "@/lib/api";
import { ControlAssessmentForm } from "./ControlAssessmentForm";

export default async function ControlAssessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [control, complianceContext] = await Promise.all([
    getControl(token, id),
    getControlComplianceContext(token, id),
  ]);

  if (!control) redirect("/controls");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href={`/controls/${id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← {control.name}
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          New Control Assessment
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Record the outcome of testing this control.
        </p>
      </div>

      <ControlAssessmentForm
        controlId={control.id}
        controlName={control.name}
        complianceContext={complianceContext}
      />
    </div>
  );
}
