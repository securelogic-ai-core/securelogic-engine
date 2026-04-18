import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getObligationSummary,
  getObligations,
  type Obligation,
} from "@/lib/api";

export default async function ObligationsPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [summaryData, obligationsData] = await Promise.all([
    getObligationSummary(token),
    getObligations(token, { status: "active", limit: 50 }),
  ]);

  const obligations = obligationsData?.obligations ?? [];
  const summary = summaryData ?? {
    total: 0,
    by_status: { active: 0, waived: 0, not_applicable: 0 },
    by_domain: {},
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Obligations
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Compliance obligations tracked for this organization.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {obligations.length > 0 && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {summary.by_status.active} active
            </span>
          )}
          <Link
            href="/obligations/import"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              border: "1px solid #1e293b",
              color: "#94a3b8",
              textDecoration: "none",
            }}
          >
            ↑ Import CSV
          </Link>
          <Link
            href="/obligations/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Obligation
          </Link>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Active" value={summary.by_status.active} color="#00c4b4" />
        <StatCard label="Waived" value={summary.by_status.waived} color="#94a3b8" />
        <StatCard label="Not Applicable" value={summary.by_status.not_applicable} color="#475569" />
      </div>

      {/* Filter tabs — visual only; page always shows active. Filtering will require
          client component or search params in a future iteration. */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: "rgba(30,45,69,0.5)" }}>
        {(["All", "Active", "Waived", "Not Applicable"] as const).map((label) => (
          <span
            key={label}
            className="px-3 py-1.5 rounded-md text-xs font-medium cursor-default transition-colors"
            style={
              label === "Active"
                ? { background: "#0a0f1a", color: "#f1f5f9" }
                : { color: "#94a3b8" }
            }
          >
            {label}
          </span>
        ))}
      </div>

      {/* Not entitled */}
      {obligationsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Obligations data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Empty state */}
      {obligationsData !== null && obligations.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No active obligations.{" "}
            <Link
              href="/obligations/new"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              Add your first obligation
            </Link>{" "}
            to begin tracking compliance.
          </p>
        </div>
      )}

      {/* Obligation list */}
      {obligations.length > 0 && (
        <div className="space-y-3">
          {obligations.map((obligation) => (
            <Link
              key={obligation.id}
              href={`/obligations/${obligation.id}`}
              className="block"
            >
              <ObligationRow obligation={obligation} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#94a3b8" }}>
        {label}
      </p>
      <p className="text-3xl font-bold leading-none" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  active:         { background: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  waived:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  not_applicable: { background: "rgba(71,85,105,0.3)",    color: "#64748b" },
};

const STATUS_LABELS: Record<string, string> = {
  active:         "Active",
  waived:         "Waived",
  not_applicable: "Not Applicable",
};

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  near_term: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  planned:   { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

function ObligationStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const style = PRIORITY_STYLES[priority] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
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

function DomainBadge({ domain }: { domain: string | null }) {
  if (!domain) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: "rgba(59,130,246,0.12)", color: "#93c5fd" }}
    >
      {domain}
    </span>
  );
}

function ObligationRow({ obligation }: { obligation: Obligation }) {
  const dueDate = obligation.due_date
    ? new Date(obligation.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 cursor-pointer transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {obligation.title}
            </span>
            <ObligationStatusBadge status={obligation.status} />
            {obligation.priority && <PriorityBadge priority={obligation.priority} />}
            {obligation.domain && <DomainBadge domain={obligation.domain} />}
          </div>
          {obligation.source_regulation && (
            <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
              {obligation.source_regulation}
            </p>
          )}
          {obligation.description && (
            <p className="text-xs line-clamp-2" style={{ color: "#475569" }}>
              {obligation.description}
            </p>
          )}
        </div>
        {dueDate && (
          <div className="flex-shrink-0 text-right">
            <p className="text-xs" style={{ color: "#475569" }}>
              Due {dueDate}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
