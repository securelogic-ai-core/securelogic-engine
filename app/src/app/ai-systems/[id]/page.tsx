import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getAiSystem,
  getGovernanceReviewsForSystem,
  getAiGovernanceAssessments,
  getFindings,
  type AiSystem,
  type GovernanceReview,
  type AiGovernanceAssessment,
  type Finding,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────
// Badge components
// ─────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const style = SEVERITY_STYLES[severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {severity}
    </span>
  );
}

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  near_term: { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  planned:   { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const style = PRIORITY_STYLES[priority] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const label = priority.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={style}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function FindingStatusBadge({ status }: { status: string }) {
  const style: React.CSSProperties =
    status === "open"
      ? { background: "rgba(239,68,68,0.12)", color: "#fca5a5" }
      : status === "in_progress"
      ? { background: "rgba(59,130,246,0.15)", color: "#93c5fd" }
      : { background: "rgba(34,197,94,0.12)", color: "#86efac" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={style}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const ASSESSMENT_STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress:         { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  compliant:           { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  non_compliant:       { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  partially_compliant: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
};

const ASSESSMENT_STATUS_LABELS: Record<string, string> = {
  not_started:         "Not Started",
  in_progress:         "In Progress",
  compliant:           "Compliant",
  non_compliant:       "Non-Compliant",
  partially_compliant: "Partially Compliant",
};

function AssessmentStatusBadge({ status }: { status: string }) {
  const style = ASSESSMENT_STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {ASSESSMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const CRITICALITY_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  high:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  medium:   { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

function CriticalityBadge({ criticality }: { criticality: string | null }) {
  if (!criticality) return null;
  const style = CRITICALITY_STYLES[criticality] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {criticality.charAt(0).toUpperCase() + criticality.slice(1)}
    </span>
  );
}

function DeploymentStatusChip({ value }: { value: string | null }) {
  if (!value) return null;
  const style: React.CSSProperties =
    value === "production"
      ? { background: "rgba(59,130,246,0.15)", color: "#93c5fd" }
      : value === "decommissioned"
      ? { background: "rgba(148,163,184,0.1)", color: "#64748b" }
      : { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={style}>
      {value}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Open Findings
// ─────────────────────────────────────────────────────────────

function OpenFindingsSection({ findings }: { findings: Finding[] }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Open Findings
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{
            background: findings.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.12)",
            color: findings.length > 0 ? "#fca5a5" : "#475569",
          }}
        >
          {findings.length}
        </span>
      </div>

      {findings.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>No open findings for this AI system.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {findings.map((f) => (
            <div key={f.id} className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <div className="flex items-start gap-2 flex-wrap mb-2">
                <SeverityBadge severity={f.severity} />
                {f.priority && <PriorityBadge priority={f.priority} />}
                <FindingStatusBadge status={f.status} />
              </div>
              <p className="text-sm font-semibold mb-1.5" style={{ color: "#f1f5f9" }}>
                {f.title}
              </p>
              <p className="text-xs line-clamp-3 mb-2" style={{ color: "#94a3b8" }}>
                {f.description}
              </p>
              {f.due_date && (
                <p className="text-xs mb-2" style={{ color: "#475569" }}>
                  Due: {fmt(f.due_date)}
                </p>
              )}
              {f.recommendation && (
                <div
                  className="mt-3 rounded-lg px-3 py-2"
                  style={{ borderLeft: "3px solid #00c4b4", background: "rgba(0,196,180,0.06)" }}
                >
                  <p className="text-xs font-medium mb-0.5" style={{ color: "#94a3b8" }}>
                    Recommendation
                  </p>
                  <p className="text-xs" style={{ color: "#cbd5e1" }}>
                    {f.recommendation}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Governance Reviews (immutable)
// ─────────────────────────────────────────────────────────────

function GovernanceReviewsSection({ reviews }: { reviews: GovernanceReview[] }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Governance Reviews
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "#475569" }}
        >
          {reviews.length}
        </span>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>No governance reviews recorded.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                      {r.review_type}
                    </span>
                    <SeverityBadge severity={(r as GovernanceReview & { overall_severity?: string | null }).overall_severity ?? null} />
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: "rgba(0,196,180,0.12)", color: "#00c4b4" }}
                    >
                      Finding created
                    </span>
                  </div>
                  {r.outcome && (
                    <p className="text-xs mb-1" style={{ color: "#cbd5e1" }}>
                      {r.outcome}
                    </p>
                  )}
                  {r.summary && (
                    <p className="text-xs" style={{ color: "#94a3b8" }}>
                      {r.summary}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs" style={{ color: "#475569" }}>
                    {fmt(r.performed_at)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Governance Assessments (mutable)
// ─────────────────────────────────────────────────────────────

const FINDING_TRIGGER_STATUSES = new Set(["non_compliant", "partially_compliant"]);

function GovernanceAssessmentsSection({
  assessments,
  assessmentIdsWithFindings,
}: {
  assessments: AiGovernanceAssessment[];
  assessmentIdsWithFindings: Set<string>;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Governance Assessments
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "#475569" }}
        >
          {assessments.length}
        </span>
      </div>

      {assessments.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>No governance assessments yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assessments.map((a) => (
            <div key={a.id} className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <AssessmentStatusBadge status={a.status} />
                    {a.overall_severity && <SeverityBadge severity={a.overall_severity} />}
                    {assessmentIdsWithFindings.has(a.id) && (
                      <span className="text-xs font-medium" style={{ color: "#00c4b4" }}>
                        · Finding created
                      </span>
                    )}
                  </div>
                  {a.summary && (
                    <p className="text-xs mb-1.5" style={{ color: "#cbd5e1" }}>
                      {a.summary}
                    </p>
                  )}
                  {a.notes && (
                    <p className="text-sm" style={{ color: "#94a3b8" }}>
                      {a.notes}
                    </p>
                  )}
                </div>
                {a.performed_at && (
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs" style={{ color: "#475569" }}>
                      {fmt(a.performed_at)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: System Details
// ─────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: "1px solid #1e2d45" }}>
      <span className="text-xs uppercase tracking-wide font-medium" style={{ color: "#475569" }}>
        {label}
      </span>
      <span className="text-xs font-medium text-right" style={{ color: "#cbd5e1" }}>
        {children}
      </span>
    </div>
  );
}

function SystemDetailsCard({ system }: { system: AiSystem }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="mb-4">
        <p className="text-base font-bold mb-1.5" style={{ color: "#f1f5f9" }}>
          {system.name}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <CriticalityBadge criticality={system.criticality} />
          <DeploymentStatusChip value={system.deployment_status} />
        </div>
      </div>

      <div className="space-y-0 -mx-1 px-1">
        {system.model_type && (
          <DetailRow label="Model type">{system.model_type}</DetailRow>
        )}
        {system.data_classification && (
          <DetailRow label="Data class">{system.data_classification}</DetailRow>
        )}
        {system.risk_classification && (
          <DetailRow label="Risk class">{system.risk_classification}</DetailRow>
        )}
        <DetailRow label="Added">{fmt(system.created_at)}</DetailRow>
      </div>

      {system.use_case && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e2d45" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#475569" }}>Use Case</p>
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "#94a3b8" }}>
            {system.use_case}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: Governance Summary
// ─────────────────────────────────────────────────────────────

function governanceSummaryColor(openFindings: Finding[]): string {
  if (openFindings.some((f) => f.severity === "Critical")) return "#fca5a5";
  if (openFindings.some((f) => f.severity === "High"))     return "#fdba74";
  if (openFindings.some((f) => f.severity === "Moderate")) return "#fcd34d";
  if (openFindings.length > 0) return "#86efac";
  return "#00c4b4";
}

function GovernanceSummaryCard({
  openFindings,
  reviewCount,
  assessmentCount,
  latestAssessment,
}: {
  openFindings: Finding[];
  reviewCount: number;
  assessmentCount: number;
  latestAssessment: AiGovernanceAssessment | null;
}) {
  const countColor = governanceSummaryColor(openFindings);

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Governance Summary
      </h3>

      <div className="mb-4">
        <p className="text-4xl font-bold leading-none" style={{ color: countColor }}>
          {openFindings.length}
        </p>
        <p className="text-xs mt-1" style={{ color: "#475569" }}>
          open finding{openFindings.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Governance reviews</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{reviewCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Assessments</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{assessmentCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Latest status</span>
          {latestAssessment ? (
            <AssessmentStatusBadge status={latestAssessment.status} />
          ) : (
            <span className="text-xs" style={{ color: "#475569" }}>No assessments</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: Actions
// ─────────────────────────────────────────────────────────────

function ActionsCard({ systemId }: { systemId: string }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Actions
      </h3>
      <div className="space-y-2">
        <Link
          href={`/ai-systems/${systemId}/review`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          New Governance Review
        </Link>
        <Link
          href={`/ai-systems/${systemId}/assess`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: "#1e2d45", color: "#94a3b8", background: "transparent" }}
        >
          New Assessment
        </Link>
        <Link
          href={`/ai-systems/${systemId}/evidence/new`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{ borderColor: "#1e2d45", color: "#94a3b8", background: "transparent" }}
        >
          Add Evidence
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function AiSystemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [system, reviewsData, assessmentsData, findingsData] = await Promise.all([
    getAiSystem(token, id),
    getGovernanceReviewsForSystem(token, id, 20),
    getAiGovernanceAssessments(token, id, 20),
    getFindings(token, { limit: 50 }),
  ]);

  if (!system) redirect("/ai-systems");

  const reviews = reviewsData?.reviews ?? [];
  const assessments = assessmentsData?.assessments ?? [];
  const allFindings = findingsData?.findings ?? [];

  // Build ID sets for both source types.
  const reviewIds = new Set(reviews.map((r) => r.id));
  const assessmentIds = new Set(assessments.map((a) => a.id));

  // Filter findings: ai_review links to governance_reviews; ai_governance_review links to assessments.
  const systemFindings = allFindings.filter(
    (f) =>
      (f.source_type === "ai_review" && f.source_id != null && reviewIds.has(f.source_id)) ||
      (f.source_type === "ai_governance_review" && f.source_id != null && assessmentIds.has(f.source_id))
  );

  const openFindings = systemFindings.filter((f) => f.status === "open");

  // Track which assessments have findings (for "Finding created" indicator).
  const assessmentIdsWithFindings = new Set<string>();
  for (const f of systemFindings) {
    if (f.source_type === "ai_governance_review" && f.source_id) {
      assessmentIdsWithFindings.add(f.source_id);
    }
  }

  const latestAssessment = assessments[0] ?? null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Back link + header */}
      <div className="mb-8">
        <Link
          href="/ai-systems"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← AI Systems
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          {system.name}
        </h1>
        {system.use_case && (
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            {system.use_case}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-8">
          <OpenFindingsSection findings={openFindings} />
          <GovernanceReviewsSection reviews={reviews} />
          <GovernanceAssessmentsSection
            assessments={assessments}
            assessmentIdsWithFindings={assessmentIdsWithFindings}
          />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <SystemDetailsCard system={system} />
          <GovernanceSummaryCard
            openFindings={openFindings}
            reviewCount={reviews.length}
            assessmentCount={assessments.length}
            latestAssessment={latestAssessment}
          />
          <ActionsCard systemId={system.id} />
        </div>
      </div>
    </div>
  );
}
