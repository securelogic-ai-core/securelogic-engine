import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getObligation,
  getObligationAssessments,
  getFindings,
  getObligationMappings,
  getFrameworks,
  getFrameworkReadiness,
  getEvidence,
  type Obligation,
  type ObligationAssessment,
  type Evidence,
  type Finding,
  type Framework,
  type ReadinessRequirement,
} from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import { AssessmentStatusCard } from "./AssessmentStatusCard";
import {
  ObligationFrameworkMappingsCard,
  type ObligationMappedRequirement,
} from "./FrameworkMappingsCard";
import { EvidenceSection } from "./EvidenceSection";

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
  not_started:          { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress:          { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  compliant:            { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  non_compliant:        { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  partially_compliant:  { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
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

const OBLIGATION_STATUS_STYLES: Record<string, React.CSSProperties> = {
  active:         { background: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  waived:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  not_applicable: { background: "rgba(71,85,105,0.3)",    color: "#64748b" },
};

function ObligationStatusBadge({ status }: { status: string }) {
  const style = OBLIGATION_STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const labels: Record<string, string> = { active: "Active", waived: "Waived", not_applicable: "Not Applicable" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {labels[status] ?? status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Open Findings
// ─────────────────────────────────────────────────────────────

function OpenFindingsSection({ findings, obligationId }: { findings: Finding[]; obligationId: string }) {
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
          <p className="text-sm" style={{ color: "#94a3b8" }}>No open findings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} revalidateUrl={`/obligations/${obligationId}`} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Assessment History
// ─────────────────────────────────────────────────────────────

function AssessmentHistorySection({
  assessments,
  assessmentIdsWithFindings,
}: {
  assessments: ObligationAssessment[];
  assessmentIdsWithFindings: Set<string>;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Assessment History
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
          <p className="text-sm" style={{ color: "#94a3b8" }}>No assessments recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assessments.map((a) => (
            <div key={a.id} className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
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
                    <p className="text-xs" style={{ color: "#94a3b8" }}>
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
// Sidebar
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

function ObligationDetailsCard({ obligation }: { obligation: Obligation }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="mb-4">
        <p className="text-base font-bold mb-1.5" style={{ color: "#f1f5f9" }}>
          {obligation.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <ObligationStatusBadge status={obligation.status} />
          {obligation.priority && <PriorityBadge priority={obligation.priority} />}
        </div>
      </div>

      <div className="space-y-0 -mx-1 px-1">
        {obligation.source_regulation && (
          <DetailRow label="Regulation">{obligation.source_regulation}</DetailRow>
        )}
        {obligation.domain && (
          <DetailRow label="Domain">{obligation.domain}</DetailRow>
        )}
        {obligation.due_date && (
          <DetailRow label="Due date">{fmt(obligation.due_date)}</DetailRow>
        )}
        <DetailRow label="Added">{fmt(obligation.created_at)}</DetailRow>
      </div>

      {obligation.notes && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e2d45" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#475569" }}>Notes</p>
          <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
            {obligation.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function complianceSummaryColor(openFindings: Finding[]): string {
  if (openFindings.some((f) => f.severity === "Critical")) return "#fca5a5";
  if (openFindings.some((f) => f.severity === "High"))     return "#fdba74";
  if (openFindings.some((f) => f.severity === "Moderate")) return "#fcd34d";
  if (openFindings.length > 0) return "#86efac";
  return "#00c4b4";
}

function ComplianceSummaryCard({
  openFindings,
  assessmentCount,
  latestAssessment,
}: {
  openFindings: Finding[];
  assessmentCount: number;
  latestAssessment: ObligationAssessment | null;
}) {
  const countColor = complianceSummaryColor(openFindings);
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Compliance Summary
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
          <span className="text-xs" style={{ color: "#94a3b8" }}>Assessments</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{assessmentCount}</span>
        </div>
        {latestAssessment && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Latest status</span>
            <AssessmentStatusBadge status={latestAssessment.status} />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionsCard({ obligationId }: { obligationId: string }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Actions
      </h3>
      <div className="space-y-2">
        <Link
          href={`/obligations/${obligationId}/assess`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          New Assessment
        </Link>
        <Link
          href={`/obligations/${obligationId}/evidence/new`}
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

export default async function ObligationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [obligation, assessmentsData, findingsData, obligationMappingsData, frameworksData] =
    await Promise.all([
      getObligation(token, id),
      getObligationAssessments(token, id, 20),
      getFindings(token, { source_type: "obligation_review", limit: 100 }),
      getObligationMappings(token, { obligation_id: id, limit: 100 }),
      getFrameworks(token),
    ]);

  if (!obligation) redirect("/obligations");

  const assessments = assessmentsData?.assessments ?? [];
  const latestAssessmentForEvidence = assessments[0] ?? null;

  const evidenceData = latestAssessmentForEvidence
    ? await getEvidence(token, "obligation_review", latestAssessmentForEvidence.id)
    : null;
  const latestEvidence: Evidence[] = evidenceData?.evidence ?? [];

  const allFindings = findingsData?.findings ?? [];
  const frameworks: Framework[] = frameworksData?.frameworks ?? [];

  // Fetch readiness per framework for the add-mapping picker
  const readinessResults = await Promise.all(
    frameworks.map((f) => getFrameworkReadiness(token, f.id))
  );
  const allRequirementsByFramework: Record<string, ReadinessRequirement[]> = {};
  frameworks.forEach((f, i) => {
    const r = readinessResults[i];
    if (r) allRequirementsByFramework[f.id] = r.requirements;
  });

  // Build a framework id → name map for enriching obligation mappings
  const frameworkNameById = new Map(frameworks.map((f) => [f.id, f.name]));

  // Enrich obligation mappings — the GET ?obligation_id route includes nested requirement
  const mappedRequirements: ObligationMappedRequirement[] =
    (obligationMappingsData?.obligation_mappings ?? [])
      .filter((m) => m.requirement != null)
      .map((m) => ({
        mappingId: m.id,
        requirementId: m.requirement_id,
        referenceId: m.requirement!.reference_id,
        title: m.requirement!.title,
        frameworkId: m.requirement!.framework_id,
        frameworkName: frameworkNameById.get(m.requirement!.framework_id) ?? "Unknown framework",
      }));

  // Findings link to assessment IDs (source_id = assessment.id).
  const assessmentIds = new Set(assessments.map((a) => a.id));
  const obligationFindings = allFindings.filter(
    (f) => f.source_type === "obligation_review" && f.source_id !== null && assessmentIds.has(f.source_id)
  );
  const openFindings = obligationFindings.filter((f) => f.status === "open");

  const assessmentIdsWithFindings = new Set<string>();
  for (const f of obligationFindings) {
    if (f.source_id) assessmentIdsWithFindings.add(f.source_id);
  }

  const latestAssessment = assessments[0] ?? null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Back link + header */}
      <div className="mb-8">
        <Link
          href="/obligations"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Obligations
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          {obligation.title}
        </h1>
        {obligation.source_regulation && (
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            {obligation.source_regulation}
          </p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-8">
          <OpenFindingsSection findings={openFindings} obligationId={obligation.id} />
          <AssessmentHistorySection
            assessments={assessments}
            assessmentIdsWithFindings={assessmentIdsWithFindings}
          />
          <EvidenceSection
            assessmentId={latestAssessmentForEvidence?.id ?? null}
            evidence={latestEvidence}
            obligationId={obligation.id}
          />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <ObligationDetailsCard obligation={obligation} />
          <ComplianceSummaryCard
            openFindings={openFindings}
            assessmentCount={assessments.length}
            latestAssessment={latestAssessment}
          />
          {latestAssessment && (
            <AssessmentStatusCard assessment={latestAssessment} obligationId={obligation.id} />
          )}
          <ObligationFrameworkMappingsCard
            obligationId={obligation.id}
            mappedRequirements={mappedRequirements}
            frameworks={frameworks.map((f) => ({ id: f.id, name: f.name }))}
            allRequirementsByFramework={allRequirementsByFramework}
          />
          <ActionsCard obligationId={obligation.id} />
        </div>
      </div>
    </div>
  );
}
