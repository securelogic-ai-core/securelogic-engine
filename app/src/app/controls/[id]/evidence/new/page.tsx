import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getControl, getControlAssessmentsForControl } from "@/lib/api";
import { EvidenceForm } from "./EvidenceForm";

export default async function ControlEvidenceNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [control, assessmentsData] = await Promise.all([
    getControl(token, id),
    getControlAssessmentsForControl(token, id, 20),
  ]);

  if (!control) redirect("/controls");

  const assessments = assessmentsData?.assessments ?? [];

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
          Add Evidence
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Attach evidence to demonstrate control effectiveness.
        </p>
      </div>

      <EvidenceForm
        controlId={control.id}
        controlName={control.name}
        assessments={assessments}
      />
    </div>
  );
}
