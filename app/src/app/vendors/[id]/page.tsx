import Link from "next/link";
import { isActiveStatus } from "@/app/findings/decisionQueue";
import { legacyVendorWritesEnabled, engagementCta } from "@/lib/legacyVendorWrites";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendor,
  getVendorAssessmentsForVendor,
  getVendorReviews,
  getVendorFindings,
  getVendorSignals,
  getVendorAiDependencies,
  listVendorAssuranceDocuments,
  getVendorAssuranceExtraction,
  getFrameworks,
  getFrameworkRequirements,
  type Framework,
  type FrameworkRequirements,
  type Vendor,
  type VendorAssessment,
  type VendorReview,
  type VendorFinding,
  type AiSystemLinkedSignal,
  type VendorAiDependency,
  type VendorAssuranceDocument,
  type VendorAssuranceExtractionResponse,
} from "@/lib/api";
import { HistorySection } from "@/components/HistorySection";
import { CompleteReviewSection } from "./CompleteReviewSection";
import { RecalculateScoreButton } from "./RecalculateScoreButton";
import { ArchiveVendorButton } from "./ArchiveVendorButton";
import { VendorAssuranceUploadForm } from "./VendorAssuranceUploadForm";
import { fieldLabel } from "@/lib/vendorAssurance/fieldGroups";

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
  // Not an assessment type at all — the linkage discriminator for a finding
  // promoted from a Complementary User Entity Control gap in a vendor's report.
  // It shares this field because /api/vendors/:id/findings keeps `assessment_type`
  // for wire compatibility; without an entry here the raw key rendered on screen.
  vendor_assurance_cuec: "Vendor Assurance Review",
};

function assessmentTypeLabel(raw: string): string {
  return ASSESSMENT_TYPE_LABELS[raw] ?? raw;
}

// ─────────────────────────────────────────────────────────────
// Compact empty state (V-1 layout balance)
// A sparse vendor stacks several sections, each otherwise a tall centered
// "No X recorded" card, which reads as an unbalanced column of near-empty
// boxes against a dense sidebar. This renders empty sections as a single
// slim, quiet row instead — the sections remain, but they stop shouting.
// An optional inline action lets an empty section point at its create path.
// ─────────────────────────────────────────────────────────────

function SectionEmpty({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-xs" style={{ color: "#64748b" }}>{children}</p>
      {action && (
        <Link
          href={action.href}
          className="text-xs font-medium flex-shrink-0 transition-opacity hover:opacity-80"
          style={{ color: "#00c4b4" }}
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}

function OpenFindingsSectionClient({
  findings,
  vendorId,
}: {
  findings: VendorFinding[];
  vendorId: string;
}) {
  const activeFindings = findings.filter((f) => isActiveStatus(f.status));

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Active Findings
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{
            background: activeFindings.length > 0 ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.12)",
            color: activeFindings.length > 0 ? "#fca5a5" : "#475569",
          }}
        >
          {activeFindings.length}
        </span>
      </div>

      {activeFindings.length === 0 ? (
        <SectionEmpty
          action={
            legacyVendorWritesEnabled()
              ? { href: `/vendors/${vendorId}/assess`, label: "Run an assessment" }
              : engagementCta(vendorId)
          }
        >
          No active findings for this vendor — findings appear here when an
          assessment, review cycle, or engagement identifies an issue.
        </SectionEmpty>
      ) : (
        <div className="space-y-3">
          {activeFindings.map((f) => {
            const sevStyle =
              f.severity === "Critical" ? { background: "rgba(239,68,68,0.15)", color: "#fca5a5" } :
              f.severity === "High"     ? { background: "rgba(249,115,22,0.15)", color: "#fdba74" } :
              f.severity === "Moderate" ? { background: "rgba(245,158,11,0.15)", color: "#fcd34d" } :
              f.severity === "Low"      ? { background: "rgba(34,197,94,0.15)",  color: "#86efac" } :
              { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
            // The card links to the finding's own workflow page — these were
            // static divs, the only findings anywhere in the app you could see
            // but not open (the AI-system page's cards have always linked).
            return (
              <Link
                key={f.id}
                href={`/findings/${f.id}`}
                className="block bg-brand-surface border border-brand-line rounded-xl p-4 transition-colors hover:border-teal-700/60 group"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 mt-0.5"
                    style={sevStyle}
                  >
                    {f.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-0.5 group-hover:text-teal-300 transition-colors" style={{ color: "#f1f5f9" }}>
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
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Framework Assessments (per-vendor progress)
// ─────────────────────────────────────────────────────────────

type VendorFrameworkProgress = {
  framework: Framework;
  summary: FrameworkRequirements["summary"];
};

/** date-only render of an ISO timestamp; em-dash when absent. */
function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function FrameworkAssessmentsSection({
  progress,
  vendorId,
}: {
  progress: VendorFrameworkProgress[];
  vendorId: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Framework Assessments
        </h2>
      </div>
      {/* O-5: this is assessment PROGRESS — how much of the questionnaire has
          been answered for THIS vendor. It is not readiness and not the vendor
          risk score; the bar stays a single neutral color so completion can
          never read as a verdict. */}
      {progress.length === 0 ? (
        <SectionEmpty
          action={{ href: `/vendors/${vendorId}/assess/framework`, label: "Assess against a framework" }}
        >
          No framework assessments started for this vendor
        </SectionEmpty>
      ) : (
        <div className="space-y-3">
          {progress.map(({ framework, summary }) => {
            const assessed = summary.total - summary.not_assessed;
            return (
              <div
                key={framework.id}
                className="bg-brand-surface border border-brand-line rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                      {framework.name}{" "}
                      <span style={{ color: "#475569" }}>v{framework.version}</span>
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                      {assessed} of {summary.total} requirements assessed ·{" "}
                      {summary.progress_pct}% — completion, not readiness
                    </p>
                  </div>
                  <Link
                    href={`/vendors/${vendorId}/assess/framework?frameworkId=${framework.id}`}
                    className="text-xs font-medium hover:underline flex-shrink-0"
                    style={{ color: "#00c4b4" }}
                  >
                    Continue assessment →
                  </Link>
                </div>
                <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${summary.progress_pct}%`, background: "#00c4b4" }}
                  />
                </div>
                <p className="text-xs mt-2" style={{ color: "#475569" }}>
                  Last updated: {fmtDateOnly(summary.last_response_at)}
                </p>
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
  vendorId,
}: {
  assessments: VendorAssessment[];
  assessmentIdsWithFindings: Set<string>;
  vendorId: string;
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
        <SectionEmpty
          action={
            legacyVendorWritesEnabled()
              ? { href: `/vendors/${vendorId}/assess`, label: "New assessment" }
              : engagementCta(vendorId)
          }
        >
          No assessments recorded
        </SectionEmpty>
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

function ReviewCyclesSection({
  reviews,
  vendorId,
}: {
  reviews: VendorReview[];
  vendorId: string;
}) {
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
        <SectionEmpty
          action={
            legacyVendorWritesEnabled()
              ? { href: `/vendors/${vendorId}/review`, label: "Start a review cycle" }
              : engagementCta(vendorId)
          }
        >
          No review cycles recorded
        </SectionEmpty>
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
        {/* NO "Last reviewed" ROW. It rendered unconditionally from
            `vendor.last_reviewed_at`, which nothing in the product writes —
            so it was an em dash on every vendor in every org, directly
            above an Assessment History section listing real dates. Retired
            under the ratified ruling that "reviewed" is not a valid
            customer-facing vendor metric; assessment recency belongs to the
            Assessment History section and the sidebar Assessments count,
            both of which read `vendor_assessments`. Do not reinstate. */}
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

// The order the engine's pure formula (src/api/lib/vendorRiskScore.ts) weights
// open findings by. Used only to render the SAME factors the engine scored on —
// this never recomputes or changes the score itself.
const FINDING_SEVERITY_ORDER = ["Critical", "High", "Moderate", "Low"] as const;

// V-4: explain the score the engine already returned in terms of the two inputs
// the page already holds — the vendor's criticality and its open findings by
// severity — so the number is attributable, not opaque. Null-safe: a vendor with
// no criticality and no findings still yields a truthful sentence.
function riskScoreDerivation(
  criticality: string | null,
  severityCounts: Record<string, number>,
  totalOpenFindings: number,
): string {
  const critLabel = criticality
    ? criticality.charAt(0).toUpperCase() + criticality.slice(1)
    : "unspecified";

  const breakdown = FINDING_SEVERITY_ORDER
    .filter((s) => (severityCounts[s] ?? 0) > 0)
    .map((s) => `${severityCounts[s]} ${s}`)
    .join(", ");

  const findingsPhrase =
    totalOpenFindings === 0
      ? "no open findings"
      : `${totalOpenFindings} open finding${totalOpenFindings === 1 ? "" : "s"}` +
        (breakdown ? ` (${breakdown})` : "");

  return `Based on ${critLabel} criticality and ${findingsPhrase}.`;
}

function RiskSummaryCard({
  vendor,
  activeFindingCount,
  findingSeverityCounts,
  assessmentCount,
  reviewCount,
  lastActivityDate,
}: {
  vendor: Vendor;
  activeFindingCount: number;
  findingSeverityCounts: Record<string, number>;
  assessmentCount: number;
  reviewCount: number;
  lastActivityDate: string | null;
}) {
  const score = vendor.current_risk_score ?? null;
  const scoreColor = riskScoreColor(score);
  const riskLevel = riskLevelFromScore(score);
  const derivation = riskScoreDerivation(
    vendor.criticality,
    findingSeverityCounts,
    activeFindingCount,
  );

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
        {/* V-4: attribute the score to the factors the engine weighted it on. */}
        {score != null && (
          <div className="mt-3">
            <p className="text-xs font-medium mb-0.5" style={{ color: "#64748b" }}>
              How this score is derived
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
              {derivation}
            </p>
          </div>
        )}
      </div>

      {/* Counts */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Active findings</span>
          <span className="text-xs font-semibold" style={{ color: activeFindingCount > 0 ? "#fca5a5" : "#cbd5e1" }}>
            {activeFindingCount}
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
        {legacyVendorWritesEnabled() ? (
          <>
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
          </>
        ) : (
          <Link
            href={engagementCta(vendorId).href}
            className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            Open an Engagement
          </Link>
        )}
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

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [vendor, assessmentsData, reviewsData, vendorFindingsData, linkedSignals, aiDeps] = await Promise.all([
    getVendor(token, id),
    getVendorAssessmentsForVendor(token, id, 20),
    getVendorReviews(token, id, 20),
    getVendorFindings(token, id),
    // External intelligence: the DETERMINISTIC accepted vendor↔signal links
    // (EG2 slice 9). This replaces the previous synchronous LLM call on every
    // page load, whose rows had no id, date, source, or link and whose output
    // changed between refreshes — on exactly the surface a CISO judges the
    // "vendor intelligence" claim by. The LLM analysis remains on the assess
    // flow, where its suggested-finding output is actually consumed.
    getVendorSignals(token, id, 10),
    // Concentration signal: which AI systems depend on this vendor.
    getVendorAiDependencies(token, id),
  ]);

  if (!vendor) redirect("/vendors");

  // Framework assessment progress for THIS vendor: activated frameworks with
  // at least one recorded response. Answered here means the vendor-scoped
  // questionnaire (assessment_type='vendor', subject_id=vendor) — a separate
  // truth from org readiness and from the vendor risk score (O-5).
  const frameworksData = await getFrameworks(token);
  const activeFrameworks = frameworksData?.frameworks ?? [];
  const frameworkProgress: VendorFrameworkProgress[] = (
    await Promise.all(
      activeFrameworks.map(async (fw) => {
        const reqs = await getFrameworkRequirements(token, fw.id, "vendor", vendor.id);
        if (!reqs || reqs.summary.total === 0) return null;
        // Only frameworks where this vendor's assessment has started — an
        // untouched framework belongs behind the "Assess against a framework"
        // CTA, not as a wall of 0% rows.
        if (reqs.summary.total - reqs.summary.not_assessed === 0) return null;
        return { framework: fw, summary: reqs.summary };
      })
    )
  ).filter((p): p is VendorFrameworkProgress => p !== null);

  // Vendor-Assurance read: latest REVIEWED document + its extraction, with the
  // current value per field projected at read time. No stored snapshot.
  //
  // `status: "reviewed"` is the canonical predicate (approved OR finalized).
  // This previously read `status: "finalized"` — a state migration 20260612
  // retired and that no current code path writes, so the card rendered its
  // empty state forever no matter how many SOC reports a reviewer approved.
  const assuranceDocsData = await listVendorAssuranceDocuments(token, {
    vendorId: vendor.id,
    status: "reviewed",
    limit: 1,
  });
  const latestReviewedAssuranceDoc: VendorAssuranceDocument | null =
    assuranceDocsData?.documents?.[0] ?? null;
  const latestAssuranceExtraction: VendorAssuranceExtractionResponse | null =
    latestReviewedAssuranceDoc
      ? await getVendorAssuranceExtraction(token, latestReviewedAssuranceDoc.id)
      : null;

  const assessments = assessmentsData?.assessments ?? [];
  const reviews = reviewsData?.reviews ?? [];
  const vendorFindings = vendorFindingsData?.findings ?? [];

  const activeFindings = vendorFindings.filter(
    (f) => isActiveStatus(f.status)
  );
  // Open findings by severity — the finding half of the vendor risk-score
  // derivation (V-4). Built from data already on the page; no extra fetch.
  const findingSeverityCounts = activeFindings.reduce<Record<string, number>>(
    (acc, f) => {
      const sev = f.severity ?? "";
      if (sev) acc[sev] = (acc[sev] ?? 0) + 1;
      return acc;
    },
    {}
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
          <OpenFindingsSectionClient findings={activeFindings} vendorId={vendor.id} />
          <ExternalIntelligenceSection
            signals={linkedSignals}
            vendorId={vendor.id}
            vendorName={vendor.name}
          />
          <FrameworkAssessmentsSection progress={frameworkProgress} vendorId={vendor.id} />
          <AssessmentHistorySection
            assessments={assessments}
            assessmentIdsWithFindings={assessmentIdsWithFindings}
            vendorId={vendor.id}
          />
          <ReviewCyclesSection reviews={reviews} vendorId={vendor.id} />
          {legacyVendorWritesEnabled() ? (
            <CompleteReviewSection
              inProgressReviews={inProgressReviews}
              vendorId={vendor.id}
            />
          ) : (
            inProgressReviews.length > 0 && (
              <div
                className="bg-brand-surface border border-brand-line rounded-xl p-5 text-sm"
                style={{ color: "#94a3b8" }}
              >
                {inProgressReviews.length} in-progress review
                {inProgressReviews.length === 1 ? "" : "s"} remain
                {inProgressReviews.length === 1 ? "s" : ""} read-only — the
                review-cycle workflow has been retired. Continue this vendor's
                assurance in{" "}
                <Link
                  href={engagementCta(vendor.id).href}
                  style={{ color: "#00c4b4" }}
                >
                  an engagement
                </Link>
                .
              </div>
            )
          )}
          <HistorySection resourcePath="vendors" resourceId={vendor.id} />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <VendorDetailsCard vendor={vendor} />
          <DependentAiSystemsCard dependencies={aiDeps} />
          {/* The enterprise graph could always answer "what depends on this
              vendor" but was reachable only via the Assets row — never from
              the page a TPRM analyst actually lives on. Same flag gate as the
              asset page's link. */}
          {process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED === "true" && (
            <Link
              href={`/enterprise-context/graph?node_type=vendor&node_id=${encodeURIComponent(vendor.id)}`}
              className="block text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              View relationships in the enterprise graph →
            </Link>
          )}
          <RiskSummaryCard
            vendor={vendor}
            activeFindingCount={activeFindings.length}
            findingSeverityCounts={findingSeverityCounts}
            assessmentCount={assessments.length}
            reviewCount={reviews.length}
            lastActivityDate={lastActivityDate}
          />
          <ActionsCard vendorId={vendor.id} vendorName={vendor.name} vendorStatus={vendor.status} />
          <VendorAssuranceCard
            vendorId={vendor.id}
            document={latestReviewedAssuranceDoc}
            extraction={latestAssuranceExtraction}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// External Intelligence (EG2 slice 9): the DETERMINISTIC accepted
// vendor↔signal links, dated, sourced, and drillable — mirroring the
// AI-system section so the two sibling surfaces agree on what "linked
// intelligence" looks like. Replaces the per-pageload LLM summary whose rows
// had no id, date, or link and changed between refreshes.
// ─────────────────────────────────────────────────────────────

const SIGNAL_SEV_COLOR: Record<string, string> = {
  critical: "#fca5a5",
  high: "#fdba74",
  moderate: "#fcd34d",
  medium: "#fcd34d",
  low: "#86efac",
};

function ExternalIntelligenceSection({
  signals,
  vendorId,
  vendorName,
}: {
  /** null = the read FAILED — render an outage note, never a clean vendor. */
  signals: AiSystemLinkedSignal[] | null;
  vendorId: string;
  vendorName: string;
}) {
  if (signals === null) {
    return (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
          External Intelligence
        </h2>
        <div
          className="rounded-lg border px-4 py-3"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(239,68,68,0.25)" }}
        >
          <p className="text-xs leading-relaxed" style={{ color: "#fca5a5" }}>
            Could not load this vendor&apos;s linked intelligence right now — this
            does not mean the vendor is clear. Refresh to try again.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          External Intelligence
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{
            background: signals.length > 0 ? "rgba(245,158,11,0.15)" : "rgba(148,163,184,0.12)",
            color: signals.length > 0 ? "#fcd34d" : "#475569",
          }}
        >
          {signals.length}
        </span>
      </div>
      {signals.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3">
          <p className="text-xs leading-relaxed" style={{ color: "#64748b" }}>
            No confirmed external signals are linked to this vendor. New matches
            appear in the{" "}
            <Link
              href={`/queue?target_type=vendor&q=${encodeURIComponent(vendorName)}`}
              style={{ color: "#93c5fd" }}
            >
              review queue
            </Link>{" "}
            for confirmation — accepted links show here with their dates and sources.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div
              key={s.link_id}
              className="rounded-lg border p-3"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "#1e2d45" }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {s.severity && (
                  <span
                    className="text-xs font-semibold"
                    style={{ color: SIGNAL_SEV_COLOR[s.severity.toLowerCase()] ?? "#94a3b8" }}
                  >
                    {s.severity}
                  </span>
                )}
                {s.affected_cve && (
                  <span className="text-xs" style={{ color: "#94a3b8" }}>{s.affected_cve}</span>
                )}
                <span className="text-xs ml-auto" style={{ color: "#475569" }}>
                  linked {fmt(s.link_created_at)}
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
                {s.event_summary ?? s.normalized_summary ?? "External signal"}
              </p>
              {s.intelligence_event_id && (
                <Link
                  href={`/intelligence/${encodeURIComponent(s.intelligence_event_id)}`}
                  className="text-xs"
                  style={{ color: "#93c5fd" }}
                >
                  View intelligence event →
                </Link>
              )}
            </div>
          ))}
          <div className="flex items-center gap-4">
            <Link
              href={
                legacyVendorWritesEnabled()
                  ? `/vendors/${vendorId}/assess`
                  : engagementCta(vendorId).href
              }
              className="inline-block text-xs font-medium"
              style={{ color: "#00c4b4" }}
            >
              Reassess with this intelligence →
            </Link>
            <Link
              href={`/queue?target_type=vendor&q=${encodeURIComponent(vendorName)}`}
              className="inline-block text-xs font-medium"
              style={{ color: "#93c5fd" }}
            >
              Review suggested links →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Dependent AI Systems (W5 read-surface wiring): the reverse supply-chain
// edge — which AI systems break if this vendor does (concentration risk).
// ─────────────────────────────────────────────────────────────

const DEP_ROLE_LABELS: Record<string, string> = {
  model_provider: "Model provider",
  runtime: "Runtime",
  registry: "Registry",
  training_data: "Training data",
};

function DependentAiSystemsCard({ dependencies }: { dependencies: VendorAiDependency[] }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e2d45" }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#64748b" }}>
        Dependent AI Systems ({dependencies.length})
      </h3>
      {dependencies.length === 0 ? (
        <p className="text-xs" style={{ color: "#475569" }}>
          No AI systems record a dependency on this vendor. Dependencies are
          declared on an AI system's detail page —{" "}
          <Link href="/ai-systems" style={{ color: "#93c5fd" }}>
            review your AI inventory
          </Link>{" "}
          if this vendor powers one.
        </p>
      ) : (
        <div className="space-y-2">
          {dependencies.map((d) => (
            <div key={d.dependency_id} className="flex items-center gap-2 text-sm">
              <Link href={`/ai-systems/${d.ai_system_id}`} style={{ color: "#93c5fd" }}>
                {d.ai_system_name}
              </Link>
              <span className="text-xs ml-auto" style={{ color: "#64748b" }}>
                {DEP_ROLE_LABELS[d.dependency_role] ?? d.dependency_role}
              </span>
            </div>
          ))}
        </div>
      )}
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
          No assurance documents reviewed yet. Upload a SOC report to begin
          extraction and review.
        </p>
        <VendorAssuranceUploadForm vendorId={vendorId} />
        <Link
          href="/vendor-assurance/queue"
          style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, display: "inline-block" }}
        >
          View review queue →
        </Link>
      </div>
    );
  }

  // Project the CURRENT value per displayed material field.
  //
  // Precedence, highest first:
  //   1. field_overrides  — the live mechanism (migration 20260612). Append-only;
  //      the engine already projects the latest row per field, so the array holds
  //      at most one entry per field_name.
  //   2. current_decisions — the LEGACY per-field accept/edit/reject store, torn
  //      out at the UI layer by the same migration. Still honoured so documents
  //      reviewed under the old flow render their reviewed values rather than
  //      silently reverting to the raw extraction.
  //   3. the raw extracted value.
  //
  // This card previously consulted only (2), so on the current flow every
  // reviewer override was invisible here and the pre-override extraction was
  // shown as if it were the accepted value.
  const overrideByField = new Map(
    (extraction.field_overrides ?? []).map((o) => [o.field_name, o])
  );

  const renderValue = (v: unknown): string =>
    v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v);

  const display: Array<{ name: string; rendered: string; overridden: boolean }> = [];
  for (const fieldName of ASSURANCE_DISPLAY_FIELDS) {
    const override = overrideByField.get(fieldName);
    const decision = extraction.current_decisions[fieldName];
    const field = extraction.extraction.fields[fieldName];

    let rendered: string;
    let overridden = false;
    if (override) {
      rendered = renderValue(override.override_value);
      overridden = true;
    } else if (decision?.decision === "reject") {
      rendered = "(rejected)";
    } else if (decision?.decision === "edit") {
      rendered = renderValue(decision.reviewed_value);
    } else if (field) {
      rendered = renderValue(field.value);
    } else {
      rendered = "—";
    }
    display.push({ name: fieldName, rendered, overridden });
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
            <dt style={{ color: "#64748b" }}>
              {fieldLabel(d.name)}
              {d.overridden && (
                <span
                  title="A reviewer corrected this value"
                  style={{ marginLeft: 6, fontSize: 10, color: "#fbbf24" }}
                >
                  corrected
                </span>
              )}
            </dt>
            <dd style={{ margin: 0, color: "#e5e7eb", wordBreak: "break-word" }}>{d.rendered}</dd>
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <dt style={{ color: "#64748b" }}>Report age at issue</dt>
          <dd style={{ margin: 0, color: "#e5e7eb" }}>{freshness}</dd>
        </div>
      </dl>
      <Link
        href={`/vendor-assurance/${document.id}`}
        style={{ fontSize: 12, color: "#00c4b4", marginTop: 8, display: "inline-block" }}
      >
        View reviewed report →
      </Link>
    </div>
  );
}
