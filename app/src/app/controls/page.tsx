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

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const [controlsData, assessmentsData] = await Promise.all([
    getControls(token),
    getControlAssessments(token),
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
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>Controls</h1>
          <p className="text-sm mt-1" style={{ color: '#94a3b8' }}>
            Security and compliance controls tracked for this organization.
          </p>
        </div>
        {controls.length > 0 && (
          <span className="text-sm" style={{ color: '#94a3b8' }}>
            {controls.length} control{controls.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Not entitled */}
      {controlsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Controls data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but no controls yet */}
      {controlsData !== null && controls.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: '#94a3b8' }}>
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

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  passed:               { background: 'rgba(34,197,94,0.15)',   color: '#86efac' },
  failed:               { background: 'rgba(239,68,68,0.15)',   color: '#fca5a5' },
  remediation_required: { background: 'rgba(249,115,22,0.15)',  color: '#fdba74' },
  in_progress:          { background: 'rgba(59,130,246,0.15)',  color: '#93c5fd' },
};

const SEVERITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: 'rgba(239,68,68,0.15)',   color: '#fca5a5' },
  High:     { background: 'rgba(249,115,22,0.15)',  color: '#fdba74' },
  Moderate: { background: 'rgba(245,158,11,0.15)',  color: '#fcd34d' },
  Low:      { background: 'rgba(34,197,94,0.15)',   color: '#86efac' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  const label = status.replace(/_/g, " ");
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const style = SEVERITY_BADGE_STYLES[severity] ?? { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
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
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + description + latest assessment state */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>
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
            <p className="mt-1 text-xs line-clamp-2" style={{ color: '#94a3b8' }}>
              {control.description}
            </p>
          )}
          {latestAssessment?.summary && (
            <p className="mt-1 text-xs line-clamp-1" style={{ color: '#475569' }}>
              {latestAssessment.summary}
            </p>
          )}
        </div>

        {/* Right: assessment count + last tested */}
        <div className="flex-shrink-0 text-right space-y-1">
          <div>
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              {assessmentCount > 0
                ? `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
                : "Not assessed"}
            </span>
          </div>
          {performedAt && (
            <div>
              <span className="text-xs" style={{ color: '#475569' }}>
                Tested {performedAt}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
