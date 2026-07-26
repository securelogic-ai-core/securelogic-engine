/**
 * /assets — the unified Assets surface (EAR Phase 4).
 *
 * One cross-type list over the engine's asset_registry_v (GET /api/assets):
 * vendors, AI systems, enterprise entities, and the Phase-3a native types
 * (cloud resources, endpoints, APIs, identity systems) in a single registry
 * view with type filter chips. Per-type pages remain authoritative for
 * type-specific detail (EAR-AD-1 federation) — rows deep-link to them where
 * they exist.
 *
 * Dark: the engine 404s the route while SECURELOGIC_ASSET_REGISTRY_ENABLED is
 * off (→ neutral "not available" panel) and 403s without the
 * enterprise_context capability (→ entitlement affordance). The nav entry is
 * additionally hidden behind the app-side asset_registry nav flag
 * (fail-closed, the ECL two-switch model).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAssets } from "@/lib/api";
import {
  ASSET_TYPES,
  ASSET_PAGE,
  assetTypeLabel,
  assetDetailHref,
  assetCreateHref,
  assetsReadFailure,
  isAssetType,
  type AssetType,
  type CanonicalAsset,
} from "@/lib/assetRegistry";
import { parseOffsetParam } from "@/lib/enterpriseContextFormat";
import {
  CriticalityBadge,
  StatusChip,
  TypeChip,
  MetaChip,
  ReadFailurePanel,
} from "@/components/assetKit";

export default async function AssetsPage({
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
  const typeFilter = isAssetType(sp.asset_type) ? sp.asset_type : undefined;
  // The arrival context for the executive "Assets at risk" tile. It must survive every
  // refinement and every page turn, or the customer lands on the right list and the very
  // first click silently widens it back to the whole registry.
  const atRisk = sp.at_risk === "true";
  // Free-text search. Like the filters it is a URL param, so it composes with them,
  // survives pagination, and the engine's shared asset-search resolver does the
  // matching (name, asset ID, hostname, cloud account, native ref). Same 2–120
  // bounds as the findings entity search — out-of-bounds terms are not sent.
  const search =
    typeof sp.q === "string" && sp.q.trim().length >= 2 && sp.q.trim().length <= 120
      ? sp.q.trim()
      : undefined;
  const offset = parseOffsetParam(sp.offset);
  const limit = ASSET_PAGE.defaultLimit;

  const result = await getAssets(token, {
    ...(typeFilter ? { asset_type: typeFilter } : {}),
    ...(atRisk ? { at_risk: true } : {}),
    ...(search ? { q: search } : {}),
    limit,
    offset,
  });

  const filterHref = (t?: AssetType) => {
    const q = new URLSearchParams();
    if (t) q.set("asset_type", t);
    if (atRisk) q.set("at_risk", "true");
    if (search) q.set("q", search);
    const s = q.toString();
    return s ? `/assets?${s}` : "/assets";
  };
  // The at-risk filter's own toggle — so an ?at_risk=true arrival is a VISIBLE filter the
  // customer can see and clear, not a silent narrowing of a list that claims to be "Assets".
  const atRiskHref = (on: boolean) => {
    const q = new URLSearchParams();
    if (typeFilter) q.set("asset_type", typeFilter);
    if (on) q.set("at_risk", "true");
    if (search) q.set("q", search);
    const s = q.toString();
    return s ? `/assets?${s}` : "/assets";
  };
  const pageHref = (o: number) => {
    const q = new URLSearchParams();
    if (typeFilter) q.set("asset_type", typeFilter);
    if (atRisk) q.set("at_risk", "true");
    if (search) q.set("q", search);
    if (o > 0) q.set("offset", String(o));
    const s = q.toString();
    return s ? `/assets?${s}` : "/assets";
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Assets
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Every asset your organization tracks — vendors, AI systems, applications,
            infrastructure — in one registry view.
          </p>
        </div>
        {result.ok && (
          // With a type filter active, "Add" goes straight to that type's Create
          // screen (type chosen once, on the filter); with no filter it opens the
          // type picker. Either way the user never re-selects the type downstream.
          <Link
            href={typeFilter ? assetCreateHref(typeFilter) : "/assets/new"}
            className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {typeFilter ? `+ Add ${assetTypeLabel(typeFilter)}` : "+ Add asset"}
          </Link>
        )}
      </div>

      {!result.ok ? (
        <ReadFailurePanel
          {...assetsReadFailure(result)}
          capabilityNote="The Asset Registry is part of the Platform plans."
        />
      ) : (
        <>
          {/* Search — the same GET-form pattern the Finding surface uses: the term is a
              URL param, so it composes with the filter chips below and survives page
              turns. Hidden inputs carry the active filters through a submit; omitting
              offset means a new search honestly resets to page 1. */}
          <form action="/assets" method="get" className="mb-6">
            <label
              htmlFor="asset-search"
              className="block text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: "#64748b" }}
            >
              Search
            </label>
            {typeFilter && <input type="hidden" name="asset_type" value={typeFilter} />}
            {atRisk && <input type="hidden" name="at_risk" value="true" />}
            <div className="flex items-center gap-2 w-full max-w-xl">
              <input
                id="asset-search"
                type="search"
                name="q"
                defaultValue={search ?? ""}
                minLength={2}
                maxLength={120}
                placeholder="Name, asset ID, hostname, cloud account, vendor, business process..."
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

          {/* Type filter chips */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <FilterChip href={filterHref()} active={!typeFilter} label="All" />
            {ASSET_TYPES.map((t) => (
              <FilterChip
                key={t}
                href={filterHref(t)}
                active={typeFilter === t}
                label={assetTypeLabel(t)}
              />
            ))}
          </div>

          {/* Risk filter — a SEPARATE axis from type, so an executive arrival scoped to
              both ("cloud resources at risk") shows both chips lit and can clear either.
              Without a chip of its own, ?at_risk=true would be a filtered list under a
              highlighted "All" — a silent filter, and a count with no visible cause. */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
              Risk
            </span>
            <FilterChip href={atRiskHref(false)} active={!atRisk} label="All assets" />
            <FilterChip href={atRiskHref(true)} active={atRisk} label="At risk" />
          </div>

          {result.assets.length === 0 ? (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-sm" style={{ color: "#94a3b8" }}>
                {search
                  ? "No assets match your search."
                  : typeFilter
                  ? `No ${assetTypeLabel(typeFilter).toLowerCase()} assets yet.`
                  : "No assets registered yet."}
              </p>
              <p className="text-xs mt-1 mb-4" style={{ color: "#64748b" }}>
                Add cloud resources, endpoints, APIs, and identity systems here — or import from an
                existing source.
              </p>
              <Link
                href={typeFilter ? assetCreateHref(typeFilter) : "/assets/new"}
                className="inline-block px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "#00c4b4", color: "#0a0f1a" }}
              >
                {typeFilter ? `+ Add ${assetTypeLabel(typeFilter)}` : "+ Add asset"}
              </Link>
            </div>
          ) : (
            <div className="bg-brand-surface border border-brand-line rounded-xl divide-y" style={{ borderColor: "#1e293b" }}>
              {result.assets.map((asset) => (
                <AssetRow key={asset.asset_id} asset={asset} />
              ))}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6">
            <span className="text-xs" style={{ color: "#64748b" }}>
              {result.total} asset{result.total === 1 ? "" : "s"}
              {typeFilter ? ` · ${assetTypeLabel(typeFilter)}` : ""}
            </span>
            <div className="flex items-center gap-2">
              {offset > 0 && (
                <Link
                  href={pageHref(Math.max(0, offset - limit))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-80"
                  style={{ borderColor: "#1e293b", color: "#94a3b8" }}
                >
                  ← Previous
                </Link>
              )}
              {offset + limit < result.total && (
                <Link
                  href={pageHref(offset + limit)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-80"
                  style={{ borderColor: "#1e293b", color: "#94a3b8" }}
                >
                  Next →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.3)" }
          : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
      }
    >
      {label}
    </Link>
  );
}

function AssetRow({ asset }: { asset: CanonicalAsset }) {
  const href = assetDetailHref(asset);
  const name = (
    <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
      {asset.name}
    </span>
  );
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {href ? (
            <Link href={href} className="hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          <TypeChip label={assetTypeLabel(asset.asset_type)} />
          <StatusChip value={asset.status} />
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <MetaChip label="Backing" value={asset.backing_kind.replaceAll("_", " ")} />
          <MetaChip
            label="Added"
            value={new Date(asset.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          />
        </div>
      </div>
      <div className="flex-shrink-0">
        <CriticalityBadge value={asset.criticality} />
      </div>
    </div>
  );
}
