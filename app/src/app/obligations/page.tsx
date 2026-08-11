import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getObligationSummary,
  getObligations,
  type Obligation,
} from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { FilterPill } from "@/components/FilterPill";
import { ListSearchForm } from "@/components/ListSearchForm";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { isUnavailable } from "@/lib/edx/loadState";

type Params = Record<string, string | undefined>;

// The engine's list vocabulary plus the explicit `all` sentinel it accepts.
const STATUS_TABS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all",            label: "All" },
  { value: "active",         label: "Active" },
  { value: "waived",         label: "Waived" },
  { value: "not_applicable", label: "Not Applicable" },
];

function filterHref(current: Params, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && k !== key) params.set(k, v);
  }
  if (value !== null) params.set(key, value);
  const qs = params.toString();
  return `/obligations${qs ? `?${qs}` : ""}`;
}

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  // URL state drives the fetch (the risks/findings list-page pattern). The
  // default view stays "active" — the working set — with every lifecycle
  // state one click away instead of invisible.
  const activeStatus =
    STATUS_TABS.some((t) => t.value === sp.status) ? sp.status! : "active";
  const activeDomain = sp.domain ?? "";
  // ?overdue=true — the deep-link view for the overdue count. The metric pins
  // status='active' (a waived obligation cannot be overdue), so the overdue
  // view always fetches the active set; its pill href drops any status param.
  const activeOverdue = sp.overdue === "true";
  // Register search — platform 2–120 bounds (never send a term the engine 400s).
  const search =
    typeof sp.q === "string" && sp.q.trim().length >= 2 && sp.q.trim().length <= 120
      ? sp.q.trim()
      : undefined;

  const [summaryData, obligationsData] = await Promise.all([
    getObligationSummary(token),
    getObligations(token, {
      status: activeOverdue ? "active" : activeStatus,
      domain: activeDomain || undefined,
      overdue: activeOverdue || undefined,
      q: search,
      limit: 100,
    }),
  ]);

  const obligations = obligationsData?.obligations ?? [];
  const summary = summaryData ?? {
    total: 0,
    by_status: { active: 0, waived: 0, not_applicable: 0 },
    by_domain: {},
  };

  const currentSp: Params = {
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.domain ? { domain: sp.domain } : {}),
    ...(activeOverdue ? { overdue: "true" } : {}),
    ...(search ? { q: search } : {}),
  };
  // Status pills and the Overdue pill are the same axis: picking a status
  // drops `overdue`, picking Overdue drops `status` (the engine metric would
  // AND them into a contradiction otherwise — same trap the risks page pins).
  const statusSp: Params = { ...currentSp };
  delete statusSp.overdue;
  const overdueSp: Params = { ...currentSp };
  delete overdueSp.status;
  // Domain pills come from real org data (domains are a non-exhaustive
  // vocabulary), so the filter never offers a value with zero rows.
  const domainValues = Object.keys(summary.by_domain).sort();

  const statusCount = (value: string): number =>
    value === "all"
      ? summary.total
      : summary.by_status[value as keyof typeof summary.by_status] ?? 0;

  const STATUS_EMPTY_LABELS: Record<string, string> = {
    all: "No obligations yet.",
    active: "No active obligations.",
    waived: "No waived obligations.",
    not_applicable: "No not-applicable obligations.",
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
          <ExportCsvButton
            endpoint="/api/export/obligations"
            filenamePrefix="obligations"
            queryString={new URLSearchParams({
              ...(activeStatus !== "all" ? { status: activeStatus } : {}),
              ...(activeDomain ? { domain: activeDomain } : {}),
            }).toString()}
          />
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
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Active" value={summary.by_status.active} color="#00c4b4" />
        <StatCard label="Overdue" value={summary.overdue ?? 0} color="#fca5a5" />
        <StatCard label="Waived" value={summary.by_status.waived} color="#94a3b8" />
        <StatCard label="Not Applicable" value={summary.by_status.not_applicable} color="#475569" />
      </div>

      {/* Search — the register list-page pattern (2–120 bounds); hidden inputs
          carry the active filters so a search never drops them. */}
      <ListSearchForm
        action="/obligations"
        inputId="obligation-search"
        placeholder="Title, regulation, or description..."
        defaultValue={search}
        hidden={Object.fromEntries(
          Object.entries(currentSp).filter(([k]) => k !== "q")
        ) as Record<string, string>}
      />

      {/* Status filter — URL-state pills (the risks/findings pattern), with
          live counts from the summary so each tab says what it holds. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
          Status
        </span>
        {STATUS_TABS.map(({ value, label }) => (
          <FilterPill
            key={value}
            label={`${label} (${statusCount(value)})`}
            href={filterHref(statusSp, "status", value === "active" ? null : value)}
            active={!activeOverdue && activeStatus === value}
          />
        ))}
        <FilterPill
          label={`Overdue (${summary.overdue ?? 0})`}
          href={filterHref(overdueSp, "overdue", "true")}
          active={activeOverdue}
        />
      </div>

      {/* Domain filter — pills from real org data (non-exhaustive vocabulary). */}
      {domainValues.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Domain
          </span>
          <FilterPill
            label="All"
            href={filterHref(currentSp, "domain", null)}
            active={!activeDomain}
          />
          {domainValues.map((d) => (
            <FilterPill
              key={d}
              label={d}
              href={filterHref(currentSp, "domain", d)}
              active={activeDomain === d}
            />
          ))}
        </div>
      )}

      {/* EDX-1: a failed fetch, not a plan limit. The comment this replaced
          said "Not entitled" — the belief itself was the bug. getObligations
          returns null for ANY non-OK response or thrown request, and this page
          already redirected non-platform callers above. */}
      {isUnavailable(obligationsData) && (
        <UnavailableNotice
          subject="Obligations"
          denial="not a limit of your plan, and not an empty register"
          reassurance="Your obligations are unchanged."
          retryHref={filterHref(currentSp, "", null)}
        />
      )}

      {/* Empty state — filter-aware: a filtered view that comes up empty says
          so and offers the way out; only the truly-empty register pitches
          creating the first obligation. */}
      {obligationsData !== null && obligations.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          {search || activeOverdue || activeDomain || (activeStatus !== "active" && summary.total > 0) ? (
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              {search
                ? "No obligations match your search."
                : activeOverdue
                ? "No overdue obligations — every active deadline is in the future."
                : STATUS_EMPTY_LABELS[activeStatus] ?? "No obligations match this filter."}{" "}
              <Link
                href="/obligations"
                className="font-medium transition-colors hover:opacity-80"
                style={{ color: "#00c4b4" }}
              >
                Clear filters →
              </Link>
            </p>
          ) : (
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              {STATUS_EMPTY_LABELS[activeStatus] ?? "No obligations."}{" "}
              <Link
                href="/obligations/new"
                className="font-medium transition-colors hover:opacity-80"
                style={{ color: "#00c4b4" }}
              >
                Add your first obligation
              </Link>{" "}
              to begin tracking compliance.
            </p>
          )}
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
  // Mirror sqlObligationOverdue: ACTIVE and due strictly before today (a
  // due-today obligation is not overdue; a waived/NA one never is).
  const isOverdue =
    obligation.status === "active" &&
    obligation.due_date != null &&
    obligation.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);

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
            <p className="text-xs font-medium" style={{ color: isOverdue ? "#fca5a5" : "#475569" }}>
              {isOverdue ? "Overdue — due " : "Due "}
              {dueDate}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
