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
  const offset = parseOffsetParam(sp.offset);
  const limit = ASSET_PAGE.defaultLimit;

  const result = await getAssets(token, {
    ...(typeFilter ? { asset_type: typeFilter } : {}),
    limit,
    offset,
  });

  const filterHref = (t?: AssetType) => {
    const q = new URLSearchParams();
    if (t) q.set("asset_type", t);
    const s = q.toString();
    return s ? `/assets?${s}` : "/assets";
  };
  const pageHref = (o: number) => {
    const q = new URLSearchParams();
    if (typeFilter) q.set("asset_type", typeFilter);
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
          <Link
            href="/assets/new"
            className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            + Add asset
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

          {result.assets.length === 0 ? (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-sm" style={{ color: "#94a3b8" }}>
                {typeFilter
                  ? `No ${assetTypeLabel(typeFilter).toLowerCase()} assets yet.`
                  : "No assets registered yet."}
              </p>
              <p className="text-xs mt-1 mb-4" style={{ color: "#64748b" }}>
                Add cloud resources, endpoints, APIs, and identity systems here — or import from an
                existing source.
              </p>
              <Link
                href={
                  typeFilter && isAssetType(typeFilter)
                    ? `/assets/new?type=${typeFilter}`
                    : "/assets/new"
                }
                className="inline-block px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "#00c4b4", color: "#0a0f1a" }}
              >
                + Add asset
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
