import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMe, getFrameworkRequirements } from "@/lib/api";
import { AssessmentChecklist } from "./AssessmentChecklist";
import Link from "next/link";

export default async function SelfAssessPage({
  params,
}: {
  params: Promise<{ frameworkId: string }>;
}) {
  const { frameworkId } = await params;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  if (!me) redirect("/login");

  const data = await getFrameworkRequirements(token, frameworkId, "self", me.organizationId);
  if (!data) redirect("/frameworks");

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link
        href={`/frameworks/${frameworkId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 hover:opacity-80 transition-opacity"
        style={{ color: "#94a3b8" }}
      >
        ← {data.framework.name}
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-0.5" style={{ color: "#f1f5f9" }}>
          Self Assessment
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          {data.framework.name} · v{data.framework.version}
        </p>
      </div>

      <AssessmentChecklist
        frameworkId={frameworkId}
        subjectId={me.organizationId}
        initialData={data}
      />
    </div>
  );
}
