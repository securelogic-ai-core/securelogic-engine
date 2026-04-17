import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getFindings, type Finding } from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  vendor_review:        "Vendor Assessment",
  control_test:         "Control Test",
  obligation_review:    "Obligation Review",
  ai_review:            "AI Review",
  ai_governance_review: "AI Governance Review",
  manual:               "Manual",
  assessment:           "Assessment",
  signal:               "Signal",
  risk:                 "Risk",
};

const SOURCE_TYPE_VALUES: Array<{ label: string; value: string }> = [
  { label: "Vendor Assessment",   value: "vendor_review" },
  { label: "Control Test",        value: "control_test" },
  { label: "Obligation Review",   value: "obligation_review" },
  { label: "AI Review",           value: "ai_review" },
  { label: "AI Governance Review",value: "ai_governance_review" },
  { label: "Manual",              value: "manual" },
];

const STAT_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

type Params = Record<string, string | undefined>;

function filterHref(current: Params, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && k !== key) params.set(k, v);
  }
  if (value !== null) params.set(key, value);
  const qs = params.toString();
  return `/findings${qs ? `?${qs}` : ""}`;
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
          : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
      }
    >
      {label}
    </Link>
  );
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const sp = await searchParams;
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const activeStatus   = sp.status   ?? "open";
  const activeSeverity = sp.severity ?? "";
  const activeDomain   = sp.domain   ?? "";
  const activeSource   = sp.source_type ?? "";
  const activePriority = sp.priority ?? "";

  const findingsData = await getFindings(token, {
    status:      activeStatus === "all" ? undefined : activeStatus,
    severity:    activeSeverity  || undefined,
    domain:      activeDomain    || undefined,
    source_type: activeSource    || undefined,
    priority:    activePriority  || undefined,
    limit: 100,
  });

  const findings = findingsData?.findings ?? [];

  const openCount       = findings.filter((f) => f.status === "open").length;
  const criticalCount   = findings.filter((f) => f.severity === "Critical").length;
  const highCount       = findings.filter((f) => f.severity === "High").length;
  const inProgressCount = findings.filter((f) => f.status === "in_progress").length;

  const currentSp: Params = {
    ...(sp.status      ? { status:      sp.status }      : {}),
    ...(sp.severity    ? { severity:    sp.severity }    : {}),
    ...(sp.domain      ? { domain:      sp.domain }      : {}),
    ...(sp.source_type ? { source_type: sp.source_type } : {}),
    ...(sp.priority    ? { priority:    sp.priority }    : {}),
  };

  const hasFilters = !!(
    activeSeverity || activeDomain || activeSource || activePriority ||
    (sp.status && sp.status !== "open")
  );

  // Group by domain when no domain filter is active
  const grouped: Record<string, Finding[]> = {};
  if (!activeDomain) {
    for (const f of findings) {
      const d = f.domain ?? "General";
      (grouped[d] ??= []).push(f);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Findings
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            All open findings across your organization
          </p>
        </div>
        <a
          href={`/api/export/findings${
            Object.keys(currentSp).length > 0
              ? `?${new URLSearchParams(
                  Object.fromEntries(
                    Object.entries(currentSp).filter(([, v]) => v !== undefined)
                  ) as Record<string, string>
                ).toString()}`
              : ""
          }`}
          download
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
          style={{ border: "1px solid #1e293b", color: "#94a3b8", background: "transparent" }}
        >
          ⬇ Export CSV
        </a>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Open
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{openCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Critical
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{criticalCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            High
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fdba74" }}>{highCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            In Progress
          </p>
          <p className="text-3xl font-bold" style={{ color: "#93c5fd" }}>{inProgressCount}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-6 space-y-3">
        {/* Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Status
          </span>
          <FilterPill label="Open"        href={filterHref(currentSp, "status", "open")}        active={activeStatus === "open"} />
          <FilterPill label="In Progress" href={filterHref(currentSp, "status", "in_progress")} active={activeStatus === "in_progress"} />
          <FilterPill label="Closed"      href={filterHref(currentSp, "status", "closed")}      active={activeStatus === "closed"} />
          <FilterPill label="All"         href={filterHref(currentSp, "status", "all")}         active={activeStatus === "all"} />
        </div>

        {/* Severity */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Severity
          </span>
          <FilterPill label="All"      href={filterHref(currentSp, "severity", null)}       active={!activeSeverity} />
          <FilterPill label="Critical" href={filterHref(currentSp, "severity", "Critical")} active={activeSeverity === "Critical"} />
          <FilterPill label="High"     href={filterHref(currentSp, "severity", "High")}     active={activeSeverity === "High"} />
          <FilterPill label="Moderate" href={filterHref(currentSp, "severity", "Moderate")} active={activeSeverity === "Moderate"} />
          <FilterPill label="Low"      href={filterHref(currentSp, "severity", "Low")}      active={activeSeverity === "Low"} />
        </div>

        {/* Source Type */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Type
          </span>
          <FilterPill label="All" href={filterHref(currentSp, "source_type", null)} active={!activeSource} />
          {SOURCE_TYPE_VALUES.map((s) => (
            <FilterPill
              key={s.value}
              label={s.label}
              href={filterHref(currentSp, "source_type", s.value)}
              active={activeSource === s.value}
            />
          ))}
        </div>

        {/* Priority */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Priority
          </span>
          <FilterPill label="All"       href={filterHref(currentSp, "priority", null)}        active={!activePriority} />
          <FilterPill label="Immediate" href={filterHref(currentSp, "priority", "immediate")} active={activePriority === "immediate"} />
          <FilterPill label="Near Term" href={filterHref(currentSp, "priority", "near_term")} active={activePriority === "near_term"} />
          <FilterPill label="Planned"   href={filterHref(currentSp, "priority", "planned")}   active={activePriority === "planned"} />
          <FilterPill label="Watch"     href={filterHref(currentSp, "priority", "watch")}     active={activePriority === "watch"} />
        </div>
      </div>

      {/* Findings list */}
      {findings.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No findings match your current filters.
          </p>
          {hasFilters && (
            <Link
              href="/findings"
              className="text-xs font-medium"
              style={{ color: "#00c4b4" }}
            >
              Clear filters
            </Link>
          )}
        </div>
      ) : activeDomain ? (
        // Flat list when domain filter is active
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} revalidateUrl="/findings" />
          ))}
        </div>
      ) : (
        // Grouped by domain
        <div className="space-y-8">
          {Object.entries(grouped).map(([domain, domainFindings]) => (
            <div key={domain}>
              <div
                className="flex items-center gap-2 mb-3 pb-2"
                style={{ borderBottom: "1px solid #1e293b" }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#64748b" }}
                >
                  {domain}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
                >
                  {domainFindings.length}
                </span>
              </div>
              <div className="space-y-3">
                {domainFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} revalidateUrl="/findings" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
