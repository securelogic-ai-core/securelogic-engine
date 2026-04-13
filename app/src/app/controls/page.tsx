import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getControls,
  getControlAssessments,
  type Control,
  type ControlAssessment,
} from "@/lib/api";

export default async function ControlsPage() {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const [controlsData, assessmentsData] = await Promise.all([
    getControls(session.apiKey),
    getControlAssessments(session.apiKey),
  ]);

  // Build control_id → most-recent assessment (response is sorted created_at DESC).
  // First occurrence per control_id is the most recent.
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

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Controls</h1>
          <p className="text-slate-500 text-sm mt-1">
            Security and compliance controls tracked for this organization.
          </p>
        </div>
        {controls.length > 0 && (
          <span className="text-sm text-slate-500">
            {controls.length} control{controls.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Not entitled */}
      {controlsData === null && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500">
            Controls data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but no controls yet */}
      {controlsData !== null && controls.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">
            No controls defined. Add controls via the API to populate this view.
          </p>
        </div>
      )}

      {/* Controls list */}
      {controls.length > 0 && (
        <div className="space-y-3">
          {controls.map((control) => (
            <ControlRow
              key={control.id}
              control={control}
              assessmentCount={assessmentCountByControl.get(control.id) ?? 0}
              latestAssessment={latestAssessmentByControl.get(control.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  passed:               "bg-green-100 text-green-800",
  failed:               "bg-red-100 text-red-800",
  remediation_required: "bg-orange-100 text-orange-800",
  in_progress:          "bg-blue-100 text-blue-800",
};

const SEVERITY_STYLES: Record<string, string> = {
  Critical: "bg-red-100 text-red-800",
  High:     "bg-orange-100 text-orange-800",
  Moderate: "bg-amber-100 text-amber-800",
  Low:      "bg-green-100 text-green-800",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const cls = SEVERITY_STYLES[severity] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {severity}
    </span>
  );
}

function ControlRow({
  control,
  assessmentCount,
  latestAssessment,
}: {
  control: Control;
  assessmentCount: number;
  latestAssessment: ControlAssessment | null;
}) {
  const performedAt =
    latestAssessment?.performed_at
      ? new Date(latestAssessment.performed_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + description + latest assessment state */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">
              {control.name}
            </span>
            {latestAssessment && (
              <>
                <StatusBadge status={latestAssessment.status} />
                <SeverityBadge severity={latestAssessment.overall_severity} />
              </>
            )}
          </div>
          {control.description && (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              {control.description}
            </p>
          )}
          {latestAssessment?.summary && (
            <p className="mt-1 text-xs text-slate-400 line-clamp-1">
              {latestAssessment.summary}
            </p>
          )}
        </div>

        {/* Right: assessment count + last tested */}
        <div className="flex-shrink-0 text-right space-y-1">
          <div>
            <span className="text-xs text-slate-500">
              {assessmentCount > 0
                ? `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
                : "Not assessed"}
            </span>
          </div>
          {performedAt && (
            <div>
              <span className="text-xs text-slate-400">
                Tested {performedAt}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
