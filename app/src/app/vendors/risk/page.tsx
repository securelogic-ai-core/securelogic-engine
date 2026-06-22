import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendors,
  getVendorAssessments,
  getFindings,
  type Vendor,
  type VendorAssessment,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const CRIT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const CRIT_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
  critical:     { bar: "#ef4444", badge: "rgba(239,68,68,0.15)",  text: "#fca5a5" },
  high:         { bar: "#f97316", badge: "rgba(249,115,22,0.15)", text: "#fdba74" },
  medium:       { bar: "#f59e0b", badge: "rgba(245,158,11,0.15)", text: "#fcd34d" },
  low:          { bar: "#22c55e", badge: "rgba(34,197,94,0.15)",  text: "#86efac" },
  uncategorized:{ bar: "#334155", badge: "rgba(100,116,139,0.1)", text: "#64748b" },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function critKey(v: Vendor): string {
  return v.criticality ?? "uncategorized";
}

function sortVendors(vendors: Vendor[]): Vendor[] {
  return [...vendors].sort((a, b) => {
    const aOrd = a.criticality !== null ? (CRIT_ORDER[a.criticality] ?? 4) : 4;
    const bOrd = b.criticality !== null ? (CRIT_ORDER[b.criticality] ?? 4) : 4;
    return aOrd !== bOrd ? aOrd - bOrd : a.name.localeCompare(b.name);
  });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────
// Stat tile
// ─────────────────────────────────────────────────────────────

function StatTile({
  label,
  count,
  color,
  href,
}: {
  label: string;
  count: number;
  color: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-xl border p-5 hover:border-slate-600 transition-colors"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b", textDecoration: "none" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
        {label}
      </p>
      <p className="text-3xl font-bold" style={{ color }}>{count}</p>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// Criticality distribution stacked bar
// ─────────────────────────────────────────────────────────────

function CriticalityBar({ vendors }: { vendors: Vendor[] }) {
  const total = vendors.length;
  const segments = [
    { key: "critical",      label: "Critical",      color: "#ef4444" },
    { key: "high",          label: "High",          color: "#f97316" },
    { key: "medium",        label: "Medium",        color: "#f59e0b" },
    { key: "low",           label: "Low",           color: "#22c55e" },
    { key: "uncategorized", label: "None set",      color: "#334155" },
  ].map((s) => ({
    ...s,
    count: vendors.filter((v) => (v.criticality ?? "uncategorized") === s.key).length,
  })).filter((s) => s.count > 0);

  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: "#64748b" }}>No vendor data.</p>
    );
  }

  return (
    <div>
      {/* Stacked bar */}
      <div className="flex h-8 rounded-lg overflow-hidden mb-3" style={{ gap: "1px" }}>
        {segments.map((s) => {
          const pct = (s.count / total) * 100;
          return (
            <Link
              key={s.key}
              href={s.key === "uncategorized" ? "/vendors" : `/vendors?criticality=${s.key}`}
              className="h-full flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ width: `${pct}%`, background: s.color, minWidth: pct > 0 ? "4px" : undefined }}
              title={`${s.label}: ${s.count}`}
            >
              {pct >= 8 && (
                <span className="text-xs font-semibold text-white/90">{s.count}</span>
              )}
            </Link>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <Link
            key={s.key}
            href={s.key === "uncategorized" ? "/vendors" : `/vendors?criticality=${s.key}`}
            className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity"
          >
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span style={{ color: "#94a3b8" }}>{s.label}</span>
            <span className="font-bold tabular-nums" style={{ color: "#f1f5f9" }}>{s.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vendor risk table row
// ─────────────────────────────────────────────────────────────

function VendorRiskRow({
  vendor,
  latestAssessment,
  openFindingCount,
}: {
  vendor: Vendor;
  latestAssessment: VendorAssessment | null;
  openFindingCount: number;
}) {
  const key = critKey(vendor);
  const colors = CRIT_COLORS[key] ?? CRIT_COLORS.uncategorized!;
  const isHighRisk = vendor.criticality === "critical" || vendor.criticality === "high";
  const neverAssessed = latestAssessment === null;

  const showRedBorder = (isHighRisk && neverAssessed) || (isHighRisk && openFindingCount > 0);
  const showOrangeBorder = vendor.criticality === "high" && openFindingCount > 0 && !showRedBorder;

  const borderLeft = showRedBorder
    ? "3px solid rgba(239,68,68,0.5)"
    : showOrangeBorder
    ? "3px solid rgba(249,115,22,0.3)"
    : undefined;

  const lastAssessmentDisplay = latestAssessment
    ? fmtDate(latestAssessment.performed_at)
    : isHighRisk
    ? "Never assessed"
    : "—";
  const lastAssessmentColor = !latestAssessment && isHighRisk ? "#fca5a5" : "#475569";

  return (
    <tr
      className="border-t hover:bg-white/[0.02] transition-colors"
      style={{ borderColor: "#1e293b", borderLeft }}
    >
      <td className="px-5 py-3">
        <Link
          href={`/vendors/${vendor.id}`}
          className="text-sm font-medium hover:text-teal-300 transition-colors"
          style={{ color: "#f1f5f9" }}
        >
          {vendor.name}
        </Link>
      </td>
      <td className="px-5 py-3">
        {vendor.criticality ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{ background: colors.badge, color: colors.text }}
          >
            {vendor.criticality.charAt(0).toUpperCase() + vendor.criticality.slice(1)}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "#334155" }}>—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span className="text-xs" style={{ color: vendor.category ? "#94a3b8" : "#334155" }}>
          {vendor.category ?? "—"}
        </span>
      </td>
      <td className="px-5 py-3">
        {vendor.data_sensitivity ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs"
            style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8" }}
          >
            {vendor.data_sensitivity}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "#334155" }}>—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span className="text-xs" style={{ color: lastAssessmentColor }}>
          {lastAssessmentDisplay}
        </span>
      </td>
      <td className="px-5 py-3">
        {openFindingCount > 0 ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{ background: "rgba(245,158,11,0.15)", color: "#fcd34d" }}
          >
            {openFindingCount}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "#334155" }}>0</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
          style={{ background: "rgba(34,197,94,0.12)", color: "#86efac" }}
        >
          Active
        </span>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Attention card
// ─────────────────────────────────────────────────────────────

function AttentionCard({
  vendor,
  neverAssessed,
  openFindingCount,
}: {
  vendor: Vendor;
  neverAssessed: boolean;
  openFindingCount: number;
}) {
  const key = critKey(vendor);
  const colors = CRIT_COLORS[key] ?? CRIT_COLORS.uncategorized!;
  const reason = neverAssessed
    ? "Never assessed"
    : `${openFindingCount} open finding${openFindingCount !== 1 ? "s" : ""}`;
  const reasonColor = neverAssessed ? "#fca5a5" : "#fcd34d";

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border px-5 py-4"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0"
          style={{ background: colors.badge, color: colors.text }}
        >
          {vendor.criticality ? vendor.criticality.charAt(0).toUpperCase() + vendor.criticality.slice(1) : "—"}
        </span>
        <span className="text-sm font-medium truncate" style={{ color: "#f1f5f9" }}>
          {vendor.name}
        </span>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <span className="text-xs font-medium" style={{ color: reasonColor }}>{reason}</span>
        <Link
          href={`/vendors/${vendor.id}`}
          className="text-xs font-medium hover:opacity-80 transition-opacity"
          style={{ color: "#00c4b4" }}
        >
          Review →
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function VendorRiskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [vendorsData, assessmentsData, findingsData] = await Promise.all([
    getVendors(token, "active"),
    getVendorAssessments(token, 100),
    getFindings(token, { domain: "Vendor Risk", status: "open", limit: 100 }),
  ]);

  if (vendorsData === null) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/vendors" className="text-xs font-medium mb-6 inline-block transition-colors hover:opacity-80" style={{ color: "#64748b" }}>
          ← Vendors
        </Link>
        <div className="rounded-xl border p-10 text-center" style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}>
          <p className="text-sm" style={{ color: "#94a3b8" }}>Vendor data is not available for your current plan.</p>
        </div>
      </div>
    );
  }

  // Build cross-reference maps.
  const assessmentCountByVendor = new Map<string, number>();
  const latestAssessmentByVendor = new Map<string, VendorAssessment>();
  const assessmentVendorMap = new Map<string, string>();

  for (const a of assessmentsData?.assessments ?? []) {
    assessmentCountByVendor.set(
      a.vendor_id,
      (assessmentCountByVendor.get(a.vendor_id) ?? 0) + 1
    );
    assessmentVendorMap.set(a.id, a.vendor_id);
    // Keep the most recent per vendor (assume sorted by created_at DESC from API).
    if (!latestAssessmentByVendor.has(a.vendor_id)) {
      latestAssessmentByVendor.set(a.vendor_id, a);
    }
  }

  const openFindingsByVendor = new Map<string, number>();
  for (const f of findingsData?.findings ?? []) {
    if (f.source_type === "vendor_review" && f.source_id) {
      const vendorId = assessmentVendorMap.get(f.source_id);
      if (vendorId) {
        openFindingsByVendor.set(vendorId, (openFindingsByVendor.get(vendorId) ?? 0) + 1);
      }
    }
  }

  const allVendors = vendorsData.vendors;
  const sortedVendors = sortVendors(allVendors);

  const criticalCount      = allVendors.filter((v) => v.criticality === "critical").length;
  const highCount          = allVendors.filter((v) => v.criticality === "high").length;
  const needAssessmentCount = allVendors.filter((v) => (assessmentCountByVendor.get(v.id) ?? 0) === 0).length;

  const needsAttention = sortedVendors.filter((v) => {
    const isHighRisk = v.criticality === "critical" || v.criticality === "high";
    if (!isHighRisk) return false;
    const hasAssessment = (assessmentCountByVendor.get(v.id) ?? 0) > 0;
    const hasOpenFindings = (openFindingsByVendor.get(v.id) ?? 0) > 0;
    return !hasAssessment || hasOpenFindings;
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Back link */}
      <Link
        href="/vendors"
        className="text-xs font-medium mb-6 inline-block transition-colors hover:opacity-80"
        style={{ color: "#64748b" }}
      >
        ← Vendors
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
          Vendor Risk
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          Risk concentration across your vendor portfolio
        </p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile
          label="Critical Vendors"
          count={criticalCount}
          color="#fca5a5"
          href="/vendors?criticality=critical"
        />
        <StatTile
          label="High Risk"
          count={highCount}
          color="#fdba74"
          href="/vendors?criticality=high"
        />
        <StatTile
          label="Need Assessment"
          count={needAssessmentCount}
          color={needAssessmentCount > 0 ? "#fcd34d" : "#f1f5f9"}
          href="/vendors"
        />
        <StatTile
          label="Total Active"
          count={allVendors.length}
          color="#00c4b4"
          href="/vendors"
        />
      </div>

      {/* Criticality Distribution */}
      <div
        className="rounded-xl border p-5 mb-8"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#64748b" }}>
          Criticality Distribution
        </p>
        <CriticalityBar vendors={allVendors} />
      </div>

      {/* Vendor Risk Table */}
      {allVendors.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid #1e293b" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              All Vendors
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Vendor", "Criticality", "Category", "Data Sensitivity", "Last Assessment", "Open Findings", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "#475569" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedVendors.map((vendor) => (
                  <VendorRiskRow
                    key={vendor.id}
                    vendor={vendor}
                    latestAssessment={latestAssessmentByVendor.get(vendor.id) ?? null}
                    openFindingCount={openFindingsByVendor.get(vendor.id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {allVendors.length === 0 && (
        <div
          className="rounded-xl border p-10 text-center mb-8"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No active vendors. Add vendors to see your risk concentration.
          </p>
          <Link
            href="/vendors/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Vendor
          </Link>
        </div>
      )}

      {/* Requires Attention */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: "#64748b" }}>
          Requires Attention
        </h2>
        {needsAttention.length === 0 ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(34,197,94,0.2)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
              No high-risk vendors need immediate attention.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {needsAttention.map((vendor) => (
              <AttentionCard
                key={vendor.id}
                vendor={vendor}
                neverAssessed={(assessmentCountByVendor.get(vendor.id) ?? 0) === 0}
                openFindingCount={openFindingsByVendor.get(vendor.id) ?? 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
