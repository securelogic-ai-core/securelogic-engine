import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendor,
  getVendorAssessmentsForVendor,
  getVendorReviews,
  getFindings,
  type Vendor,
  type VendorAssessment,
  type VendorReview,
  type Finding,
} from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import { CompleteReviewSection } from "./CompleteReviewSection";

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

function OpenFindingsSectionClient({
  findings,
  vendorId,
}: {
  findings: Finding[];
  vendorId: string;
}) {
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
            <FindingCard key={f.id} finding={f} revalidateUrl={`/vendors/${vendorId}`} />
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
                      {a.assessment_type}
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

function riskSummaryColor(openFindings: Finding[]): string {
  if (openFindings.some((f) => f.severity === "Critical")) return "#fca5a5";
  if (openFindings.some((f) => f.severity === "High")) return "#fdba74";
  if (openFindings.some((f) => f.severity === "Moderate")) return "#fcd34d";
  if (openFindings.length > 0) return "#86efac";
  return "#00c4b4";
}

function RiskSummaryCard({
  openFindings,
  assessmentCount,
  reviewCount,
  lastActivityDate,
}: {
  openFindings: Finding[];
  assessmentCount: number;
  reviewCount: number;
  lastActivityDate: string | null;
}) {
  const countColor = riskSummaryColor(openFindings);

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-4"
        style={{ color: "#94a3b8" }}
      >
        Risk Summary
      </h3>

      <div className="mb-4">
        <p
          className="text-4xl font-bold leading-none"
          style={{ color: countColor }}
        >
          {openFindings.length}
        </p>
        <p className="text-xs mt-1" style={{ color: "#475569" }}>
          open finding{openFindings.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Assessments</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>
            {assessmentCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Review cycles</span>
          <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>
            {reviewCount}
          </span>
        </div>
        {lastActivityDate && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Last activity</span>
            <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>
              {fmt(lastActivityDate)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar: Actions
// ─────────────────────────────────────────────────────────────

function ActionsCard({ vendorId }: { vendorId: string }) {
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

  const [vendor, assessmentsData, reviewsData, findingsData] = await Promise.all([
    getVendor(token, id),
    getVendorAssessmentsForVendor(token, id, 20),
    getVendorReviews(token, id, 20),
    getFindings(token, { domain: "Vendor Risk", limit: 100 }),
  ]);

  if (!vendor) redirect("/vendors");

  const assessments = assessmentsData?.assessments ?? [];
  const reviews = reviewsData?.reviews ?? [];
  const allFindings = findingsData?.findings ?? [];

  // Filter findings to those linked to this vendor's assessments or reviews.
  const assessmentIds = new Set(assessments.map((a) => a.id));
  const reviewIds = new Set(reviews.map((r) => r.id));

  const vendorFindings = allFindings.filter(
    (f) =>
      (f.source_type === "vendor_review" && f.source_id != null && assessmentIds.has(f.source_id)) ||
      (f.source_type === "vendor_cycle_review" && f.source_id != null && reviewIds.has(f.source_id))
  );

  const openFindings = vendorFindings.filter((f) => f.status === "open");
  const inProgressReviews = reviews.filter((r) => r.status === "in_progress");

  // Track which assessments/reviews produced findings.
  const assessmentIdsWithFindings = new Set<string>();
  for (const f of vendorFindings) {
    if (f.source_type === "vendor_review" && f.source_id) {
      assessmentIdsWithFindings.add(f.source_id);
    }
  }

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
            openFindings={openFindings}
            assessmentCount={assessments.length}
            reviewCount={reviews.length}
            lastActivityDate={lastActivityDate}
          />
          <ActionsCard vendorId={vendor.id} />
        </div>
      </div>
    </div>
  );
}
