import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendor,
  getVendorAssessmentsForVendor,
  getVendorReviews,
  getVendorFindings,
  listVendorAssuranceDocuments,
  getVendorAssuranceExtraction,
  type Vendor,
  type VendorAssessment,
  type VendorReview,
  type VendorFinding,
  type VendorAssuranceDocument,
  type VendorAssuranceExtractionResponse,
} from "@/lib/api";
import { CompleteReviewSection } from "./CompleteReviewSection";
import { RecalculateScoreButton } from "./RecalculateScoreButton";
import { ArchiveVendorButton } from "./ArchiveVendorButton";

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
  Critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return null;
  const style =
    SEVERITY_STYLES[severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {severity}
    </span>
  );
}

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  near_term: { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  planned:   { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const style =
    PRIORITY_STYLES[priority] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const label = priority.replace(/_/g, " ");
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={style}
    >
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
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={style}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const REVIEW_STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress:         { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  satisfactory:        { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  concerns_identified: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  critical_issues:     { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  not_started:         "Not Started",
  in_progress:         "In Progress",
  satisfactory:        "Satisfactory",
  concerns_identified: "Concerns Identified",
  critical_issues:     "Critical Issues",
};

function ReviewStatusBadge({ status }: { status: string }) {
  const style =
    REVIEW_STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {REVIEW_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const CRITICALITY_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  high:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  medium:   { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

function CriticalityBadge({ criticality }: { criticality: string | null }) {
  if (!criticality) return <span style={{ color: "#475569" }}>—</span>;
  const style =
    CRITICALITY_STYLES[criticality] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {criticality.charAt(0).toUpperCase() + criticality.slice(1)}
    </span>
  );
}

function VendorStatusBadge({ status }: { status: string }) {
  const style: React.CSSProperties =
    status === "active"
      ? { background: "rgba(34,197,94,0.12)", color: "#86efac" }
      : { background: "rgba(148,163,184,0.12)", color: "#64748b" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={style}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

const ASSESSMENT_TYPE_LABELS: Record<string, string> = {
  initial_assessment:   "Initial Assessment",
  annual_review:        "Annual Review",
  periodic_review:      "Periodic Review",
  incident_triggered:   "Incident-Triggered Review",
  pre_contract:         "Pre-Contract Due Diligence",
  post_incident:        "Post-Incident Review",
  framework_assessment: "Framework Assessment",
};

function assessmentTypeLabel(raw: string): string {
  return ASSESSMENT_TYPE_LABELS[raw] ?? raw;
}

function OpenFindingsSectionClient({
  findings,
  vendorId,
}: {
  findings: VendorFinding[];
  vendorId: string;
}) {
  const openFindings = findings.filter((f) => f.status === "open" || f.status === "in_progress");

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Open Findings
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{
            background: openFindings.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.12)",
            color: openFindings.length > 0 ? "#fca5a5" : "#475569",
          }}
        >
          {openFindings.length}
        </span>
      </div>

      {openFindings.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>No open findings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {openFindings.map((f) => {
            const sevStyle =
              f.severity === "Critical" ? { background: "rgba(239,68,68,0.15)", color: "#fca5a5" } :
              f.severity === "High"     ? { background: "rgba(249,115,22,0.15)", color: "#fdba74" } :
              f.severity === "Moderate" ? { background: "rgba(245,158,11,0.15)", color: "#fcd34d" } :
              f.severity === "Low"      ? { background: "rgba(34,197,94,0.15)",  color: "#86efac" } :
              { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
            return (
              <div
                key={f.id}
                className="bg-brand-surface border border-brand-line rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 mt-0.5"
                    style={sevStyle}
                  >
                    {f.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-0.5" style={{ color: "#f1f5f9" }}>
                      {f.title}
                    </p>
                    {f.description && (
                      <p className="text-xs line-clamp-2" style={{ color: "#94a3b8" }}>
                        {f.description}
                      </p>
                    )}
                    <p className="text-xs mt-1" style={{ color: "#475569" }}>
                      {assessmentTypeLabel(f.assessment_type)}
                      {f.performed_at ? ` · ${fmt(f.performed_at)}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
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
  assessments: VendorAssessment[];
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
          <p className="text-sm" style={{ color: "#94a3b8" }}>No assessments recorded</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assessments.map((a) => (
            <div
              key={a.id}
              className="bg-brand-surface border border-brand-line rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <SeverityBadge severity={a.overall_severity} />
                    <span className="text-xs" style={{ color: "#94a3b8" }}>
                      {assessmentTypeLabel(a.assessment_type)}
                    </span>
                    {assessmentIdsWithFindings.has(a.id) && (
                      <span
                        className="text-xs font-medium"
                        style={{ color: "#00c4b4" }}
                      >
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
                    <p className="text-xs" style={{ color: "#475569" }}>
                      {a.notes}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-xs" style={{ color: "#475569" }}>
                    {fmt(a.performed_at)}
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
// Section: Review Cycle History
// ─────────────────────────────────────────────────────────────

function ReviewCyclesSection({ reviews }: { reviews: VendorReview[] }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Review Cycles
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
          <p className="text-sm" style={{ color: "#94a3b8" }}>No review cycles recorded</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="bg-brand-surface border border-brand-line rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <ReviewStatusBadge status={r.status} />
                    {r.overall_severity && (
                      <SeverityBadge severity={r.overall_severity} />
                    )}
                  </div>
                  {r.summary && (
                    <p className="text-xs mb-1.5" style={{ color: "#cbd5e1" }}>
                      {r.summary}
                    </p>
                  )}
                  {r.notes && (
                    <p className="text-xs" style={{ color: "#475569" }}>
                      {r.notes}
                    </p>
                  )}
                </div>
                {r.performed_at && (
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs" style={{ color: "#475569" }}>
                      {fmt(r.performed_at)}
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
// Sidebar: Vendor Details
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

function VendorDetailsCard({ vendor }: { vendor: Vendor }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="mb-4">
        <p className="text-base font-bold mb-1.5" style={{ color: "#f1f5f9" }}>
          {vendor.name}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <CriticalityBadge criticality={vendor.criticality} />
          <VendorStatusBadge status={vendor.status} />
        </div>
      </div>

      <div className="space-y-0 -mx-1 px-1">
        {vendor.data_sensitivity && (
          <DetailRow label="Data sensitivity">
            {vendor.data_sensitivity.replace(/_/g, " ")}
          </DetailRow>
        )}
        {vendor.access_level && (
          <DetailRow label="Access level">
            {vendor.access_level.replace(/_/g, " ")}
          </DetailRow>
        )}
        {vendor.category && (
          <DetailRow label="Category">{vendor.category}</DetailRow>
        )}
        {vendor.website && (
          <DetailRow label="Website">
            <a
              href={vendor.website.startsWith("http") ? vendor.website : `https://${vendor.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity truncate max-w-[140px] inline-block"
              style={{ color: "#00c4b4" }}
            >
              {vendor.website}
            </a>
          </DetailRow>
        )}
        <DetailRow label="Last reviewed">{fmt(vendor.last_reviewed_at)}</DetailRow>
        <DetailRow label="Added">{fmt(vendor.created_at)}</DetailRow>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: Risk Summary
// ─────────────────────────────────────────────────────────────

function riskScoreColor(score: number | null): string {
  if (score == null) return "#64748b";
  if (score >= 75) return "#86efac";
  if (score >= 50) return "#fcd34d";
  if (score >= 25) return "#fdba74";
  return "#fca5a5";
}

function riskLevelFromScore(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 75) return "Low Risk";
  if (score >= 50) return "Moderate Risk";
  if (score >= 25) return "High Risk";
  return "Critical Risk";
}

function RiskSummaryCard({
  vendor,
  openFindingCount,
  assessmentCount,
  reviewCount,
  lastActivityDate,
}: {
  vendor: Vendor;
  openFindingCount: number;
  assessmentCount: number;
  reviewCount: number;
  lastActivityDate: string | null;
}) {
  const score = vendor.current_risk_score ?? null;
  const scoreColor = riskScoreColor(score);
  const riskLevel = riskLevelFromScore(score);

  const riskLevelBadgeStyle: React.CSSProperties =
    riskLevel === "Low Risk"      ? { background: "rgba(34,197,94,0.15)",   color: "#86efac" } :
    riskLevel === "Moderate Risk" ? { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" } :
    riskLevel === "High Risk"     ? { background: "rgba(249,115,22,0.15)",  color: "#fdba74" } :
    riskLevel === "Critical Risk" ? { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" } :
    { background: "rgba(100,116,139,0.12)", color: "#64748b" };

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Risk Summary
      </h3>

      {/* Risk score */}
      <div className="mb-4 pb-4" style={{ borderBottom: "1px solid #1e2d45" }}>
        <p className="text-xs mb-1" style={{ color: "#475569" }}>Vendor Risk Score</p>
        <p className="text-4xl font-bold leading-none mb-2" style={{ color: scoreColor }}>
          {score != null ? score : "—"}
        </p>
        {riskLevel ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={riskLevelBadgeStyle}
          >
            {riskLevel}
          </span>
        ) : (
          <p className="text-xs" style={{ color: "#475569" }}>
            No score yet — create an assessment to compute
          </p>
        )}
      </div>

      {/* Counts */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Open findings</span>
          <span className="text-xs font-semibold" style={{ color: openFindingCount > 0 ? "#fca5a5" : "#cbd5e1" }}>
            {openFindingCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Assessments</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{assessmentCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Review cycles</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{reviewCount}</span>
        </div>
        {lastActivityDate && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Last activity</span>
            <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>{fmt(lastActivityDate)}</span>
          </div>
        )}
      </div>

      <RecalculateScoreButton vendorId={vendor.id} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: Actions
// ─────────────────────────────────────────────────────────────

function ActionsCard({
  vendorId,
  vendorName,
  vendorStatus,
}: {
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-4"
        style={{ color: "#94a3b8" }}
      >
        Actions
      </h3>
      <div className="space-y-2">
        <Link
          href={`/vendors/${vendorId}/assess`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          New Assessment
        </Link>
        <Link
          href={`/vendors/${vendorId}/review`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{
            borderColor: "#1e2d45",
            color: "#94a3b8",
            background: "transparent",
          }}
        >
          New Review Cycle
        </Link>
        <Link
          href={`/vendors/${vendorId}/findings/new`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{
            borderColor: "#1e2d45",
            color: "#94a3b8",
            background: "transparent",
          }}
        >
          Add Finding
        </Link>
        <Link
          href={`/vendors/${vendorId}/assess/framework`}
          className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{
            borderColor: "#1e2d45",
            color: "#94a3b8",
            background: "transparent",
          }}
        >
          Assess Against Framework
        </Link>
        {vendorStatus === "active" && (
          <ArchiveVendorButton vendorId={vendorId} vendorName={vendorName} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [vendor, assessmentsData, reviewsData, vendorFindingsData] = await Promise.all([
    getVendor(token, id),
    getVendorAssessmentsForVendor(token, id, 20),
    getVendorReviews(token, id, 20),
    getVendorFindings(token, id),
  ]);

  if (!vendor) redirect("/vendors");

  // Vendor-Assurance read: latest finalized document + its extraction +
  // current decision per field projected at read time. No stored snapshot.
  const assuranceDocsData = await listVendorAssuranceDocuments(token, {
    vendorId: vendor.id,
    status: "finalized",
    limit: 1,
  });
  const latestFinalizedAssuranceDoc: VendorAssuranceDocument | null =
    assuranceDocsData?.documents?.[0] ?? null;
  const latestAssuranceExtraction: VendorAssuranceExtractionResponse | null =
    latestFinalizedAssuranceDoc
      ? await getVendorAssuranceExtraction(token, latestFinalizedAssuranceDoc.id)
      : null;

  const assessments = assessmentsData?.assessments ?? [];
  const reviews = reviewsData?.reviews ?? [];
  const vendorFindings = vendorFindingsData?.findings ?? [];

  const openFindings = vendorFindings.filter(
    (f) => f.status === "open" || f.status === "in_progress"
  );
  const inProgressReviews = reviews.filter((r) => r.status === "in_progress");

  // Track which assessments produced findings (for the badge on history cards).
  const assessmentIdsWithFindings = new Set<string>(
    vendorFindings.map((f) => f.assessment_id)
  );

  // Last activity: most recent of latest assessment or review created_at.
  const latestAssessmentDate = assessments[0]?.created_at ?? null;
  const latestReviewDate = reviews[0]?.created_at ?? null;
  const lastActivityDate =
    latestAssessmentDate && latestReviewDate
      ? latestAssessmentDate > latestReviewDate
        ? latestAssessmentDate
        : latestReviewDate
      : latestAssessmentDate ?? latestReviewDate;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Back link + page header */}
      <div className="mb-8">
        <Link
          href="/vendors"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Vendors
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
              {vendor.name}
            </h1>
            {vendor.service_description && (
              <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
                {vendor.service_description}
              </p>
            )}
          </div>
          <Link
            href={`/vendors/${vendor.id}/edit`}
            className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 flex-shrink-0"
            style={{ borderColor: "#1e2d45", color: "#00c4b4", background: "transparent" }}
          >
            Edit Vendor
          </Link>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-8">
          <OpenFindingsSectionClient findings={openFindings} vendorId={vendor.id} />
          <AssessmentHistorySection
            assessments={assessments}
            assessmentIdsWithFindings={assessmentIdsWithFindings}
          />
          <ReviewCyclesSection reviews={reviews} />
          <CompleteReviewSection
            inProgressReviews={inProgressReviews}
            vendorId={vendor.id}
          />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <VendorDetailsCard vendor={vendor} />
          <RiskSummaryCard
            vendor={vendor}
            openFindingCount={openFindings.length}
            assessmentCount={assessments.length}
            reviewCount={reviews.length}
            lastActivityDate={lastActivityDate}
          />
          <ActionsCard vendorId={vendor.id} vendorName={vendor.name} vendorStatus={vendor.status} />
          <VendorAssuranceCard
            vendorId={vendor.id}
            document={latestFinalizedAssuranceDoc}
            extraction={latestAssuranceExtraction}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vendor Assurance card (Phase 1)
// Reads at request time from the latest finalized document's extraction +
// current decision per field. No stored snapshot. No write to vendor fields.
// ─────────────────────────────────────────────────────────────

const ASSURANCE_DISPLAY_FIELDS = [
  "report_type",
  "auditor_name",
  "auditor_opinion",
  "report_period_end",
  // report_freshness_days is computed at read time below
] as const;

function VendorAssuranceCard({
  vendorId,
  document,
  extraction,
}: {
  vendorId: string;
  document: VendorAssuranceDocument | null;
  extraction: VendorAssuranceExtractionResponse | null;
}) {
  const cardStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 8,
    border: "1px solid #1e2d45",
    background: "#0f172a",
    color: "#e5e7eb",
  };

  if (!document || !extraction || !extraction.extraction) {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
          Vendor Assurance
        </h3>
        <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
          No assurance documents reviewed yet.
        </p>
        <Link
          href="/vendor-assurance/queue"
          style={{ fontSize: 12, color: "#00c4b4", marginTop: 8, display: "inline-block" }}
        >
          Upload SOC report →
        </Link>
      </div>
    );
  }

  // Project current decision per field for the displayed material fields.
  const display: Array<{ name: string; rendered: string }> = [];
  for (const fieldName of ASSURANCE_DISPLAY_FIELDS) {
    const decision = extraction.current_decisions[fieldName];
    const field = extraction.extraction.fields[fieldName];
    let rendered: string;
    if (decision?.decision === "reject") {
      rendered = "(rejected)";
    } else if (decision?.decision === "edit") {
      const v = decision.reviewed_value;
      rendered = typeof v === "string" ? v : JSON.stringify(v);
    } else if (field) {
      const v = field.value;
      rendered = v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v);
    } else {
      rendered = "—";
    }
    display.push({ name: fieldName, rendered });
  }

  // report_freshness_days: derived at read time from period_end + issued_date
  // (or fall back to today when issued_date is missing).
  const periodEndField = extraction.extraction.fields["report_period_end"];
  const issuedDateField = extraction.extraction.fields["report_issued_date"];
  let freshness: string = "—";
  const periodEndStr = typeof periodEndField?.value === "string" ? periodEndField.value : null;
  const issuedDateStr = typeof issuedDateField?.value === "string" ? issuedDateField.value : null;
  if (periodEndStr) {
    const periodEnd = Date.parse(periodEndStr);
    const reference = issuedDateStr ? Date.parse(issuedDateStr) : Date.now();
    if (!Number.isNaN(periodEnd) && !Number.isNaN(reference) && reference >= periodEnd) {
      const days = Math.floor((reference - periodEnd) / (24 * 3600 * 1000));
      freshness = `${days} day${days === 1 ? "" : "s"}`;
    }
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
        Vendor Assurance — extracted (reviewed)
      </h3>
      <dl style={{ marginTop: 12, fontSize: 12 }}>
        {display.map((d) => (
          <div key={d.name} style={{ marginBottom: 8 }}>
            <dt style={{ color: "#64748b" }}>{d.name}</dt>
            <dd style={{ margin: 0, color: "#e5e7eb", wordBreak: "break-word" }}>{d.rendered}</dd>
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <dt style={{ color: "#64748b" }}>report_freshness_days</dt>
          <dd style={{ margin: 0, color: "#e5e7eb" }}>{freshness}</dd>
        </div>
      </dl>
      <Link
        href={`/vendor-assurance/${document.id}`}
        style={{ fontSize: 12, color: "#00c4b4", marginTop: 8, display: "inline-block" }}
      >
        View finalized review →
      </Link>
      <p style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>
        Vendor: {vendorId.slice(0, 8)}…
      </p>
    </div>
  );
}
