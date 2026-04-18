import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getControls,
  getControlAssessments,
  type Control,
  type ControlAssessment,
} from "@/lib/api";
import { ControlsList } from "./ControlsList";

export default async function ControlsPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const [controlsData, assessmentsData] = await Promise.all([
    getControls(token),
    getControlAssessments(token),
  ]);

  // Build control_id → most-recent assessment (response is sorted created_at DESC).
  const latestAssessmentByControl = new Map<string, ControlAssessment>();
  const assessmentCountByControl = new Map<string, number>();
  for (const a of assessmentsData?.assessments ?? []) {
    assessmentCountByControl.set(
      a.control_id,
      (assessmentCountByControl.get(a.control_id) ?? 0) + 1
    );
    if (!latestAssessmentByControl.has(a.control_id)) {
      latestAssessmentByControl.set(a.control_id, a);
    }
  }

  const controls = controlsData?.controls ?? [];
  const overdueCount = controls.filter((c) => c.is_overdue).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Controls</h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Security and compliance controls tracked for this organization.
          </p>
          {overdueCount > 0 && (
            <p className="text-sm mt-1.5" style={{ color: "#fca5a5" }}>
              {overdueCount} control{overdueCount !== 1 ? "s" : ""} overdue for testing
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {controls.length > 0 && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {controls.length} control{controls.length !== 1 ? "s" : ""}
            </span>
          )}
          <Link
            href="/controls/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Control
          </Link>
        </div>
      </div>

      {controlsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Controls data is not available for your current plan.
          </p>
        </div>
      )}

      {controlsData !== null && controls.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No controls defined yet. Controls are the security measures your organization has in place.
          </p>
          <a
            href="/controls/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Your First Control
          </a>
        </div>
      )}

      {controls.length > 0 && (
        <ControlsList
          controls={controls}
          latestAssessmentByControl={Object.fromEntries(latestAssessmentByControl)}
          assessmentCountByControl={Object.fromEntries(assessmentCountByControl)}
        />
      )}
    </div>
  );
}
