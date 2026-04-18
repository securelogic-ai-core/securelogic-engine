import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFinding, getActionsForFinding, type Finding, type Action } from "@/lib/api";
import { ActionCard } from "@/components/ActionCard";
import { AddActionForm } from "./AddActionForm";
import {
  updateFindingStatusAction,
  updateFindingPriorityAction,
  updateFindingDueDateAction,
  updateActionStatusAction,
} from "./actions";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
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

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  in_progress: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  closed:      { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  accepted:    { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_progress: "In Progress", closed: "Closed", accepted: "Accepted",
};

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  near_term: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  planned:   { background: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

const PRIORITY_LABELS: Record<string, string> = {
  immediate: "Immediate", near_term: "Near Term", planned: "Planned", watch: "Watch",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  control_test:         "Control Test",
  vendor_review:        "Vendor Assessment",
  ai_review:            "AI Review",
  ai_governance_review: "AI Governance Review",
  obligation_review:    "Obligation Review",
  dependency_review:    "Dependency Review",
  signal:               "Signal",
  manual:               "Manual",
  assessment:           "Assessment",
  risk:                 "Risk",
};

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const style = PRIORITY_STYLES[priority] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={style}>
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Status & Priority sidebar card (uses server action forms)
// ─────────────────────────────────────────────────────────────

type StatusTransition = { to: string; label: string };

const STATUS_TRANSITIONS: Record<string, StatusTransition[]> = {
  open:        [{ to: "in_progress", label: "Start" }, { to: "closed", label: "Resolve" }, { to: "accepted", label: "Accept Risk" }],
  in_progress: [{ to: "closed", label: "Resolve" }, { to: "accepted", label: "Accept Risk" }, { to: "open", label: "Re-open" }],
  closed:      [{ to: "open", label: "Re-open" }],
  accepted:    [{ to: "open", label: "Re-open" }],
};

const PRIORITY_OPTIONS = ["immediate", "near_term", "planned", "watch"] as const;

function StatusPriorityCard({ finding }: { finding: Finding }) {
  const transitions = STATUS_TRANSITIONS[finding.status] ?? [];

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Status & Priority
      </h3>

      {/* Current status */}
      <div className="flex items-center gap-2 mb-3">
        <StatusBadge status={finding.status} />
      </div>

      {/* Status transitions */}
      {transitions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {transitions.map((t) => (
            <form
              key={t.to}
              action={async () => {
                "use server";
                await updateFindingStatusAction(finding.id, t.to);
              }}
            >
              <button
                type="submit"
                className="text-xs font-medium transition-colors"
                style={{
                  border: "1px solid #1e293b",
                  color: "#94a3b8",
                  padding: "3px 10px",
                  borderRadius: "6px",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            </form>
          ))}
        </div>
      )}

      {/* Priority */}
      <div className="mb-4">
        <p className="text-xs font-medium mb-2" style={{ color: "#64748b" }}>Priority</p>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_OPTIONS.map((p) => (
            <form
              key={p}
              action={async () => {
                "use server";
                await updateFindingPriorityAction(finding.id, p);
              }}
            >
              <button
                type="submit"
                className="text-xs font-medium transition-colors"
                style={
                  finding.priority === p
                    ? { border: "1px solid #00c4b4", background: "rgba(0,196,180,0.08)", color: "#00c4b4", padding: "2px 8px", borderRadius: "6px" }
                    : { border: "1px solid #1e293b", color: "#64748b", padding: "2px 8px", borderRadius: "6px", background: "transparent", cursor: "pointer" }
                }
              >
                {PRIORITY_LABELS[p]}
              </button>
            </form>
          ))}
        </div>
      </div>

      {/* Due date */}
      <div>
        <p className="text-xs font-medium mb-1" style={{ color: "#64748b" }}>Due Date</p>
        <form
          action={async (formData: FormData) => {
            "use server";
            const val = formData.get("due_date") as string | null;
            await updateFindingDueDateAction(finding.id, val || null);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="date"
            name="due_date"
            defaultValue={finding.due_date ?? ""}
            style={{
              background: "rgba(15,23,42,0.6)",
              border: "1px solid #1e293b",
              borderRadius: "6px",
              color: "#f1f5f9",
              padding: "4px 8px",
              fontSize: "12px",
              flex: 1,
              outline: "none",
            }}
          />
          <button
            type="submit"
            className="text-xs font-medium transition-colors flex-shrink-0"
            style={{ border: "1px solid #1e293b", color: "#94a3b8", padding: "4px 10px", borderRadius: "6px", background: "transparent", cursor: "pointer" }}
          >
            Set
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Finding Details card (read-only metadata)
// ─────────────────────────────────────────────────────────────

function FindingDetailsCard({ finding }: { finding: Finding }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Finding Details
      </h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Source</span>
          <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>
            {SOURCE_TYPE_LABELS[finding.source_type] ?? finding.source_type}
          </span>
        </div>
        {finding.domain && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Domain</span>
            <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{finding.domain}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Severity</span>
          <span className="text-xs font-semibold" style={(SEVERITY_STYLES[finding.severity] ?? {}) as React.CSSProperties}>
            {finding.severity}
          </span>
        </div>
        {finding.likelihood && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#94a3b8" }}>Likelihood</span>
            <span className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{finding.likelihood.replace(/_/g, " ")}</span>
          </div>
        )}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #1e2d45" }}>
          <span className="text-xs" style={{ color: "#94a3b8" }}>Created</span>
          <span className="text-xs" style={{ color: "#475569" }}>{fmt(finding.created_at)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "#94a3b8" }}>Updated</span>
          <span className="text-xs" style={{ color: "#475569" }}>{fmt(finding.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Actions section — wraps ActionCard with server action callback
// ─────────────────────────────────────────────────────────────

function RemediationActionsSection({
  finding,
  actions,
}: {
  finding: Finding;
  actions: Action[];
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Remediation Actions ({actions.length})
      </h3>

      {actions.length === 0 ? (
        <div className="mb-4">
          <p className="text-sm mb-1" style={{ color: "#475569" }}>No remediation actions yet.</p>
          <p className="text-xs" style={{ color: "#475569" }}>
            Add an action to track remediation work for this finding.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {actions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              findingId={finding.id}
              onStatusChange={async (actionId, newStatus) => {
                "use server";
                await updateActionStatusAction(finding.id, actionId, newStatus);
              }}
            />
          ))}
        </div>
      )}

      <AddActionForm findingId={finding.id} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [findingData, actionsData] = await Promise.all([
    getFinding(token, id),
    getActionsForFinding(token, id),
  ]);

  if (!findingData) redirect("/findings");

  const finding = findingData.finding;
  const actions = actionsData?.actions ?? [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/findings"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Findings
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Finding header card */}
          <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <SeverityBadge severity={finding.severity} />
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                style={{ background: "rgba(59,130,246,0.1)", color: "#93c5fd" }}
              >
                {SOURCE_TYPE_LABELS[finding.source_type] ?? finding.source_type}
              </span>
              {finding.priority && <PriorityBadge priority={finding.priority} />}
            </div>
            <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
              {finding.title}
            </h1>
            {finding.domain && (
              <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>{finding.domain}</p>
            )}
            {finding.description && (
              <p className="text-sm mt-3 leading-relaxed" style={{ color: "#cbd5e1" }}>
                {finding.description}
              </p>
            )}
          </div>

          {/* Recommendation */}
          {finding.recommendation && (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#94a3b8" }}>
                Recommendation
              </h3>
              <div style={{
                background: "rgba(0,196,180,0.05)",
                border: "1px solid rgba(0,196,180,0.2)",
                borderRadius: "8px",
                padding: "12px",
              }}>
                <p className="text-sm leading-relaxed" style={{ color: "#cbd5e1" }}>
                  {finding.recommendation}
                </p>
              </div>
            </div>
          )}

          {/* Remediation Actions */}
          <RemediationActionsSection finding={finding} actions={actions} />
        </div>

        {/* Right: sidebar */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
          <StatusPriorityCard finding={finding} />
          <FindingDetailsCard finding={finding} />
        </div>
      </div>
    </div>
  );
}
