import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getRisks,
  getRisksIntelligence,
  getRisksSummary,
  getRiskScale,
} from "@/lib/api";
import { RiskTable } from "@/components/risks/RiskTable";
import type { EnrichedRiskRow } from "@/components/risks/RiskRow";

const STAT_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

// Mirror src/api/lib/riskValidation.ts:VALID_DOMAINS exactly. If the
// engine's enum gains a value, add it here too — the comment + a code
// review note is the sync contract. The drift cost is small (one
// missing filter pill until update).
const RISK_DOMAINS: ReadonlyArray<string> = [
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General",
];

const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open",        label: "Open" },
  { value: "accepted",    label: "Accepted" },
  { value: "mitigated",   label: "Mitigated" },
  { value: "closed",      label: "Closed" },
  { value: "transferred", label: "Transferred" },
];

const RATING_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Critical", label: "Critical" },
  { value: "High",     label: "High" },
  { value: "Moderate", label: "Moderate" },
  { value: "Low",      label: "Low" },
];

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
  const activeRating = sp.risk_rating ?? "";

  // Fetch four endpoints in parallel:
  //   1. /api/risks      — full row data (incl. due_date, updated_at) for ALL statuses
  //   2. /api/risks/intelligence — treatment/finding counts (open + non-terminal only)
  //   3. /api/risks/summary      — aggregate count tiles
  //   4. /api/risk-scale         — display preset for rating relabeling
  //
  // Filters from the URL apply to /api/risks (server-side filter on
  // status/domain/risk_rating); intelligence stays unfiltered and is
  // merged in client-side. This keeps the merge math simple — we never
  // need to ask "is this id in the intelligence list under a different
  // filter?". Closed/transferred risks land in the basic list with
  // counts defaulted to 0 (intelligence excludes them at the SQL layer).
  const basicParams: { status?: string; domain?: string; risk_rating?: string; limit: number } = { limit: 200 };
  if (activeStatus)  basicParams.status      = activeStatus;
  if (activeDomain)  basicParams.domain      = activeDomain;
  if (activeRating)  basicParams.risk_rating = activeRating;

  const [basicData, intelligenceData, summary, scale] = await Promise.all([
    getRisks(token, basicParams),
    getRisksIntelligence(token),
    getRisksSummary(token),
    getRiskScale(token),
  ]);

  const scaleLevels = scale?.levels ?? [];

  // Build enriched-row list by merging.
  const intelByRiskId = new Map<string, { active_treatments: number; linked_findings: number }>();
  for (const r of intelligenceData?.risks ?? []) {
    intelByRiskId.set(r.id, {
      active_treatments: r.active_treatments,
      linked_findings:   r.linked_findings,
    });
  }

  const rows: EnrichedRiskRow[] = (basicData?.risks ?? []).map((r) => {
    const counts = intelByRiskId.get(r.id);
    return {
      id: r.id,
      title: r.title,
      domain: r.domain,
      risk_rating: r.risk_rating,
      status: r.status,
      owner: r.owner,
      due_date: r.due_date,
      updated_at: r.updated_at,
      active_treatments: counts?.active_treatments ?? 0,
      linked_findings:   counts?.linked_findings   ?? 0,
    };
  });

  const totalRisks     = summary?.total ?? 0;
  const openRisks      = summary?.by_status["open"] ?? 0;
  const criticalRisks  = summary?.by_risk_rating["Critical"] ?? 0;
  const mitigatedRisks = summary?.by_status["mitigated"] ?? 0;

  const currentSp: Params = {
    ...(sp.status      ? { status:      sp.status }      : {}),
    ...(sp.domain      ? { domain:      sp.domain }      : {}),
    ...(sp.risk_rating ? { risk_rating: sp.risk_rating } : {}),
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Risk Register
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Strategic risks and treatment status
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Link
            href="/risks/new"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              background: "#00c4b4",
              color: "#0a0f1a",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            + Add Risk
          </Link>
        </div>
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
          <FilterPill label="All" href={filterHref(currentSp, "status", null)} active={!activeStatus} />
          {STATUS_FILTERS.map(({ value, label }) => (
            <FilterPill
              key={value}
              label={label}
              href={filterHref(currentSp, "status", value)}
              active={activeStatus === value}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Domain
          </span>
          <FilterPill label="All" href={filterHref(currentSp, "domain", null)} active={!activeDomain} />
          {RISK_DOMAINS.map((d) => (
            <FilterPill
              key={d}
              label={d}
              href={filterHref(currentSp, "domain", d)}
              active={activeDomain === d}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Rating
          </span>
          <FilterPill label="All" href={filterHref(currentSp, "risk_rating", null)} active={!activeRating} />
          {RATING_FILTERS.map(({ value, label }) => (
            <FilterPill
              key={value}
              label={label}
              href={filterHref(currentSp, "risk_rating", value)}
              active={activeRating === value}
            />
          ))}
        </div>
      </div>

      {/* Risk table */}
      <RiskTable risks={rows} scaleLevels={scaleLevels} />
    </div>
  );
}
