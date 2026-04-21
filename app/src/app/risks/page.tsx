import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getRisksIntelligence, getRisksSummary, getRiskScale, type RiskIntelligence, type RiskScaleLevel } from "@/lib/api";

const FALLBACK_RATING_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

function ratingStyleFromScale(
  ratingValue: string | null,
  scaleLevels: RiskScaleLevel[]
): React.CSSProperties {
  if (!ratingValue) return { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const v = ratingValue.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  if (level) {
    return { background: `${level.color}26`, color: level.color };
  }
  return FALLBACK_RATING_STYLES[ratingValue] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  accepted:    { background: "rgba(245,158,11,0.12)", color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  closed:      { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

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
  return `/risks${qs ? `?${qs}` : ""}`;
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

function RiskCard({ risk, scaleLevels }: { risk: RiskIntelligence; scaleLevels: RiskScaleLevel[] }) {
  const ratingStyle = ratingStyleFromScale(risk.risk_rating ?? null, scaleLevels);
  const statusStyle = STATUS_STYLES[risk.status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  const statusLabel = (risk.status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const intelligenceColor = risk.linked_findings > 0
    ? { color: "#fcd34d" }
    : { color: "#00c4b4" };

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {risk.risk_rating && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
              style={ratingStyle}
            >
              {scaleLevels.find((l) => l.value.toLowerCase() === risk.risk_rating?.toLowerCase())?.label ?? risk.risk_rating}
            </span>
          )}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={statusStyle}
          >
            {statusLabel}
          </span>
          {risk.domain && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs"
              style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
            >
              {risk.domain}
            </span>
          )}
        </div>
      </div>

      <p className="text-sm font-semibold mb-2" style={{ color: "#f1f5f9" }}>
        {risk.title}
      </p>

      <p className="text-xs" style={intelligenceColor}>
        {risk.active_treatments} active treatment{risk.active_treatments !== 1 ? "s" : ""}
        {" • "}
        {risk.total_treatments} total
        {" • "}
        {risk.linked_findings} linked finding{risk.linked_findings !== 1 ? "s" : ""}
      </p>

      {risk.owner && (
        <p className="text-xs mt-2" style={{ color: "#64748b" }}>
          Owner: {risk.owner}
        </p>
      )}
    </div>
  );
}

export default async function RisksPage({
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

  const activeStatus = sp.status ?? "";
  const activeDomain = sp.domain ?? "";

  const [intelligenceData, summary, scale] = await Promise.all([
    getRisksIntelligence(token),
    getRisksSummary(token),
    getRiskScale(token),
  ]);

  const scaleLevels = scale?.levels ?? [];

  // Filter in-memory (intelligence endpoint excludes closed/transferred)
  let risks = intelligenceData?.risks ?? [];
  if (activeStatus) {
    risks = risks.filter((r) => r.status === activeStatus);
  }
  if (activeDomain) {
    risks = risks.filter((r) => r.domain === activeDomain);
  }

  const totalRisks     = summary?.total ?? 0;
  const openRisks      = summary?.by_status["open"] ?? 0;
  const criticalRisks  = summary?.by_risk_rating["Critical"] ?? 0;
  const mitigatedRisks = summary?.by_status["mitigated"] ?? 0;

  const currentSp: Params = {
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.domain ? { domain: sp.domain } : {}),
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Risk Register
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Strategic risks and treatment status
          </p>
        </div>
        <Link
          href="/risks/import"
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
            flexShrink: 0,
          }}
        >
          ↑ Import CSV
        </Link>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Total Risks
          </p>
          <p className="text-3xl font-bold" style={{ color: "#f1f5f9" }}>{totalRisks}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Open
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{openRisks}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Critical
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{criticalRisks}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Mitigated
          </p>
          <p className="text-3xl font-bold" style={{ color: "#86efac" }}>{mitigatedRisks}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Status
          </span>
          <FilterPill label="All"       href={filterHref(currentSp, "status", null)}       active={!activeStatus} />
          <FilterPill label="Open"      href={filterHref(currentSp, "status", "open")}      active={activeStatus === "open"} />
          <FilterPill label="Accepted"  href={filterHref(currentSp, "status", "accepted")}  active={activeStatus === "accepted"} />
          <FilterPill label="Mitigated" href={filterHref(currentSp, "status", "mitigated")} active={activeStatus === "mitigated"} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Domain
          </span>
          <FilterPill label="All"          href={filterHref(currentSp, "domain", null)}           active={!activeDomain} />
          <FilterPill label="Vendor Risk"  href={filterHref(currentSp, "domain", "Vendor Risk")}  active={activeDomain === "Vendor Risk"} />
          <FilterPill label="AI Governance"href={filterHref(currentSp, "domain", "AI Governance")} active={activeDomain === "AI Governance"} />
          <FilterPill label="Compliance"   href={filterHref(currentSp, "domain", "Compliance")}   active={activeDomain === "Compliance"} />
          <FilterPill label="General"      href={filterHref(currentSp, "domain", "General")}      active={activeDomain === "General"} />
        </div>
      </div>

      {/* Risk cards */}
      {risks.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No risks match your current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {risks.map((r) => (
            <RiskCard key={r.id} risk={r} scaleLevels={scaleLevels} />
          ))}
        </div>
      )}
    </div>
  );
}
