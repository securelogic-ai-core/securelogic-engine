import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendors,
  type Vendor,
  type VendorCriticalityCounts,
} from "@/lib/api";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { UnknownValue, UnknownValueNote } from "@/components/edx/UnknownValue";
import { isUnavailable } from "@/lib/edx/loadState";

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

/** An exact count, or `null` when the number is not known. Never collapse the two. */
type ExactCount = number | null;

/**
 * Whether a vendor has ever been assessed — or `null` when that is not known.
 *
 * The third state is the point. This used to be a boolean derived from the org's
 * assessments fetched with limit:100: a vendor missing from that page was
 * indistinguishable from a vendor with no assessments, so "we couldn't see it"
 * rendered as the confident claim "Never assessed". It now comes from
 * `assessment_count`, computed per vendor in the database over the whole table,
 * and is unknown only when the engine build predates that field.
 */
type AssessedState = boolean | null;

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

/**
 * The assessment-based definition, preserved exactly: a vendor is assessed when
 * it has AT LEAST ONE row in vendor_assessments. Not `last_reviewed_at`, which
 * is a different metric on a field nothing in the product maintains.
 */
function assessedOf(v: Vendor): AssessedState {
  return typeof v.assessment_count === "number" ? v.assessment_count > 0 : null;
}

function isHighRiskVendor(v: Vendor): boolean {
  return v.criticality === "critical" || v.criticality === "high";
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
  /** `null` renders the shared unknown marker — a dash is not a zero. */
  count: ExactCount;
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
      <p className="text-3xl font-bold" style={{ color }}>
        {count === null ? <UnknownValue label={label} style={{ color: "#475569" }} /> : count}
      </p>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// Criticality distribution stacked bar
// ─────────────────────────────────────────────────────────────

/**
 * The distribution of the whole active register.
 *
 * It used to take the returned rows and tally them — so an org past the 100-row
 * cap saw the shape of its first page drawn as the shape of its portfolio, with
 * every proportion wrong and the total silently equal to the cap.
 */
function CriticalityBar({ counts }: { counts: VendorCriticalityCounts | null }) {
  if (counts === null) {
    return (
      <p className="text-sm" style={{ color: "#64748b" }}>
        The criticality distribution couldn&rsquo;t be loaded. That is a loading
        problem, not an empty portfolio &mdash; your vendors are unchanged.
      </p>
    );
  }

  const total =
    counts.critical + counts.high + counts.medium + counts.low + counts.uncategorized;

  const segments = [
    { key: "critical",      label: "Critical",      color: "#ef4444", count: counts.critical },
    { key: "high",          label: "High",          color: "#f97316", count: counts.high },
    { key: "medium",        label: "Medium",        color: "#f59e0b", count: counts.medium },
    { key: "low",           label: "Low",           color: "#22c55e", count: counts.low },
    { key: "uncategorized", label: "None set",      color: "#334155", count: counts.uncategorized },
  ].filter((s) => s.count > 0);

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
  activeFindingCount,
}: {
  vendor: Vendor;
  activeFindingCount: number;
}) {
  const key = critKey(vendor);
  const colors = CRIT_COLORS[key] ?? CRIT_COLORS.uncategorized!;
  const isHighRisk = isHighRiskVendor(vendor);
  const assessed = assessedOf(vendor);

  // Unknown draws NO border. The red border is an accusation — "high-risk and
  // never assessed" — and it must not be made on the strength of a value the
  // page failed to load.
  const showRedBorder =
    (isHighRisk && assessed === false) || (isHighRisk && activeFindingCount > 0);
  const showOrangeBorder =
    vendor.criticality === "high" && activeFindingCount > 0 && !showRedBorder;

  const borderLeft = showRedBorder
    ? "3px solid rgba(239,68,68,0.5)"
    : showOrangeBorder
    ? "3px solid rgba(249,115,22,0.3)"
    : undefined;

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
        <LastAssessmentCell vendor={vendor} assessed={assessed} isHighRisk={isHighRisk} />
      </td>
      <td className="px-5 py-3">
        {activeFindingCount > 0 ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{ background: "rgba(245,158,11,0.15)", color: "#fcd34d" }}
          >
            {activeFindingCount}
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

/**
 * "Last Assessment" has three answers, and only two of them are a date or a
 * dash. Assessed-but-date-unknown and never-assessed are different sentences.
 */
function LastAssessmentCell({
  vendor,
  assessed,
  isHighRisk,
}: {
  vendor: Vendor;
  assessed: AssessedState;
  isHighRisk: boolean;
}) {
  if (assessed === null) {
    return <UnknownValue label="Last assessment" style={{ fontSize: "0.75rem" }} />;
  }
  if (assessed === false) {
    return (
      <span
        className="text-xs"
        style={{ color: isHighRisk ? "#fca5a5" : "#475569" }}
      >
        {isHighRisk ? "Never assessed" : "—"}
      </span>
    );
  }
  // Assessed, but the engine returned no date for it: still not a dash, because
  // a dash beside "assessed" reads as "never".
  if (!vendor.latest_assessment_at) {
    return <UnknownValue label="Last assessment" style={{ fontSize: "0.75rem" }} />;
  }
  return (
    <span className="text-xs" style={{ color: "#475569" }}>
      {fmtDate(vendor.latest_assessment_at)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Attention card
// ─────────────────────────────────────────────────────────────

function AttentionCard({
  vendor,
  neverAssessed,
  activeFindingCount,
}: {
  vendor: Vendor;
  neverAssessed: boolean;
  activeFindingCount: number;
}) {
  const key = critKey(vendor);
  const colors = CRIT_COLORS[key] ?? CRIT_COLORS.uncategorized!;
  const reason = neverAssessed
    ? "Never assessed"
    : `${activeFindingCount} active finding${activeFindingCount !== 1 ? "s" : ""}`;
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

  // One read. The org's assessments are no longer fetched here at all: the
  // page used to pull GET /api/vendor-assessments?limit=100 to answer "has this
  // vendor been assessed?", which is an ORG-wide cap answering a PER-VENDOR
  // question. Both the count and the per-row state now ride on the vendor row.
  const vendorsData = await getVendors(token, "active");

  // EDX-1: the whole page depends on the vendor register, so a failed fetch
  // fails the page — but it fails HONESTLY. This branch previously blamed the
  // customer's plan for what is any non-OK response from getVendors, on a
  // route that already redirected non-platform callers above.
  if (isUnavailable(vendorsData)) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/vendors" className="text-xs font-medium mb-6 inline-block transition-colors hover:opacity-80" style={{ color: "#64748b" }}>
          ← Vendors
        </Link>
        <UnavailableNotice
          subject="Vendor risk"
          denial="not a limit of your plan, and not an empty register"
          reassurance="Your vendors are unchanged."
          retryHref="/vendors/risk"
        />
      </div>
    );
  }

  // Open-finding counts arrive ON the vendor now, computed in the database by
  // GET /api/vendors. They used to be grouped here from a capped page of the org's
  // findings (limit:100) bucketed through a capped assessment map (limit:100) —
  // past either cap a vendor's findings vanished and the board showed it clean.
  // On THIS page that is not merely a wrong badge: `hasActiveFindings` drives the red
  // and orange risk borders, so a truncated count made a high-risk vendor with open
  // findings render as if it had none. A truncation is not a zero.
  // Metric Contract: the ACTIVE population, not the strictly-open one. This map
  // drives the red/orange risk borders and the needs-attention list, so counting
  // only untouched work made a high-risk vendor whose findings were all IN
  // REMEDIATION render as clean — the board went green precisely because the team
  // had started working. Active is the enterprise definition; the engine already
  // serves it as active_findings_count alongside the strictly-open twin.
  const activeFindingsOf = (v: Vendor): number => v.active_findings_count ?? 0;

  const allVendors = vendorsData.vendors;
  const sortedVendors = sortVendors(allVendors);

  // EXACT counts, over the population each label promises.
  //
  // These were `allVendors.filter(…).length` and a scan of a capped assessment
  // page. Below the 100-row cap that arithmetic is correct, which is exactly why
  // it survived review; past it every tile under-reported and "Total Active"
  // printed the cap itself. A cap counted as a population is not a stale number,
  // it is a confident wrong one.
  const critCounts: VendorCriticalityCounts | null = vendorsData.by_criticality ?? null;
  const criticalCount: ExactCount = critCounts?.critical ?? null;
  const highCount: ExactCount = critCounts?.high ?? null;
  const totalActive: ExactCount =
    typeof vendorsData.total === "number" ? vendorsData.total : null;
  const needAssessmentCount: ExactCount =
    typeof vendorsData.never_assessed_count === "number"
      ? vendorsData.never_assessed_count
      : null;

  const countsUnavailable =
    criticalCount === null ||
    highCount === null ||
    totalActive === null ||
    needAssessmentCount === null;

  // Requires Attention is an ENUMERATION, so exact aggregates cannot rescue it —
  // it can only be honest about the rows it actually holds. Two conditions have
  // to hold for the list to be provably complete:
  //
  //  1. Every high-risk vendor is on this page. The engine orders by criticality
  //     rank (critical, then high, then the rest), so if the register holds no
  //     more critical+high vendors than the slice has rows, the slice provably
  //     contains all of them.
  //  2. The assessed state is known for the high-risk rows we hold — otherwise a
  //     vendor could belong here and be silently omitted.
  const highRiskPopulation =
    critCounts === null ? null : critCounts.critical + critCounts.high;
  const highRiskFullyLoaded =
    highRiskPopulation !== null && highRiskPopulation <= allVendors.length;
  const assessedStateKnown = sortedVendors
    .filter(isHighRiskVendor)
    .every((v) => assessedOf(v) !== null);
  const attentionComplete = highRiskFullyLoaded && assessedStateKnown;

  // Unknown never qualifies a vendor for this list. "Never assessed" here is a
  // claim about the customer's own records; it is made only from a known false.
  const needsAttention = sortedVendors.filter((v) => {
    if (!isHighRiskVendor(v)) return false;
    return assessedOf(v) === false || activeFindingsOf(v) > 0;
  });

  /** The rows shown are still a page. Say so when the register is larger. */
  const rowsAreComplete = totalActive === null || totalActive <= allVendors.length;

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
          color={needAssessmentCount !== null && needAssessmentCount > 0 ? "#fcd34d" : "#f1f5f9"}
          href="/vendors"
        />
        <StatTile
          label="Total Active"
          count={totalActive}
          color="#00c4b4"
          href="/vendors"
        />
      </div>

      {countsUnavailable && <UnknownValueNote subject="Some vendor counts" />}

      {/* Criticality Distribution */}
      <div
        className="rounded-xl border p-5 mb-8"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#64748b" }}>
          Criticality Distribution
        </p>
        <CriticalityBar counts={critCounts} />
      </div>

      {/* Vendor Risk Table */}
      {allVendors.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <div className="px-5 py-4" style={{ borderBottom: "1px solid #1e293b" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              {rowsAreComplete ? "All Vendors" : "Vendors"}
            </h2>
            {!rowsAreComplete && (
              <p className="text-xs mt-1" style={{ color: "#64748b" }}>
                Showing {allVendors.length} of {totalActive}. The counts above
                describe all {totalActive} &mdash; this table is one page of them.
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Vendor", "Criticality", "Category", "Data Sensitivity", "Last Assessment", "Active Findings", "Status"].map((h) => (
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
                    activeFindingCount={activeFindingsOf(vendor)}
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
        {needsAttention.length > 0 ? (
          <div className="space-y-3">
            {needsAttention.map((vendor) => (
              <AttentionCard
                key={vendor.id}
                vendor={vendor}
                neverAssessed={assessedOf(vendor) === false}
                activeFindingCount={activeFindingsOf(vendor)}
              />
            ))}
            {!attentionComplete && <AttentionIncompleteNote />}
          </div>
        ) : attentionComplete ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(34,197,94,0.2)" }}
          >
            <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
              No high-risk vendors need immediate attention.
            </p>
          </div>
        ) : (
          // The all-clear is a CLAIM. It is only made when every high-risk
          // vendor was loaded and every one of them had a known assessed state.
          <div
            className="rounded-xl border p-8 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
          >
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              This list couldn&rsquo;t be completed, so it isn&rsquo;t an
              all-clear. Nothing needing attention was found in what loaded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown beneath a populated list that could not be proven complete. */
function AttentionIncompleteNote() {
  return (
    <p className="text-xs pt-1" role="note" style={{ color: "#64748b" }}>
      More vendors may need attention than are listed here &mdash; not all of
      them could be checked.
    </p>
  );
}
