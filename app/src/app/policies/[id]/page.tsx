import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getPolicy,
  getControls,
  type PolicyDetail,
  type Control,
} from "@/lib/api";
import { ReviewActions } from "./ReviewActions";
import { LinkControlSection } from "./LinkControlSection";
import { unlinkControlAction } from "./actions";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  return Math.ceil((due.getTime() - now.getTime()) / 86400000);
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  draft:        { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  active:       { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  under_review: { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  retired:      { background: "rgba(100,116,139,0.1)",  color: "#64748b" },
};

const STATUS_LABELS: Record<string, string> = {
  draft:        "Draft",
  active:       "Active",
  under_review: "Under Review",
  retired:      "Retired",
};

const CATEGORY_LABELS: Record<string, string> = {
  access_control:          "Access Control",
  incident_response:       "Incident Response",
  change_management:       "Change Management",
  data_classification:     "Data Classification",
  business_continuity:     "Business Continuity",
  acceptable_use:          "Acceptable Use",
  vendor_management:       "Vendor Management",
  vulnerability_management: "Vulnerability Management",
  other:                   "Other",
};

const FREQ_LABELS: Record<string, string> = {
  annual:   "Annual",
  biannual: "Biannual",
  ad_hoc:   "As needed",
};

// ─────────────────────────────────────────────────────────────
// Badge components
// ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span style={{
      display: "inline-block",
      background: "rgba(0,196,180,0.1)", color: "#00c4b4",
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
    }}>
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Unlink button (server action wrapper)
// ─────────────────────────────────────────────────────────────

function UnlinkButton({ policyId, controlId }: { policyId: string; controlId: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await unlinkControlAction(policyId, controlId);
      }}
    >
      <button
        type="submit"
        className="text-xs font-medium transition-colors hover:opacity-80 flex-shrink-0"
        style={{ color: "#475569" }}
      >
        Unlink
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────

function ReviewCycleSection({ policy }: { policy: PolicyDetail }) {
  const days = policy.next_review_at ? daysUntil(policy.next_review_at) : null;
  const dueSoon = !policy.is_overdue && days !== null && days >= 0 && days <= 30;
  const showMarkReviewed = policy.is_overdue || policy.status === "under_review";

  let nextReviewDisplay: React.ReactNode = <span style={{ color: "#475569" }}>—</span>;
  if (policy.review_frequency === "ad_hoc") {
    nextReviewDisplay = <span style={{ color: "#94a3b8" }}>As needed</span>;
  } else if (policy.is_overdue && policy.next_review_at) {
    nextReviewDisplay = (
      <span className="flex items-center gap-2">
        <span style={{ color: "#fca5a5" }}>{fmt(policy.next_review_at)}</span>
        <span style={{
          background: "rgba(239,68,68,0.15)", color: "#fca5a5",
          fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
        }}>Overdue</span>
      </span>
    );
  } else if (dueSoon && policy.next_review_at) {
    nextReviewDisplay = (
      <span className="flex items-center gap-2">
        <span style={{ color: "#fcd34d" }}>{fmt(policy.next_review_at)}</span>
        <span style={{
          background: "rgba(245,158,11,0.15)", color: "#fcd34d",
          fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px",
        }}>Due soon</span>
      </span>
    );
  } else if (policy.next_review_at) {
    nextReviewDisplay = <span style={{ color: "#cbd5e1" }}>{fmt(policy.next_review_at)}</span>;
  }

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Review Cycle
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Frequency</span>
          <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>
            {policy.review_frequency ? FREQ_LABELS[policy.review_frequency] ?? policy.review_frequency : "Not configured"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Last Reviewed</span>
          <span className="text-xs" style={{ color: "#cbd5e1" }}>
            {policy.last_reviewed_at ? fmt(policy.last_reviewed_at) : "Never"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs flex-shrink-0" style={{ color: "#94a3b8" }}>Next Review</span>
          <div className="text-xs text-right">{nextReviewDisplay}</div>
        </div>
      </div>
      {showMarkReviewed && (
        <div className="mt-4">
          <ReviewActions policyId={policy.id} />
        </div>
      )}
    </div>
  );
}

function LinkedControlsSection({
  policy,
  allControls,
}: {
  policy: PolicyDetail;
  allControls: Control[];
}) {
  const linkedControlIds = policy.linked_controls.map((lc) => lc.control_id);

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Linked Controls ({policy.linked_controls.length})
      </h3>

      {policy.linked_controls.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: "#475569" }}>
          No controls linked to this policy.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {policy.linked_controls.map((lc) => (
            <div key={lc.control_id} className="flex items-center justify-between gap-2">
              <Link
                href={`/controls/${lc.control_id}`}
                className="text-sm font-medium transition-colors hover:opacity-80 truncate"
                style={{ color: "#cbd5e1" }}
              >
                {lc.control_name}
              </Link>
              <UnlinkButton policyId={policy.id} controlId={lc.control_id} />
            </div>
          ))}
        </div>
      )}

      <LinkControlSection
        policyId={policy.id}
        allControls={allControls}
        linkedControlIds={linkedControlIds}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [policyData, controlsData] = await Promise.all([
    getPolicy(token, id),
    getControls(token),
  ]);

  if (!policyData) redirect("/policies");

  const policy = policyData.policy;
  const allControls = controlsData?.controls ?? [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/policies"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Policies
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Policy header card */}
          <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <StatusBadge status={policy.status} />
              <CategoryBadge category={policy.category} />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
              {policy.name}
            </h1>
            {policy.version && (
              <p className="text-sm mt-1" style={{ color: "#475569" }}>
                v{policy.version}
              </p>
            )}
            {policy.owner && (
              <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
                Owner: {policy.owner}
              </p>
            )}
            {policy.description && (
              <p className="text-sm mt-3 leading-relaxed" style={{ color: "#cbd5e1" }}>
                {policy.description}
              </p>
            )}
          </div>

          {/* Review Cycle */}
          <ReviewCycleSection policy={policy} />

          {/* Linked Controls */}
          <LinkedControlsSection policy={policy} allControls={allControls} />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          {/* Policy Details card */}
          <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
              Policy Details
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "#94a3b8" }}>Category</span>
                <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>
                  {CATEGORY_LABELS[policy.category] ?? policy.category}
                </span>
              </div>
              {policy.version && (
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "#94a3b8" }}>Version</span>
                  <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>
                    {policy.version}
                  </span>
                </div>
              )}
              {policy.owner && (
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "#94a3b8" }}>Owner</span>
                  <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>
                    {policy.owner}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "#94a3b8" }}>Status</span>
                <StatusBadge status={policy.status} />
              </div>
              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #1e2d45" }}>
                <span className="text-xs" style={{ color: "#94a3b8" }}>Created</span>
                <span className="text-xs" style={{ color: "#475569" }}>
                  {fmt(policy.created_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "#94a3b8" }}>Updated</span>
                <span className="text-xs" style={{ color: "#475569" }}>
                  {fmt(policy.updated_at)}
                </span>
              </div>
            </div>
          </div>

          {/* Edit Policy */}
          <Link
            href={`/policies/${policy.id}/edit`}
            className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: "#1e2d45", color: "#94a3b8", background: "transparent" }}
          >
            Edit Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
