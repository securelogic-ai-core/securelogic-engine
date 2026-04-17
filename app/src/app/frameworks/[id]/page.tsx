import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getFramework,
  getFrameworkReadiness,
  type ReadinessRequirement,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function filterHref(
  current: Record<string, string>,
  key: string,
  value: string
): string {
  const next = { ...current };
  if (next[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  const qs = new URLSearchParams(next).toString();
  return qs ? `?${qs}` : "";
}

// ─────────────────────────────────────────────────────────────
// Readiness bar
// ─────────────────────────────────────────────────────────────

function ReadinessBar({ score }: { score: number }) {
  const color =
    score >= 75 ? "#22c55e" :
    score >= 50 ? "#f59e0b" :
    score >= 25 ? "#f97316" :
    "#ef4444";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 rounded-full h-2" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-sm font-bold tabular-nums w-10 text-right" style={{ color }}>
        {score}%
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Requirement status badge
// ─────────────────────────────────────────────────────────────

const REQ_STATUS_STYLES: Record<string, React.CSSProperties> = {
  satisfied: { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  partial:   { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  unmapped:  { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

const ASSESSMENT_STATUS_STYLES: Record<string, React.CSSProperties> = {
  passed:               { background: "rgba(34,197,94,0.12)",   color: "#86efac" },
  failed:               { background: "rgba(239,68,68,0.12)",   color: "#fca5a5" },
  remediation_required: { background: "rgba(245,158,11,0.12)",  color: "#fcd34d" },
  in_progress:          { background: "rgba(59,130,246,0.12)",  color: "#93c5fd" },
  not_started:          { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

function ReqStatusBadge({ status }: { status: string }) {
  const style = REQ_STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={style}
    >
      {status}
    </span>
  );
}

function AssessmentBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs" style={{ color: "#475569" }}>—</span>;
  const style = ASSESSMENT_STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs" style={style}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Requirement row
// ─────────────────────────────────────────────────────────────

function RequirementRow({ req }: { req: ReadinessRequirement }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium"
              style={{ background: "rgba(0,196,180,0.08)", color: "#00c4b4" }}
            >
              {req.reference_id}
            </span>
            <ReqStatusBadge status={req.status} />
          </div>
          <p className="text-sm" style={{ color: "#cbd5e1" }}>
            {req.title}
          </p>
        </div>
      </div>

      {req.mapped_controls.length > 0 && (
        <div className="mt-3 space-y-1.5 pl-2" style={{ borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
          {req.mapped_controls.map((c) => (
            <div key={c.control_id} className="flex items-center justify-between gap-2">
              <Link
                href={`/controls/${c.control_id}`}
                className="text-xs hover:underline truncate"
                style={{ color: "#94a3b8" }}
              >
                {c.control_name}
              </Link>
              <AssessmentBadge status={c.latest_assessment_status} />
            </div>
          ))}
        </div>
      )}

      {req.mapped_controls.length === 0 && (
        <p className="mt-2 text-xs pl-2" style={{ color: "#475569" }}>
          No controls mapped · <Link href="/controls" className="hover:underline" style={{ color: "#00c4b4" }}>Map a control →</Link>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function FrameworkDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [framework, readiness] = await Promise.all([
    getFramework(token, id),
    getFrameworkReadiness(token, id),
  ]);

  if (!framework) redirect("/frameworks");

  const allRequirements = readiness?.requirements ?? [];
  const statusFilter = sp["status"] ?? "";

  const requirements = statusFilter
    ? allRequirements.filter((r) => r.status === statusFilter)
    : allRequirements;

  const currentFilters: Record<string, string> = statusFilter ? { status: statusFilter } : {};

  const FILTER_OPTIONS = [
    { label: "All", value: "" },
    { label: "Satisfied", value: "satisfied" },
    { label: "Partial", value: "partial" },
    { label: "Unmapped", value: "unmapped" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Back */}
      <Link
        href="/frameworks"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Frameworks
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-0.5" style={{ color: "#f1f5f9" }}>
          {framework.name}
        </h1>
        <p className="text-sm" style={{ color: "#475569" }}>
          v{framework.version}
        </p>
      </div>

      {/* Readiness summary */}
      {readiness && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
              Compliance Readiness
            </h2>
            <span className="text-xs font-medium" style={{ color: "#475569" }}>
              {readiness.total_requirements} requirements
            </span>
          </div>

          <ReadinessBar score={readiness.readiness_score} />

          <div className="grid grid-cols-3 gap-4 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "#86efac" }}>
                {readiness.satisfied}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Satisfied</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "#fcd34d" }}>
                {readiness.partial}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Partial</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "#94a3b8" }}>
                {readiness.unmapped}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Unmapped</p>
            </div>
          </div>
        </div>
      )}

      {/* Requirements list */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Requirements
            {statusFilter && ` · ${statusFilter}`}
          </h2>

          {/* Status filters — shown when > 20 requirements */}
          {allRequirements.length > 20 && (
            <div className="flex gap-2 flex-wrap">
              {FILTER_OPTIONS.map((opt) => {
                const isActive = statusFilter === opt.value;
                const href = opt.value
                  ? filterHref(currentFilters, "status", opt.value)
                  : "/frameworks/" + id;
                return (
                  <Link
                    key={opt.value}
                    href={href}
                    className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                    style={
                      isActive
                        ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4" }
                        : { background: "rgba(255,255,255,0.04)", color: "#94a3b8" }
                    }
                  >
                    {opt.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {requirements.length === 0 ? (
          <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
            <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
              {statusFilter
                ? `No ${statusFilter} requirements.`
                : "No requirements loaded for this framework."}
            </p>
            {statusFilter && (
              <Link
                href={`/frameworks/${id}`}
                className="text-xs font-medium hover:underline"
                style={{ color: "#00c4b4" }}
              >
                Clear filter
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {requirements.map((req) => (
              <RequirementRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
