import Link from "next/link";
import { isActiveStatus } from "@/app/findings/decisionQueue";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getAiSystem,
  getGovernanceReviewsForSystem,
  getAiGovernanceAssessments,
  getAiSystemFindings,
  getAiSystemSignals,
  getAiSystemVendorDependencies,
  type AiSystem,
  type GovernanceReview,
  type AiGovernanceAssessment,
  type Finding,
  type AiSystemLinkedSignal,
  type AiVendorDependency,
} from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import { HistorySection } from "@/components/HistorySection";
import { AssessmentStatusCard } from "./AssessmentStatusCard";

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
// Section: Active Findings
// ─────────────────────────────────────────────────────────────

function OpenFindingsSection({
  findings,
  count,
  unavailable,
  systemId,
}: {
  findings: Finding[];
  /** The engine's COUNT over the whole matched set — not `findings.length`, which is a page. */
  count: number;
  unavailable: boolean;
  systemId: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Active Findings
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{
            background: count > 0 ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.12)",
            color: count > 0 ? "#fca5a5" : "#475569",
          }}
        >
          {unavailable ? "—" : count}
        </span>
      </div>

      {unavailable ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          {/* Could not resolve — this is not a zero. Saying "no active findings" here would
              be the same lie the truncation used to tell, with a different cause. */}
          <p className="text-sm" style={{ color: "#fbbf24" }}>
            Could not load findings for this AI system. This is not a zero — retry, or
            escalate if it persists.
          </p>
        </div>
      ) : findings.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>No active findings for this AI system.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} revalidateUrl={`/ai-systems/${systemId}`} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Governance Reviews (immutable)
// ─────────────────────────────────────────────────────────────

function GovernanceReviewsSection({
  reviews,
  reviewIdsWithFindings,
}: {
  reviews: GovernanceReview[];
  reviewIdsWithFindings: Set<string>;
}) {
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
                    {/* Gated on a finding that actually exists, exactly as the
                        assessments section below already does. Rendered unconditionally,
                        this told an auditor a finding had been raised by a review that
                        produced none — a fabricated linkage claim on a governance surface. */}
                    {reviewIdsWithFindings.has(r.id) && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        style={{ background: "rgba(0,196,180,0.12)", color: "#00c4b4" }}
                      >
                        Finding created
                      </span>
                    )}
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

function governanceSummaryColor(activeFindings: Finding[]): string {
  if (activeFindings.some((f) => f.severity === "Critical")) return "#fca5a5";
  if (activeFindings.some((f) => f.severity === "High"))     return "#fdba74";
  if (activeFindings.some((f) => f.severity === "Moderate")) return "#fcd34d";
  if (activeFindings.length > 0) return "#86efac";
  return "#00c4b4";
}

function GovernanceSummaryCard({
  activeFindings,
  count,
  unavailable,
  reviewCount,
  assessmentCount,
  latestAssessment,
}: {
  /** The rows on this page — used ONLY to tone the number by severity, never to count it. */
  activeFindings: Finding[];
  count: number;
  unavailable: boolean;
  reviewCount: number;
  assessmentCount: number;
  latestAssessment: AiGovernanceAssessment | null;
}) {
  const countColor = governanceSummaryColor(activeFindings);

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Governance Summary
      </h3>

      <div className="mb-4">
        {/* The engine's COUNT, not the length of the rows rendered beside it. */}
        <p className="text-4xl font-bold leading-none" style={{ color: unavailable ? "#fbbf24" : countColor }}>
          {unavailable ? "—" : count}
        </p>
        <p className="text-xs mt-1" style={{ color: "#475569" }}>
          {unavailable ? "findings unavailable" : `active finding${count !== 1 ? "s" : ""}`}
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
// Section: External Intelligence (linked signals — W6 read-surface wiring)
// ─────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: "#fca5a5",
  high: "#fdba74",
  moderate: "#fcd34d",
  medium: "#fcd34d",
  low: "#86efac",
};

function ExternalIntelligenceSection({ signals }: { signals: AiSystemLinkedSignal[] }) {
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
        <p className="text-sm" style={{ color: "#475569" }}>
          No external signals are linked to this system. New matches appear in the{" "}
          <Link href="/queue" style={{ color: "#93c5fd" }}>review queue</Link> for confirmation.
        </p>
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
                  <span className="text-xs font-semibold" style={{ color: SEV_COLOR[s.severity.toLowerCase()] ?? "#94a3b8" }}>
                    {s.severity}
                  </span>
                )}
                {s.affected_cve && <span className="text-xs" style={{ color: "#94a3b8" }}>{s.affected_cve}</span>}
                {s.source && <span className="text-xs" style={{ color: "#475569" }}>via {s.source}</span>}
                <span className="text-xs ml-auto" style={{ color: "#475569" }}>linked {fmt(s.link_created_at)}</span>
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
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Section: Vendor Dependencies (supply chain — W6 read-surface wiring)
// ─────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  model_provider: "Model provider",
  runtime: "Runtime",
  registry: "Registry",
  training_data: "Training data",
};

function VendorDependenciesCard({ dependencies }: { dependencies: AiVendorDependency[] }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.02)", borderColor: "#1e2d45" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#64748b" }}>
        Vendor Dependencies ({dependencies.length})
      </h3>
      {dependencies.length === 0 ? (
        <p className="text-xs" style={{ color: "#475569" }}>
          No vendor dependencies recorded. A model provider or runtime dependency lets vendor
          incidents cascade to this system automatically.
        </p>
      ) : (
        <div className="space-y-2">
          {dependencies.map((d) => (
            <div key={d.dependency_id} className="flex items-center gap-2 text-sm">
              <Link href={`/vendors/${d.vendor_id}`} style={{ color: "#93c5fd" }}>
                {d.vendor_name}
              </Link>
              <span className="text-xs" style={{ color: "#64748b" }}>
                {ROLE_LABELS[d.dependency_role] ?? d.dependency_role}
              </span>
              {d.vendor_criticality && (
                <span className="text-xs ml-auto" style={{ color: SEV_COLOR[d.vendor_criticality.toLowerCase()] ?? "#64748b" }}>
                  {d.vendor_criticality}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
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

  // Entitlement gate — identical to /vendors/[id], its sibling platform surface. This
  // page had none: a session alone was enough, so a free-tier caller rendered the full
  // AI-system detail. The engine still scopes by org (no cross-tenant leak), but the
  // two sibling surfaces disagreed on who may open them, and only one of them was right.
  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [system, reviewsData, assessmentsData, findingsData, linkedSignals, vendorDeps] = await Promise.all([
    getAiSystem(token, id),
    getGovernanceReviewsForSystem(token, id, 20),
    getAiGovernanceAssessments(token, id, 20),
    // Resolved in the database, scoped to THIS system. This used to be
    // getFindings(token, { limit: 50 }) — the org's findings, filtered down to this
    // system in the browser. Past 50 org findings, a system's own findings fell off
    // the end of the page before the filter ever saw them, and this page printed
    // "0 active findings" for a system that had them. A truncation is not a zero.
    getAiSystemFindings(token, id),
    getAiSystemSignals(token, id, 10),
    getAiSystemVendorDependencies(token, id),
  ]);

  if (!system) redirect("/ai-systems");

  const reviews = reviewsData?.reviews ?? [];
  const assessments = assessmentsData?.assessments ?? [];

  // A failed resolve is NOT an empty result. Coalescing null to [] here would print the
  // same confident zero the truncation used to, just by a different route.
  const findingsUnavailable = findingsData === null;
  const systemFindings = findingsData?.findings ?? [];

  // The COUNT the engine computed over the whole matched set — never the length of the
  // page above, which is bounded and would silently become a cap.
  // Metric Contract: the ACTIVE population (operational_status <> 'closed'), not
  // the strictly-open one. A finding under active remediation still belongs to this
  // entity's risk picture; counting only untouched work told the owner the entity
  // was clean the moment somebody started fixing it. The engine serves both
  // populations (active_total / open_total) — this reads the enterprise one.
  const activeFindingCount = findingsData?.active_total ?? 0;
  const activeFindings = systemFindings.filter((f) => isActiveStatus(f.status));

  // Track which assessments have findings (for "Finding created" indicator).
  const assessmentIdsWithFindings = new Set<string>();
  // ...and which REVIEWS do. An `ai_review` finding points at a review; an
  // `ai_governance_review` finding points at an assessment (see systemFindings above).
  const reviewIdsWithFindings = new Set<string>();
  for (const f of systemFindings) {
    if (f.source_type === "ai_governance_review" && f.source_id) {
      assessmentIdsWithFindings.add(f.source_id);
    }
    if (f.source_type === "ai_review" && f.source_id) {
      reviewIdsWithFindings.add(f.source_id);
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
              {system.name}
            </h1>
            {system.use_case && (
              <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
                {system.use_case}
              </p>
            )}
          </div>
          <Link
            href={`/ai-systems/${system.id}/edit`}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:border-teal-500 hover:text-teal-300"
            style={{ borderColor: "#1e2d45", color: "#94a3b8", background: "transparent" }}
          >
            Edit AI System
          </Link>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-8">
          <OpenFindingsSection
            findings={activeFindings}
            count={activeFindingCount}
            unavailable={findingsUnavailable}
            systemId={system.id}
          />
          <ExternalIntelligenceSection signals={linkedSignals} />
          <GovernanceReviewsSection reviews={reviews} reviewIdsWithFindings={reviewIdsWithFindings} />
          <GovernanceAssessmentsSection
            assessments={assessments}
            assessmentIdsWithFindings={assessmentIdsWithFindings}
          />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <SystemDetailsCard system={system} />
          <VendorDependenciesCard dependencies={vendorDeps} />
          <GovernanceSummaryCard
            activeFindings={activeFindings}
            count={activeFindingCount}
            unavailable={findingsUnavailable}
            reviewCount={reviews.length}
            assessmentCount={assessments.length}
            latestAssessment={latestAssessment}
          />
          {latestAssessment && (
            <AssessmentStatusCard assessment={latestAssessment} systemId={system.id} />
          )}
          <ActionsCard systemId={system.id} />
          <HistorySection resourcePath="ai-systems" resourceId={system.id} />
        </div>
      </div>
    </div>
  );
}
