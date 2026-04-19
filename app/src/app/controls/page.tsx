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

export default async function ControlsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const sp = await searchParams;
  const filterOverdue = sp.filter === "overdue";

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

  const allControls = controlsData?.controls ?? [];
  const overdueCount = allControls.filter((c) => c.is_overdue).length;
  const controls = filterOverdue ? allControls.filter((c) => c.is_overdue) : allControls;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Overdue filter banner */}
      {filterOverdue && (
        <div
          className="mb-6 flex items-center justify-between gap-4 rounded-xl px-5 py-3 flex-wrap"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <p className="text-sm" style={{ color: "#fca5a5" }}>
            Showing overdue controls only — <strong>{controls.length}</strong> control{controls.length !== 1 ? "s" : ""} overdue for testing
          </p>
          <Link
            href="/controls"
            className="text-xs font-medium flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ color: "#94a3b8" }}
          >
            Show all →
          </Link>
        </div>
      )}

      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Controls</h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Security and compliance controls tracked for this organization.
          </p>
          {overdueCount > 0 && !filterOverdue && (
            <p className="text-sm mt-1.5" style={{ color: "#fca5a5" }}>
              {overdueCount} control{overdueCount !== 1 ? "s" : ""} overdue for testing
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {allControls.length > 0 && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {filterOverdue
                ? `${controls.length} of ${allControls.length} control${allControls.length !== 1 ? "s" : ""}`
                : `${allControls.length} control${allControls.length !== 1 ? "s" : ""}`}
            </span>
          )}
          <Link
            href="/controls/import"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              border: "1px solid #1e293b",
              color: "#94a3b8",
              textDecoration: "none",
            }}
          >
            ↑ Import CSV
          </Link>
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

      {controlsData !== null && allControls.length === 0 && (
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
