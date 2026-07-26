import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendors,
  getVendorAssessments,
  type Vendor,
} from "@/lib/api";
// EAR Phase 4: badges come from the cross-domain kit (was a local duplicate).
import { CriticalityBadge, MetaChip } from "@/components/assetKit";

const CRIT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const BANNER_STYLES: Record<string, React.CSSProperties> = {
  critical: { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" },
  high:     { background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)", color: "#fdba74" },
  medium:   { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#fcd34d" },
  low:      { background: "rgba(34,197,94,0.08)",  border: "1px solid rgba(34,197,94,0.25)",  color: "#86efac" },
};

export default async function VendorsPage({
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
  const critFilter = sp.criticality ?? null;
  const showInactive = sp.show_inactive === "1";
  // Shared platform search (2–120 bounds, engine-resolved via the asset-search
  // capability: name, product alias, exact UUID). A URL param like the filters.
  const search =
    typeof sp.q === "string" && sp.q.trim().length >= 2 && sp.q.trim().length <= 120
      ? sp.q.trim()
      : undefined;

  const [activeData, archivedData, assessmentsData] = await Promise.all([
    getVendors(token, "active", { q: search }),
    showInactive ? getVendors(token, "archived", { q: search }) : Promise.resolve(null),
    getVendorAssessments(token, 100),
  ]);

  // Every navigation on this page preserves the OTHER axes — a pill click must
  // not silently drop an active search, and a search must not drop the filters.
  const vendorsHref = (over: { crit?: string | null; inactive?: boolean; q?: string | null } = {}) => {
    const p = new URLSearchParams();
    const crit = over.crit === undefined ? critFilter : over.crit;
    const inactive = over.inactive === undefined ? showInactive : over.inactive;
    const term = over.q === undefined ? search : over.q;
    if (crit) p.set("criticality", crit);
    if (inactive) p.set("show_inactive", "1");
    if (term) p.set("q", term);
    const s = p.toString();
    return s ? `/vendors?${s}` : "/vendors";
  };

  const vendorsData = activeData;

  // Build vendor_id → assessment count.
  const assessmentCountByVendor = new Map<string, number>();
  for (const a of assessmentsData?.assessments ?? []) {
    assessmentCountByVendor.set(
      a.vendor_id,
      (assessmentCountByVendor.get(a.vendor_id) ?? 0) + 1
    );
  }

  // The open-finding count now arrives ON the vendor, computed in the database.
  //
  // It used to be grouped in this file from getFindings(domain:'Vendor Risk',
  // status:'open', limit:100) — the org's findings, capped, then bucketed by vendor
  // via an assessment map that was ITSELF capped at 100 assessments. Past either cap
  // a vendor's findings simply vanished, and its card showed no badge at all: a
  // confident zero for a vendor that had open findings. A count derived from a
  // bounded page is a cap wearing a count's clothes.

  const activeVendors = vendorsData?.vendors ?? [];
  const archivedVendors = archivedData?.vendors ?? [];
  const allVendors = showInactive
    ? [...activeVendors, ...archivedVendors]
    : activeVendors;

  // Local criticality counts for pill badges.
  const critCounts = {
    critical: allVendors.filter((v) => v.criticality === "critical").length,
    high:     allVendors.filter((v) => v.criticality === "high").length,
    medium:   allVendors.filter((v) => v.criticality === "medium").length,
    low:      allVendors.filter((v) => v.criticality === "low").length,
  };

  // Filter for display.
  const displayVendors = critFilter
    ? allVendors.filter((v) => v.criticality === critFilter)
    : allVendors;

  const bannerStyle = critFilter ? BANNER_STYLES[critFilter] : null;
  const critLabel = critFilter
    ? critFilter.charAt(0).toUpperCase() + critFilter.slice(1)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Criticality filter banner */}
      {critFilter && bannerStyle && (
        <div
          className="mb-6 flex items-center justify-between gap-4 rounded-xl px-5 py-3 flex-wrap"
          style={bannerStyle}
        >
          <p className="text-sm">
            Showing <strong>{displayVendors.length}</strong> {critLabel} vendor{displayVendors.length !== 1 ? "s" : ""}
          </p>
          <Link
            href={vendorsHref({ crit: null })}
            className="text-xs font-medium flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ color: "#94a3b8" }}
          >
            Clear filter →
          </Link>
        </div>
      )}

      <div className="mb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Vendors</h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            {critFilter
              ? `Showing ${displayVendors.length} of ${allVendors.length} vendor${allVendors.length !== 1 ? "s" : ""}`
              : "Third-party vendors tracked for this organization. Sorted by risk level."}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {activeVendors.length > 0 && !critFilter && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {activeVendors.length} active
            </span>
          )}
          <Link
            href={vendorsHref({ inactive: !showInactive })}
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: showInactive ? "#94a3b8" : "#475569" }}
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Link>
          <Link
            href="/vendors/risk"
            className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: "#00c4b4" }}
          >
            Risk Report →
          </Link>
          <a
            href="/api/export/vendors"
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
            &#8595; Export CSV
          </a>
          <Link
            href="/vendors/import"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:border-teal-500 hover:text-teal-300"
            style={{ border: "1px solid #1e2d45", color: "#cbd5e1", background: "transparent" }}
          >
            Import CSV
          </Link>
          <Link
            href="/vendors/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add Vendor
          </Link>
        </div>
      </div>

      {/* Search — the platform list-page pattern: the term is a URL param resolved by
          the shared asset-search capability (name, product alias, exact UUID), so it
          composes with the pills below. Hidden inputs carry the active filters. */}
      <form action="/vendors" method="get" className="mb-6">
        <label
          htmlFor="vendor-search"
          className="block text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: "#64748b" }}
        >
          Search
        </label>
        {critFilter && <input type="hidden" name="criticality" value={critFilter} />}
        {showInactive && <input type="hidden" name="show_inactive" value="1" />}
        <div className="flex items-center gap-2 w-full max-w-xl">
          <input
            id="vendor-search"
            type="search"
            name="q"
            defaultValue={search ?? ""}
            minLength={2}
            maxLength={120}
            placeholder="Name, vendor ID, product alias..."
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0" }}
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }}
          >
            Search
          </button>
        </div>
      </form>

      {/* Criticality filter pills */}
      {allVendors.length > 0 && (
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Criticality
          </span>
          <FilterPill label="All" href={vendorsHref({ crit: null })} active={!critFilter} />
          {(["critical", "high", "medium", "low"] as const).map((level) => {
            const count = critCounts[level];
            const label =
              level === "critical" ? `Critical${count > 0 ? ` (${count})` : ""}` :
              level === "high"     ? `High${count > 0 ? ` (${count})` : ""}` :
              level === "medium"   ? `Medium${count > 0 ? ` (${count})` : ""}` :
                                     `Low${count > 0 ? ` (${count})` : ""}`;
            return (
              <FilterPill
                key={level}
                label={label}
                href={vendorsHref({ crit: level })}
                active={critFilter === level}
              />
            );
          })}
        </div>
      )}

      {/* Not entitled */}
      {vendorsData === null && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Vendor data is not available for your current plan.
          </p>
        </div>
      )}

      {/* Entitled but nothing to show — an active search gets an honest "no match",
          never "add your first vendor" over a populated org. */}
      {vendorsData !== null && allVendors.length === 0 && search && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No vendors match your search.{" "}
            <Link
              href={vendorsHref({ q: null })}
              className="font-medium hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              Clear search →
            </Link>
          </p>
        </div>
      )}

      {/* Entitled but no vendors yet */}
      {vendorsData !== null && allVendors.length === 0 && !search && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No active vendors.{" "}
            <Link
              href="/vendors/new"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              Add your first vendor
            </Link>{" "}
            to populate this view.
          </p>
        </div>
      )}

      {/* No results for current filter */}
      {vendorsData !== null && allVendors.length > 0 && displayVendors.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No {critLabel} vendors.{" "}
            <Link href={vendorsHref({ crit: null })} className="font-medium hover:opacity-80" style={{ color: "#00c4b4" }}>
              View all →
            </Link>
          </p>
        </div>
      )}

      {/* Vendor list */}
      {displayVendors.length > 0 && (
        <div className="space-y-3">
          {displayVendors.map((vendor) => (
            <Link key={vendor.id} href={`/vendors/${vendor.id}`} className="block">
              <VendorRow
                vendor={vendor}
                assessmentCount={assessmentCountByVendor.get(vendor.id) ?? 0}
                activeFindingCount={vendor.active_findings_count ?? 0}
              />
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

function FilterPill({ label, href, active }: { label: string; href: string; active: boolean }) {
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

function VendorRow({
  vendor,
  assessmentCount,
  activeFindingCount,
}: {
  vendor: Vendor;
  assessmentCount: number;
  activeFindingCount: number;
}) {
  const lastReviewed = vendor.last_reviewed_at
    ? new Date(vendor.last_reviewed_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;
  const isArchived = vendor.status === "archived";

  return (
    <div
      className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 cursor-pointer transition-colors"
      style={isArchived ? { opacity: 0.65 } : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: "#f1f5f9" }}>
              {vendor.name}
            </span>
            <CriticalityBadge value={vendor.criticality} />
            {isArchived && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                style={{ background: "rgba(100,116,139,0.15)", color: "#64748b", border: "1px solid rgba(100,116,139,0.2)" }}
              >
                Inactive
              </span>
            )}
          </div>
          {vendor.service_description && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: "#94a3b8" }}>
              {vendor.service_description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <MetaChip label="Category" value={vendor.category} />
            <MetaChip label="Data"     value={vendor.data_sensitivity} />
            <MetaChip label="Access"   value={vendor.access_level} />
            {vendor.website && (
              <span className="text-xs truncate max-w-xs" style={{ color: "#475569" }}>
                {vendor.website}
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right space-y-1">
          <div>
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              {assessmentCount > 0
                ? `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
                : "No assessments"}
            </span>
          </div>
          {activeFindingCount > 0 && (
            <div>
              <span className="text-xs font-semibold" style={{ color: "#fdba74" }}>
                {activeFindingCount} active finding{activeFindingCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {lastReviewed && (
            <div>
              <span className="text-xs" style={{ color: "#475569" }}>
                Reviewed {lastReviewed}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
