import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendors,
  type Vendor,
  type VendorsResponse,
  type VendorListOpts,
  type VendorCriticalityCounts,
} from "@/lib/api";
// EAR Phase 4: badges come from the cross-domain kit (was a local duplicate).
import { CriticalityBadge, MetaChip } from "@/components/assetKit";
import { ListSearchForm } from "@/components/ListSearchForm";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { UnknownValue, UnknownValueNote } from "@/components/edx/UnknownValue";
import { isUnavailable } from "@/lib/edx/loadState";

const CRIT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

/** The four bands the pills offer. `uncategorized` is counted by the engine but has no pill. */
const CRIT_LEVELS = ["critical", "high", "medium", "low"] as const;
type CritLevel = (typeof CRIT_LEVELS)[number];

function isCritLevel(v: string | null): v is CritLevel {
  return v !== null && (CRIT_LEVELS as readonly string[]).includes(v);
}

/** An exact count, or `null` when the number is not known. Never collapse the two. */
type ExactCount = number | null;

/**
 * Add the `total`s of the status populations on screen (active, plus archived
 * when "Show inactive" is on).
 *
 * Unknown is contagious ON PURPOSE: if any population failed or predates the
 * aggregate, the sum is unknown rather than a partial figure presented whole.
 * A number that silently omits the archived half is a wrong number, not a
 * stale one.
 */
function sumTotals(responses: readonly (VendorsResponse | null)[]): ExactCount {
  let sum = 0;
  for (const r of responses) {
    if (!r || typeof r.total !== "number") return null;
    sum += r.total;
  }
  return sum;
}

/**
 * The same discipline for the never-assessed count: vendors with zero rows in
 * vendor_assessments, summed across the status populations on screen.
 *
 * Unknown is contagious here for a sharper reason than usual — this number is
 * printed on a pill that LINKS to ?assessed=never. A partial sum would send the
 * customer to a list that disagrees with the number that sent them there.
 */
function sumNeverAssessed(responses: readonly (VendorsResponse | null)[]): ExactCount {
  let sum = 0;
  for (const r of responses) {
    if (!r || typeof r.never_assessed_count !== "number") return null;
    sum += r.never_assessed_count;
  }
  return sum;
}

/** The same discipline for the criticality breakdown. */
function sumCriticality(
  responses: readonly (VendorsResponse | null)[]
): VendorCriticalityCounts | null {
  const out: VendorCriticalityCounts = {
    critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0,
  };
  for (const r of responses) {
    const b = r?.by_criticality;
    if (!b) return null;
    out.critical += b.critical;
    out.high += b.high;
    out.medium += b.medium;
    out.low += b.low;
    out.uncategorized += b.uncategorized;
  }
  return out;
}

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
  // ?assessed=never — vendors with NO assessment on record: zero rows in
  // vendor_assessments, applied in SQL by the engine.
  //
  // This axis used to be ?reviewed=never, which filters last_reviewed_at IS
  // NULL. RULING (2026-08-09): that is not a valid customer-facing metric —
  // nothing in the product ever writes last_reviewed_at, so the pill counted a
  // column that is NULL for effectively every vendor and told the customer
  // something false about their own TPRM programme. Exact, engine-computed,
  // and still wrong: making a number exact cannot rescue a meaningless
  // predicate. The engine keeps ?reviewed=never for API compatibility; no
  // surface may use it.
  const neverAssessedOnly = sp.assessed === "never";
  // Shared platform search (2–120 bounds, engine-resolved via the asset-search
  // capability: name, product alias, exact UUID). A URL param like the filters.
  const search =
    typeof sp.q === "string" && sp.q.trim().length >= 2 && sp.q.trim().length <= 120
      ? sp.q.trim()
      : undefined;

  // The status populations on screen. "Show inactive" adds the archived half,
  // and every count below is summed across exactly these.
  const statuses = showInactive
    ? (["active", "archived"] as const)
    : (["active"] as const);

  const critFilterLevel = isCritLevel(critFilter) ? critFilter : undefined;

  /** One filter set, read across the visible status populations. */
  const read = (opts: VendorListOpts) =>
    Promise.all(statuses.map((s) => getVendors(token, s, opts)));

  // The LIST filter set. criticality and assessed both go to the ENGINE.
  //
  // They used to be applied here, over the fetched page — and the engine caps a
  // page at 100, so under "Critical" an org past the cap simply did not see
  // critical vendors that existed. Filtering a bounded slice can only
  // under-report, and it made every exact aggregate below contradict the rows
  // beside it.
  const listOpts: VendorListOpts = {
    ...(search ? { q: search } : {}),
    ...(critFilterLevel ? { criticality: critFilterLevel } : {}),
    ...(neverAssessedOnly ? { assessed: "never" as const } : {}),
  };

  // A pill's count must describe the population its own link navigates to:
  // every active filter EXCEPT the axis that pill toggles. Otherwise the number
  // on the pill is unreachable by clicking it.
  const critCountOpts: VendorListOpts = {
    ...(search ? { q: search } : {}),
    ...(neverAssessedOnly ? { assessed: "never" as const } : {}),
    limit: 1,
  };

  // The never-assessed pill needs NO request of its own. `never_assessed_count`
  // is already an exact count of the zero-assessment vendors WITHIN whatever
  // filter set the response describes — so the list response answers the pill
  // directly, in both states:
  //   * pill inactive → the list set is {q, criticality}, and its
  //     never_assessed_count is exactly the population ?assessed=never reaches;
  //   * pill active   → the list set already has assessed=never applied, so
  //     never_assessed_count equals its own total. Same number.
  // The dedicated reviewed=never round-trip this replaces is therefore gone.
  const [listRes, critRes] = await Promise.all([
    read(listOpts),
    critFilterLevel ? read(critCountOpts) : null,
  ]);

  const critSource = critRes ?? listRes;

  const [activeData, archivedData] = [listRes[0] ?? null, listRes[1] ?? null];

  // Every navigation on this page preserves the OTHER axes — a pill click must
  // not silently drop an active search, and a search must not drop the filters.
  const vendorsHref = (over: { crit?: string | null; inactive?: boolean; q?: string | null; assessed?: string | null } = {}) => {
    const p = new URLSearchParams();
    const crit = over.crit === undefined ? critFilter : over.crit;
    const inactive = over.inactive === undefined ? showInactive : over.inactive;
    const term = over.q === undefined ? search : over.q;
    const assessed = over.assessed === undefined ? (neverAssessedOnly ? "never" : null) : over.assessed;
    if (crit) p.set("criticality", crit);
    if (inactive) p.set("show_inactive", "1");
    if (term) p.set("q", term);
    if (assessed) p.set("assessed", assessed);
    const s = p.toString();
    return s ? `/vendors?${s}` : "/vendors";
  };

  const vendorsData = activeData;

  // The per-vendor assessment count arrives ON the vendor now, computed in the
  // database by GET /api/vendors.
  //
  // It was grouped here from getVendorAssessments(limit:100) — the ORG's
  // assessments, capped, answering a per-vendor question. Past 100 assessments
  // in the org a vendor's rows fell off that page and its card printed "No
  // assessments": a confident claim about the customer's records produced by a
  // page boundary. Same defect, same fix, same predicate as the pill above.

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
  // The rows are already the filtered population — the engine applied every
  // axis — so there is no second, client-side filter to under-report.
  const displayVendors = showInactive
    ? [...activeVendors, ...archivedVendors]
    : activeVendors;

  // EXACT counts, over the population each label promises.
  //
  // These were `allVendors.filter(…).length` — the ≤100 page counted as though
  // it were the register. Below the cap that is right, which is why it lasted;
  // past it every pill quietly under-counted and "Showing N of M" printed a cap
  // in the position where the same idiom on /actions means a true total.
  const critCounts = sumCriticality(critSource);
  const neverAssessedCount = sumNeverAssessed(listRes);
  /** The filtered population the rows belong to — the M in "Showing N of M". */
  const filteredTotal = sumTotals(listRes);
  /** Active-status size of the current filter set, for the header chip. */
  const activeTotal: ExactCount =
    activeData && typeof activeData.total === "number" ? activeData.total : null;
  /** The register WITHOUT the criticality axis — what the pills are counted over. */
  const registerTotal = sumTotals(critSource);

  const countsUnavailable =
    critCounts === null || neverAssessedCount === null || filteredTotal === null;

  // The pills stay reachable whenever the register has anything in it, even when
  // the CURRENT filter matches nothing — a filter that empties the page must not
  // also remove the control that clears it.
  const hasRegister = (registerTotal ?? 0) > 0 || displayVendors.length > 0;
  const isFiltered = Boolean(critFilter) || neverAssessedOnly;

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
            {filteredTotal === null ? (
              <>
                <UnknownValue label={`${critLabel} vendors`} /> {critLabel} vendors
              </>
            ) : (
              <>
                <strong>{filteredTotal}</strong> {critLabel} vendor
                {filteredTotal !== 1 ? "s" : ""}
              </>
            )}
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
            {critFilter ? (
              // N is what rendered; M is the engine's exact count of the same
              // filtered population. M used to be `allVendors.length` — the page
              // length, i.e. N's own ceiling — so the disclosure could never
              // actually disclose a truncation.
              filteredTotal === null ? (
                <>
                  Showing {displayVendors.length} vendor
                  {displayVendors.length !== 1 ? "s" : ""}; the filtered total
                  couldn&rsquo;t be loaded
                </>
              ) : (
                `Showing ${displayVendors.length} of ${filteredTotal} vendor${filteredTotal !== 1 ? "s" : ""}`
              )
            ) : (
              "Third-party vendors tracked for this organization. Sorted by risk level."
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {!critFilter && (activeTotal === null ? displayVendors.length > 0 : activeTotal > 0) && (
            <span className="text-sm" style={{ color: "#94a3b8" }}>
              {activeTotal === null ? <UnknownValue label="Active vendors" /> : activeTotal} active
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

      {/* Search — the shared register list-page form; the term is a URL param
          resolved by the asset-search capability (name, product alias, exact UUID),
          so it composes with the pills below. `hidden` carries the active filters. */}
      <ListSearchForm
        action="/vendors"
        inputId="vendor-search"
        placeholder="Name, vendor ID, product alias..."
        defaultValue={search ?? ""}
        hidden={{
          ...(critFilter ? { criticality: critFilter } : {}),
          ...(showInactive ? { show_inactive: "1" } : {}),
          ...(neverAssessedOnly ? { assessed: "never" } : {}),
        }}
      />

      {/* Criticality filter pills — each count is the exact size of the
          population its own link navigates to, so clicking a pill reproduces
          the number printed on it. */}
      {hasRegister && (
        <div className="mb-6 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Criticality
          </span>
          <FilterPill label="All" href={vendorsHref({ crit: null })} active={!critFilter} />
          {CRIT_LEVELS.map((level) => {
            const count = critCounts?.[level];
            const base = level.charAt(0).toUpperCase() + level.slice(1);
            return (
              <FilterPill
                key={level}
                // An unknown count omits the parenthetical rather than printing
                // "(0)" — a pill that says zero is a claim about the register.
                label={typeof count === "number" && count > 0 ? `${base} (${count})` : base}
                href={vendorsHref({ crit: level })}
                active={critFilter === level}
              />
            );
          })}
          <span className="text-xs font-semibold uppercase tracking-wide ml-3 mr-1" style={{ color: "#64748b" }}>
            Assessed
          </span>
          {/* Label, count, and destination describe ONE population: vendors
              with zero rows in vendor_assessments. The count comes from the
              engine's never_assessed_count and the link from ?assessed=never,
              and both are built from the same SQL literal — so clicking the
              pill reproduces the number printed on it by construction. */}
          <FilterPill
            label={`Never assessed${neverAssessedCount !== null && neverAssessedCount > 0 ? ` (${neverAssessedCount})` : ""}`}
            href={vendorsHref({ assessed: neverAssessedOnly ? null : "never" })}
            active={neverAssessedOnly}
          />
        </div>
      )}

      {/* A count that failed to load is disclosed, never rendered as a zero.
          Gated on the register actually having count-bearing UI on screen: a
          successful EMPTY response renders no counts at all, and disclosing
          nothing would turn an honest empty state back into an outage. */}
      {!isUnavailable(vendorsData) && hasRegister && countsUnavailable && (
        <UnknownValueNote subject="Some vendor counts" />
      )}

      {/* EDX-1: a failed fetch, not a plan limit. getVendors returns null for
          ANY non-OK response or thrown request, and this page already
          redirected non-platform callers above — so "not available for your
          current plan" told a paying customer their subscription excluded a
          feature they had bought, every time the engine hiccupped. */}
      {isUnavailable(vendorsData) && (
        <UnavailableNotice
          subject="Vendors"
          denial="not a limit of your plan, and not an empty register"
          reassurance="Your vendors are unchanged."
          retryHref={vendorsHref()}
        />
      )}

      {/* Nothing to show. Each branch says which of the three reasons applies —
          a filter, a search, or a genuinely empty register — because "Add your
          first vendor" over a populated org is the same class of falsehood as a
          capped count. The branches are now mutually exclusive by construction:
          the unfiltered, unsearched one is the only place that invitation can
          appear, and it is reachable only when the register really is empty. */}
      {vendorsData !== null && displayVendors.length === 0 && isFiltered && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No {critLabel ? `${critLabel} ` : ""}
            {neverAssessedOnly ? "never-assessed " : ""}vendors.{" "}
            <Link
              href={vendorsHref({ crit: null, assessed: null })}
              className="font-medium hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              View all →
            </Link>
          </p>
        </div>
      )}

      {vendorsData !== null && displayVendors.length === 0 && !isFiltered && search && (
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

      {/* Entitled, unfiltered, unsearched, and genuinely empty. */}
      {vendorsData !== null && displayVendors.length === 0 && !isFiltered && !search && (
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

      {/* Vendor list */}
      {displayVendors.length > 0 && (
        <div className="space-y-3">
          {displayVendors.map((vendor) => (
            <Link key={vendor.id} href={`/vendors/${vendor.id}`} className="block">
              <VendorRow
                vendor={vendor}
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
  activeFindingCount,
}: {
  vendor: Vendor;
  activeFindingCount: number;
}) {
  /**
   * Assessment state, exact and per-vendor — or `null` when the engine build
   * predates the field. The third state is load-bearing: unknown must not
   * render as "Never assessed", which is a claim about the customer's records.
   */
  const assessmentCount =
    typeof vendor.assessment_count === "number" ? vendor.assessment_count : null;
  const lastAssessed = vendor.latest_assessment_at
    ? new Date(vendor.latest_assessment_at).toLocaleDateString("en-US", {
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
              {assessmentCount === null ? (
                <UnknownValue label="Assessment count" />
              ) : assessmentCount > 0 ? (
                `${assessmentCount} assessment${assessmentCount !== 1 ? "s" : ""}`
              ) : (
                "No assessments"
              )}
            </span>
          </div>
          {activeFindingCount > 0 && (
            <div>
              <span className="text-xs font-semibold" style={{ color: "#fdba74" }}>
                {activeFindingCount} active finding{activeFindingCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div>
            {assessmentCount === null ? (
              // Unknown is not an accusation. It was never safe to print
              // "Never assessed" for a vendor whose state failed to load.
              <UnknownValue label="Assessment state" />
            ) : assessmentCount === 0 ? (
              // A vendor with no assessment on record says so — silence read
              // as "fine" is how unassessed vendors stay unassessed.
              <span className="text-xs font-medium" style={{ color: "#fcd34d" }}>
                Never assessed
              </span>
            ) : lastAssessed ? (
              <span className="text-xs" style={{ color: "#475569" }}>
                Assessed {lastAssessed}
              </span>
            ) : (
              // Assessed, but no date came back: a dash beside "assessed"
              // would read as "never".
              <UnknownValue label="Last assessed" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
